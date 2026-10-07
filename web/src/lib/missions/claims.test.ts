import { beforeEach, describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools/core';
import { DEFAULT_RELAYS, readMissionPackage, type Mission } from '@navcom/core';
import { set } from '$lib/terminal/storage';
import { withdrawCard } from '$lib/terminal/card';
import { held, letGo, refusal, takePart, usable, type Wire } from './claims';

/**
 * Taking part, from this device: the cap, the lease, withdrawal, and where each kind of claim goes.
 * The relays are a fake that records what was sent, so every path — including a relay refusing —
 * can be driven without a network.
 */

const NOW = 1791316800;
const posterSecret = generateSecretKey();
const poster = getPublicKey(posterSecret);
const publishers = { [poster]: { name: 'Test Poster', agent: true } };

function mission(d: string, over: { ends?: number; claims?: 'one' | 'many'; state?: string } = {}): Mission {
  const e = finalizeEvent(
    {
      kind: 30079,
      created_at: NOW - 3_600,
      content: JSON.stringify({ name: `Mission ${d}`, objectives: [{ id: 'do:it', ask: 'Do it.' }] }),
      tags: [
        ['d', d], ['t', 'starcom_mission_package'], ['t', 'navcom_handoff'], ['t', 'navcom_mission'],
        ['mission_state', over.state ?? 'open'], ['valid_until', String(over.ends ?? NOW + 10 * 86_400)],
        ['claims', over.claims ?? 'many']
      ]
    },
    posterSecret
  );
  const r = readMissionPackage(e, publishers);
  if (!r.ok) throw new Error(r.because);
  return r.mission;
}

/** Relays that take everything, record it, and answer a query with whatever the test planted. */
function fakeWire(answers: Event[] = [], accept = true) {
  const sent: { urls: string[]; event: Event }[] = [];
  const w: Wire = {
    publish: async (urls, event) => {
      sent.push({ urls, event });
      return accept;
    },
    query: async (urls) => ({ events: answers, answered: urls })
  };
  return { w, sent };
}

const inbox = (urls: string[]) =>
  finalizeEvent({ kind: 10050, created_at: NOW, content: '', tags: urls.map((u) => ['relay', u]) }, posterSecret);

beforeEach(() => {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k)
  };
});
const signOn = () => set('accruing', 'secret', 'ab'.repeat(32));

describe('who may take part', () => {
  it('asks somebody not signed on to sign on first', () => {
    expect(refusal(mission('a'), NOW)).toBe('signed-out');
  });

  it('says a one-person task somebody else holds is taken', () => {
    signOn();
    expect(refusal(mission('a', { claims: 'one', state: 'claimed' }), NOW)).toBe('taken');
  });

  it('holds at most three at once', async () => {
    signOn();
    const { w } = fakeWire();
    for (const d of ['a', 'b', 'c']) expect((await takePart(mission(d), 'open', NOW, w)).ok).toBe(true);
    expect(refusal(mission('d'), NOW)).toBe('cap');
    expect(await takePart(mission('d'), 'open', NOW, w)).toEqual({ ok: false, because: 'cap' });
  });
});

describe('a claim in the open', () => {
  it('goes to the operator’s relays as a label that ends within a day', async () => {
    signOn();
    const { w, sent } = fakeWire();
    const r = await takePart(mission('a'), 'open', NOW, w);
    expect(r.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.urls).toEqual([...DEFAULT_RELAYS]);
    expect(sent[0]!.event.kind).toBe(1985);
    expect(held(NOW)).toEqual([expect.objectContaining({ visibility: 'open', ends: NOW + 86_400, claimId: sent[0]!.event.id })]);
    // A lease: gone from this device once it has ended.
    expect(held(NOW + 86_400)).toEqual([]);
  });

  it('ends with its mission, if the mission ends first', async () => {
    signOn();
    const { w } = fakeWire();
    await takePart(mission('a', { ends: NOW + 600 }), 'open', NOW, w);
    expect(held(NOW)[0]!.ends).toBe(NOW + 600);
  });

  it('is renewed by taking part again, which withdraws the claim it replaces', async () => {
    signOn();
    const { w, sent } = fakeWire();
    const m = mission('a');
    await takePart(m, 'open', NOW, w);
    const first = sent[0]!.event.id;
    await takePart(m, 'open', NOW + 3_600, w);
    expect(held(NOW + 3_600)).toHaveLength(1);
    expect(held(NOW + 3_600)[0]!.ends).toBe(NOW + 3_600 + 86_400);
    expect(sent.some((s) => s.event.kind === 5 && s.event.tags.some((t) => t[0] === 'e' && t[1] === first))).toBe(true);
  });

  it('is let go with a released label and a deletion request, and is gone from this device', async () => {
    signOn();
    const { w, sent } = fakeWire();
    const m = mission('a');
    await takePart(m, 'open', NOW, w);
    await letGo(m, NOW + 60, w);
    expect(held(NOW + 60)).toEqual([]);
    const kinds = sent.map((s) => s.event.kind);
    expect(kinds).toContain(5);
    expect(sent.some((s) => s.event.kind === 1985 && s.event.tags.some((t) => t[1] === 'released'))).toBe(true);
  });

  it('is not held when no relay took it, and says nothing was sent', async () => {
    signOn();
    const { w } = fakeWire([], false);
    const r = await takePart(mission('a'), 'open', NOW, w);
    expect(r).toEqual({ ok: false, because: expect.stringMatching(/Nothing was sent/) });
    expect(held(NOW)).toEqual([]);
  });

  it('lets go even when no relay answers: walking away is never refused', async () => {
    signOn();
    const m = mission('a');
    await takePart(m, 'open', NOW, fakeWire().w);
    const r = await letGo(m, NOW + 60, fakeWire([], false).w);
    expect(r.sent).toBe(false);
    expect(held(NOW + 60)).toEqual([]);
  });
});

