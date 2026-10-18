import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools/core';
import { frozenDigest, type FrozenSet, type MissionPublishers } from '@navcom/core';
import { subscribeMissions, type Feed } from './live';
import { trustedKey } from './registry-fixture';

/**
 * The adversary's pass over the live feed [decided 2026-10-18; interchange spec rev 7], against a
 * relay that answers the way a relay does: each filter matched in full, newest first, cut at its
 * `limit`. The fake in live.test.ts answers whatever a test hands it, so a request that asks for
 * too little cannot fail there.
 */

const secs = (iso: string) => Date.parse(iso) / 1000;
const AT = secs('2026-10-20T12:00:00Z');
const RECORD = 'wss://record.test';

type Filter = Record<string, unknown>;
const matches = (e: Event, f: Filter) => {
  if (Array.isArray(f.kinds) && !(f.kinds as number[]).includes(e.kind)) return false;
  if (Array.isArray(f.authors) && !(f.authors as string[]).includes(e.pubkey)) return false;
  if (Array.isArray(f.ids) && !(f.ids as string[]).includes(e.id)) return false;
  if (typeof f.until === 'number' && e.created_at > f.until) return false;
  if (typeof f.since === 'number' && e.created_at < f.since) return false;
  for (const [k, v] of Object.entries(f)) {
    if (!k.startsWith('#') || k.length !== 2) continue;
    const present = e.tags.filter((t) => t[0] === k[1]).map((t) => t[1]);
    if (!(v as string[]).some((w) => present.includes(w))) return false;
  }
  return true;
};

/** A relay holding `Relay.store`: it answers every REQ from it, as NIP-01 says. */
class Relay extends EventTarget {
  static store: Event[] = [];
  constructor(readonly url: string) {
    super();
    setTimeout(() => this.dispatchEvent(new Event('open')), 0);
  }
  send(data: string): void {
    const frame = JSON.parse(data) as unknown[];
    if (frame[0] !== 'REQ') return;
    const [, id, ...filters] = frame as [string, string, ...Filter[]];
    const out = new Map<string, Event>();
    for (const f of filters) {
      let hits = Relay.store.filter((e) => matches(e, f)).sort((a, b) => b.created_at - a.created_at);
      if (typeof f.limit === 'number') hits = hits.slice(0, f.limit);
      for (const e of hits) out.set(e.id, e);
    }
    setTimeout(() => {
      for (const e of out.values()) this.frame(['EVENT', id, e]);
      this.frame(['EOSE', id]);
    }, 0);
  }
  close(): void {}
  frame(f: unknown[]): void {
    this.dispatchEvent(Object.assign(new Event('message'), { data: JSON.stringify(f) }));
  }
}

const old = generateSecretKey();
const next = generateSecretKey();
function pkg(secret: Uint8Array, d: string, at: number, o: { title?: string; ends?: number } = {}): Event {
  return finalizeEvent(
    {
      kind: 30079,
      created_at: at,
      content: JSON.stringify({ name: o.title ?? d, objectives: [{ id: 'do:it', ask: 'Hand out water.' }] }),
      tags: [
        ['d', d], ['t', 'starcom_mission_package'], ['t', 'navcom_handoff'], ['t', 'navcom_mission'],
        ['mission_state', 'open'], ['valid_until', String(o.ends ?? AT + 30 * 86_400)], ['jurisdiction', 'us-ca']
      ]
    },
    secret
  );
}

beforeEach(() => {
  vi.useFakeTimers({ now: AT * 1000 });
  const store = new Map<string, string>();
  vi.stubGlobal('WebSocket', Relay);
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    get length() { return store.size; },
    key: (i: number) => [...store.keys()][i] ?? null
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('a frozen mission republished under the second generation', () => {
  it('stays replaced once the publisher has posted a hundred newer versions, ended ones included', async () => {
    // The campaign, as the old key signed it and the frozen list keeps it.
    const frozen = pkg(old, 'campaign', secs('2026-10-02T00:00:00Z'), { title: 'First generation' });
    const list: FrozenSet = { key: getPublicKey(old), taken: '2026-10-18', source: 'a test', packages: [{ id: frozen.id, d: 'campaign' }] };
    const publishers: MissionPublishers = [
      {
        id: 'desk',
        name: 'Test Desk',
        agent: true,
        inbox: ['wss://inbox.test'],
        keys: [
          trustedKey(getPublicKey(old), { exposed: '2026-09-28', frozen: { sha256: frozenDigest(list), confirmed: true } }),
          trustedKey(getPublicKey(next), { generation: 2, notBefore: '2026-10-01T00:00:00Z' })
        ],
        next: null
      }
    ];
    // The publisher's own republish at the same d, under its next key, and then a fortnight of
    // nightly missions at fresh d's that have already ended: a relay keeps the latest version of
    // every d it was ever given, so these accumulate whatever their state.
    const replaced = pkg(next, 'campaign', secs('2026-10-03T00:00:00Z'), { title: 'Second generation' });
    const nights = Array.from({ length: 100 }, (_, i) =>
      pkg(next, `night-${i}`, secs('2026-10-04T00:00:00Z') + i * 3_600, { ends: secs('2026-10-04T00:00:00Z') + i * 3_600 + 8 * 3_600 })
    );
    Relay.store = [frozen, replaced, ...nights];

    const feeds: Feed[] = [];
    subscribeMissions((f) => feeds.push(f), { relays: [RECORD], publishers, trustAt: () => AT, frozen: [list] });
    await vi.advanceTimersByTimeAsync(50);
    const f = feeds.at(-1)!;
    if (f.status !== 'live') throw new Error(`expected live, got ${f.status}`);
    // Today: ['First generation']. The next key is asked with `limit: 100`, so its republish of the
    // campaign falls outside the newest hundred; the frozen key is asked by id with no limit, so the
    // old key's version is heard alone and is drawn in the honest one's place.
    expect(f.missions.map((m) => m.title)).toEqual(['Second generation']);
  });
});