describe('a claim for the poster only', () => {
  it('goes to the inbox the poster’s own signed list names, and nowhere else', async () => {
    signOn();
    const { w, sent } = fakeWire([inbox(['wss://inbox.example'])]);
    const r = await takePart(mission('sealed-a'), 'sealed', NOW, w);
    expect(r.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.urls).toEqual(['wss://inbox.example']);
    expect(sent[0]!.event.kind).toBe(1059);
    expect(sent[0]!.event.tags).toContainEqual(['p', poster]);
    expect(held(NOW)[0]).toMatchObject({ visibility: 'sealed', claimId: null });
  });

  it('is not sent when the poster’s inbox cannot be found', async () => {
    signOn();
    const { w, sent } = fakeWire([]);
    const r = await takePart(mission('sealed-b'), 'sealed', NOW, w);
    expect(r).toEqual({ ok: false, because: expect.stringMatching(/has not said where they take sealed messages/) });
    expect(sent).toEqual([]);
    expect(held(NOW)).toEqual([]);
  });

  it('says no relay answered, rather than that the poster has no inbox, when nobody did [11.E]', async () => {
    signOn();
    const silent: Wire = { publish: async () => true, query: async () => ({ events: [], answered: [] }) };
    const r = await takePart(mission('sealed-c'), 'sealed', NOW, silent);
    expect(r).toEqual({ ok: false, because: expect.stringMatching(/No relay answered/) });
  });
});

describe('what the audit of Milestone 11 found', () => {
  it('sends a claim where posters read it, even when a watch holds this device’s relays [11.E]', async () => {
    signOn();
    set('accruing', 'watchtower', 'f'.repeat(64));
    set('accruing', 'relays', ['wss://watch.example']);
    const { w, sent } = fakeWire();
    await takePart(mission('w'), 'open', NOW, w);
    expect(sent[0]!.urls).toEqual(expect.arrayContaining(['wss://watch.example', ...DEFAULT_RELAYS]));
  });

  it('holds no place in the cap for a mission that closed early [11.X]', async () => {
    signOn();
    const { w } = fakeWire();
    for (const d of ['c1', 'c2', 'c3']) await takePart(mission(d), 'open', NOW, w);
    expect(refusal(mission('c4'), NOW)).toBe('cap');
    expect(refusal(mission('c4'), NOW, new Set([mission('c4').address]))).toBeNull();
  });

  it('says when a claim was sent but this device could not record it [11.E]', async () => {
    signOn();
    const { w } = fakeWire();
    const write = localStorage.setItem;
    localStorage.setItem = (k: string, v: string) => {
      if (k === 'navcom.wipeable') throw new DOMException('full', 'QuotaExceededError');
      write(k, v);
    };
    const r = await takePart(mission('full'), 'open', NOW, w);
    localStorage.setItem = write;
    expect(r).toMatchObject({ ok: true, kept: false });
  });

  it('cannot let a claim go once the card that made it is withdrawn, and says so rather than pretending [11.E]', async () => {
    signOn();
    const { w } = fakeWire();
    await takePart(mission('card'), 'open', NOW, w);
    withdrawCard();
    expect(await letGo(mission('card'), NOW + 60, w)).toEqual({ sent: false, card: true });
  });

  it('keeps only addresses a socket could open [11.E]', () => {
    expect(usable(['wss://', 'wss://ok.example', 'https://no.example', 'wss://ok.example/', ' wss://x.example:99999 ', 'nonsense'])).toEqual([
      'wss://ok.example'
    ]);
  });
});
