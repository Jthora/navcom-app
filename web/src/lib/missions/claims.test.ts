import { beforeEach, describe, expect, it } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools/core';
import { readFileSync } from 'node:fs';
import type { Filter } from 'nostr-tools/filter';
import { DEFAULT_RELAYS, buildSealedMissionClaim, readMissionPackage, type Mission, type MissionPublishers } from '@navcom/core';
import { set } from '$lib/terminal/storage';
import { contactPubkey, ensureContactKey, withdrawCard } from '$lib/terminal/card';
import { claimAgain, exposedOn, held, letGo, refusal, sendRelease, takePart, tookPart, unreleased, usable, type Published, type Wire } from './claims';
import { reportableDays } from './reports';
import { oneKey } from './registry-fixture';

/**
 * Taking part, from this device: the cap, the lease, withdrawal, and where each kind of claim goes.
 * The relays are a fake that records what was sent, so every path — including a relay refusing —
 * can be driven without a network.
 *
 * The test poster's inbox is pinned in a registry these tests stand in, as the shipped one pins
 * Mecha Jono's: no test key is added to the shipped registry.
 */

const NOW = 1791316800;
const posterSecret = generateSecretKey();
const poster = getPublicKey(posterSecret);
const INBOX = 'wss://inbox.example';
const publishers: MissionPublishers = oneKey(poster, 'Test Poster', true, { inbox: [INBOX] });

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

/**
 * Relays that take everything, record it and every question asked of them, and answer a query with
 * whatever the test planted. The registry is the test poster's unless a test gives another; `null`
 * leaves it out, as the app's wire does, so the shipped one decides.
 */
function fakeWire(answers: Event[] = [], accept = true, registry: MissionPublishers | null = publishers) {
  const sent: { urls: string[]; event: Event }[] = [];
  const asked: Filter[] = [];
  const w: Wire = {
    publish: async (urls, event) => {
      sent.push({ urls, event });
      return accept ? 'took' : 'refused';
    },
    query: async (urls, filter) => (asked.push(filter), { events: answers, answered: urls }),
    ...(registry ? { publishers: registry } : {})
  };
  return { w, sent, asked };
}

/** A kind-10050 list the poster signed, dated `at`: what NavCom read its inbox from until 2026-10-17. */
const list = (urls: string[], at = NOW, secret = posterSecret) =>
  finalizeEvent({ kind: 10050, created_at: at, content: '', tags: urls.map((u) => ['relay', u]) }, secret);

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
  it('goes to the inbox NavCom pins for the poster, and nowhere else', async () => {
    signOn();
    const { w, sent } = fakeWire();
    const r = await takePart(mission('sealed-a'), 'sealed', NOW, w);
    expect(r.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.urls).toEqual([INBOX]);
    expect(sent[0]!.event.kind).toBe(1059);
    expect(sent[0]!.event.tags).toContainEqual(['p', poster]);
    expect(held(NOW)[0]).toMatchObject({ visibility: 'sealed', claimId: null });
  });

  it('is not sent when NavCom pins no inbox for the poster, and says so', async () => {
    signOn();
    // The poster's own list is there to be read, and is not what decides.
    const { w, sent } = fakeWire([list([INBOX])], true, oneKey(poster, 'Test Poster', true));
    const r = await takePart(mission('sealed-b'), 'sealed', NOW, w);
    expect(r).toEqual({ ok: false, because: 'NavCom has no inbox for Test Poster, so there is nowhere to send it sealed. Nothing was sent.' });
    expect(sent).toEqual([]);
    expect(held(NOW)).toEqual([]);
  });

  /*
   * It said "No relay answered when asking where…" when no relay could be reached [11.E]. Nothing is
   * asked now, so a phone with no signal is neither told the poster has no inbox nor kept from
   * sending: the claim goes to the pinned inbox, and whether that inbox takes it is said as for any send.
   */
  it('is sent to the pinned inbox whether or not any relay would answer a question, since none is asked', async () => {
    signOn();
    const sent: string[][] = [];
    const silent: Wire = { publish: async (urls) => (sent.push(urls), 'took'), query: async () => ({ events: [], answered: [] }), publishers };
    expect((await takePart(mission('sealed-c'), 'sealed', NOW, silent)).ok).toBe(true);
    expect(sent).toEqual([[INBOX]]);
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

describe('what the second audit of Milestone 11 found', () => {
  const ownRelays = (urls: string[]) => set('accruing', 'relays_own', urls);
  const watch = (urls: string[]) => {
    set('accruing', 'watchtower', 'f'.repeat(64));
    set('accruing', 'relays', urls);
  };
  const deletions = (sent: { urls: string[]; event: Event }[]) => sent.filter((s) => s.event.kind === 5);

  it('lets a sealed claim go, and renews one, sealed the same way: nothing in the open says who took it', async () => {
    signOn();
    const { w, sent } = fakeWire();
    const m = mission('sealed-go');
    await takePart(m, 'sealed', NOW, w);
    expect((await takePart(m, 'sealed', NOW + 3_600, w)).ok).toBe(true);
    expect(await letGo(m, NOW + 7_200, w)).toEqual({ sent: true });
    expect(sent).toHaveLength(3);
    for (const s of sent) {
      expect(s.event.kind).toBe(1059);
      expect(s.urls).toEqual([INBOX]);
    }
  });

  it('sends a claim, its renewal’s withdrawal and its release where posters read, beside a watch and an operator’s own relays [11.E]', async () => {
    signOn();
    ownRelays(['wss://own.example']);
    watch(['wss://watch.example']);
    const { w, sent } = fakeWire();
    const m = mission('everywhere');
    await takePart(m, 'open', NOW, w);
    await takePart(m, 'open', NOW + 3_600, w);
    await letGo(m, NOW + 7_200, w);
    expect(sent.length).toBeGreaterThanOrEqual(5);
    for (const s of sent) expect(s.urls).toEqual(expect.arrayContaining(['wss://own.example', 'wss://watch.example', ...DEFAULT_RELAYS]));
  });

  it('sends each withdrawal where the claim it withdraws went, after the relay list has changed [11.E]', async () => {
    signOn();
    ownRelays(['wss://old.example']);
    const { w, sent } = fakeWire();
    const m = mission('moved');
    await takePart(m, 'open', NOW, w);
    ownRelays(['wss://new.example']);
    await takePart(m, 'open', NOW + 3_600, w);
    expect(deletions(sent)).toHaveLength(1);
    expect(deletions(sent)[0]!.urls).toContain('wss://old.example');
    ownRelays(['wss://newest.example']);
    await letGo(m, NOW + 7_200, w);
    expect(deletions(sent)).toHaveLength(2);
    expect(deletions(sent)[1]!.urls).toContain('wss://new.example');
  });

  it('renews a claim after the card that made it was withdrawn without asking a new key to withdraw the old one [11.E]', async () => {
    signOn();
    const { w, sent } = fakeWire();
    const m = mission('recard');
    await takePart(m, 'open', NOW, w);
    withdrawCard();
    expect((await takePart(m, 'open', NOW + 3_600, w)).ok).toBe(true);
    expect(deletions(sent)).toEqual([]);
  });

  describe('from taking part to reporting', () => {
    it('remembers a mission that ended yesterday, so its last day can still be reported', async () => {
      signOn();
      const ended = mission('ended', { ends: NOW + 3_600 });
      await takePart(ended, 'open', NOW, fakeWire().w);
      const later = NOW + 2 * 86_400;
      const t = tookPart(later, publishers).find((x) => x.mission.address === ended.address);
      expect(t).toBeDefined();
      expect(reportableDays(later, t)).not.toEqual([]);
    });

    it('keeps the day it first took part when a claim is renewed, so the first day stays reportable', async () => {
      signOn();
      const m = mission('days');
      await takePart(m, 'open', NOW, fakeWire().w);
      await takePart(m, 'open', NOW + 2 * 86_400, fakeWire().w);
      expect(tookPart(NOW + 3 * 86_400, publishers).find((x) => x.mission.address === m.address)!.since).toBe(NOW);
    });

    it('renews a claim while holding three, and on a one-person task now listed as claimed because of it', async () => {
      signOn();
      const { w } = fakeWire();
      for (const d of ['r1', 'r2', 'r3']) await takePart(mission(d), 'open', NOW, w);
      expect((await takePart(mission('r1'), 'open', NOW + 3_600, w)).ok).toBe(true);
      await letGo(mission('r2'), NOW + 3_600, w);
      await takePart(mission('task', { claims: 'one' }), 'open', NOW + 3_600, w);
      const nowClaimed = mission('task', { claims: 'one', state: 'claimed' });
      expect(refusal(nowClaimed, NOW + 7_200)).toBeNull();
      expect((await takePart(nowClaimed, 'open', NOW + 7_200, w)).ok).toBe(true);
    });
  });

  it('refuses taking part in a mission that has ended or that its poster closed', async () => {
    signOn();
    const { w, sent } = fakeWire();
    expect(await takePart(mission('over', { ends: NOW - 60 }), 'open', NOW, w)).toEqual({ ok: false, because: 'ended' });
    expect(await takePart(mission('shut', { state: 'closed' }), 'open', NOW, w)).toEqual({ ok: false, because: 'ended' });
    expect(sent).toEqual([]);
  });
});

/*
 * Mecha Jono's old secret was exposed on 2026-09-28. NavCom sent a sealed claim to the inbox in the
 * poster's newest kind-10050 list by date, and the date is whatever the signer writes: whoever holds
 * the secret could sign a list dated next year naming relays they run, and every sealed claim from
 * NavCom would go there. The lookup also went out over the connection that carries the card, a
 * moment before the seal (interchange Q16). Since 2026-10-17 the inbox is pinned in the release.
 */
describe('where a sealed claim goes, since an exposed key could sign an inbox list', () => {
  it('asks no relay anything on the way, and never for a kind-10050 list: to take part, to renew, or to let go', async () => {
    signOn();
    const { w, sent, asked } = fakeWire([list([INBOX])]);
    const m = mission('no-lookup');
    expect((await takePart(m, 'sealed', NOW, w)).ok).toBe(true);
    expect((await takePart(m, 'sealed', NOW + 3_600, w)).ok).toBe(true);
    expect(await letGo(m, NOW + 7_200, w)).toEqual({ sent: true });
    expect(sent).toHaveLength(3);
    expect(asked.filter((f) => f.kinds?.includes(10050))).toEqual([]);
    expect(asked).toEqual([]);
  });

  it('is not moved by a list the poster’s key signed, dated next year, naming relays somebody else runs', async () => {
    signOn();
    const forged = list(['wss://attacker.example'], NOW + 365 * 86_400);
    const older = list(['wss://older.example'], NOW - 86_400);
    const { w, sent } = fakeWire([older, forged]);
    const m = mission('forged');
    expect((await takePart(m, 'sealed', NOW, w)).ok).toBe(true);
    await letGo(m, NOW + 60, w);
    expect(sent.map((s) => s.urls)).toEqual([[INBOX], [INBOX]]);
  });

  /*
   * A key that comes off the registry — the old one, at the cut-over — leaves nowhere to send a
   * claim on a mission it posted. Its own list naming an inbox changes nothing.
   */
  it('sends nothing to a poster this release does not read, though its own list names an inbox, and says so', async () => {
    signOn();
    const { w, sent } = fakeWire([list([INBOX])], true, []);
    const r = await takePart(mission('unread'), 'sealed', NOW, w);
    expect(r).toEqual({ ok: false, because: 'NavCom no longer reads the key Test Poster posted this with, so there is nowhere to send it sealed. Nothing was sent.' });
    expect(sent).toEqual([]);
    expect(held(NOW)).toEqual([]);
    expect(tookPart(NOW, publishers)).toEqual([]);
  });

  it('sends nothing to the test poster through the shipped registry, which holds no test key', async () => {
    signOn();
    const { w, sent } = fakeWire([list([INBOX])], true, null);
    expect(w.publishers).toBeUndefined();
    expect(await takePart(mission('shipped'), 'sealed', NOW, w)).toMatchObject({ ok: false, because: expect.stringMatching(/no longer reads the key Test Poster/) });
    expect(sent).toEqual([]);
  });

  /*
   * Decided 2026-10-18: nothing is sealed to a key whose secret leaked. Whoever holds it can fetch
   * every wrap addressed to it and open it, and prove which card sent each. Sealing pauses, nothing
   * is kept to send later, and taking part in the open still works.
   */
  it('seals nothing to a poster whose only key leaked: nothing built, sent, held or remembered, and it says why', async () => {
    signOn();
    const leaked = oneKey(poster, 'Test Poster', true, { inbox: [INBOX], keys: [{ ...publishers[0]!.keys[0]!, exposed: '2026-09-28' }] });
    const m = mission('leaked');
    const { w, sent, asked } = fakeWire([], true, leaked);
    expect(await takePart(m, 'sealed', NOW, w)).toEqual({
      ok: false,
      because:
        "Sealed sending to Test Poster is paused: its key's secret leaked, so whoever holds it could open anything sealed to it. Nothing is kept on this phone; come back once Test Poster reads under a new key. Nothing was sent."
    });
    expect(sent).toEqual([]);
    expect(asked).toEqual([]);
    expect(held(NOW)).toEqual([]);
    expect(tookPart(NOW, publishers)).toEqual([]);
    expect((await takePart(m, 'open', NOW, w)).ok).toBe(true);
    expect(sent.map((s) => s.event.kind)).toEqual([1985]);
  });

  it('seals a claim to the publisher’s newest key that did not leak, once it is trusted, on a mission its old key posted', async () => {
    signOn();
    const next = generateSecretKey();
    const switched = oneKey(poster, 'Test Poster', true, {
      inbox: [INBOX],
      keys: [{ ...publishers[0]!.keys[0]!, exposed: '2026-09-28' }, { pubkey: getPublicKey(next), generation: 2, notBefore: '2020-01-02T00:00:00Z', notAfter: '2100-01-01T00:00:00Z' }]
    });
    const m = mission('switched');
    const { w, sent } = fakeWire([], true, switched);
    expect((await takePart(m, 'sealed', NOW, w)).ok).toBe(true);
    expect(sent[0]!.event.tags).toContainEqual(['p', getPublicKey(next)]);
    expect(held(NOW)[0]).toMatchObject({ sealedTo: getPublicKey(next) });
  });
});


describe('what the second audit left open', () => {
  /** Relays that answer as told, one answer per publish, and record every event they were sent. */
  function answering(...answers: Published[]) {
    const sent: Event[] = [];
    const w: Wire = {
      publish: async (_urls, event) => {
        sent.push(event);
        return answers.shift() ?? 'took';
      },
      query: async (urls) => ({ events: [], answered: urls }),
      publishers
    };
    return { w, sent };
  }
  const labels = (sent: Event[], word: string) => sent.filter((e) => e.kind === 1985 && e.tags.some((t) => t[0] === 'l' && t[1] === word));
  const deletionsOf = (sent: Event[], id: string) => sent.filter((e) => e.kind === 5 && e.tags.some((t) => t[0] === 'e' && t[1] === id));

  describe('a claim no relay confirmed [audit 11.S, finding 61]', () => {
    /*
     * The relay took her claim and its answer came after the pool stopped waiting. The screen said
     * "Nothing was sent", the phone held nothing, and the retry put a second public claim beside the
     * first, which she could never withdraw.
     */
    it('is held, said to have maybe arrived, and sent again as the same event — never a second claim', async () => {
      signOn();
      const { w, sent } = answering('unconfirmed', 'took');
      const m = mission('slow');
      const r = await takePart(m, 'open', NOW, w);
      if (!r.ok) throw new Error(r.because);
      expect(r.held.unconfirmed?.id).toBe(sent[0]!.id);
      expect(held(NOW)).toEqual([expect.objectContaining({ claimId: sent[0]!.id, unconfirmed: expect.anything() })]);
      expect(await claimAgain(m.address, NOW + 60, w)).toBe('took');
      expect(labels(sent, 'claimed').map((e) => e.id)).toEqual([sent[0]!.id, sent[0]!.id]);
      expect(held(NOW + 60)[0]!.unconfirmed).toBeUndefined();
      expect(await claimAgain(m.address, NOW + 60, w)).toBe('gone');
    });

    it('counts in the three and can be let go, like any claim, since it may be on the relays', async () => {
      signOn();
      const { w, sent } = answering('unconfirmed');
      for (const d of ['u1', 'u2']) await takePart(mission(d), 'open', NOW, fakeWire().w);
      await takePart(mission('u3'), 'open', NOW, w);
      expect(held(NOW).find((h) => h.address === mission('u3').address)?.unconfirmed).toBeDefined();
      expect(refusal(mission('u4'), NOW)).toBe('cap');
      expect(await letGo(mission('u3'), NOW + 60, w)).toEqual({ sent: true });
      expect(deletionsOf(sent, sent[0]!.id)).toHaveLength(1);
    });

    it('stays held when sending it again is refused: a refusal now says nothing about the first time', async () => {
      signOn();
      const { w } = answering('unconfirmed', 'refused');
      const m = mission('slow-refused');
      await takePart(m, 'open', NOW, w);
      expect(await claimAgain(m.address, NOW + 60, w)).toBe('refused');
      expect(held(NOW + 60)[0]!.unconfirmed).toBeDefined();
    });

    it('withdraws the claim it renewed only once it is known to be there', async () => {
      signOn();
      const { w, sent } = answering('took', 'unconfirmed', 'took');
      const m = mission('renew-slow');
      await takePart(m, 'open', NOW, w);
      const first = sent[0]!.id;
      await takePart(m, 'open', NOW + 3_600, w);
      // Until the renewal is there, the first may be all a relay holds.
      expect(deletionsOf(sent, first)).toEqual([]);
      expect(await claimAgain(m.address, NOW + 3_660, w)).toBe('took');
      expect(deletionsOf(sent, first)).toHaveLength(1);
    });

    it('puts everything back as it was when every relay refused the renewal', async () => {
      signOn();
      const { w } = answering('took', 'refused');
      const m = mission('renew-refused');
      await takePart(m, 'open', NOW, w);
      const was = held(NOW)[0]!;
      const history = tookPart(NOW, publishers);
      expect(history).toEqual([expect.objectContaining({ since: NOW })]);
      expect(await takePart(m, 'open', NOW + 3_600, w)).toEqual({ ok: false, because: expect.stringMatching(/Nothing was sent/) });
      expect(held(NOW + 3_600)).toEqual([was]);
      // Its past days stay hers to report: the mission is remembered from when she first took part [review].
      expect(tookPart(NOW + 3_600, publishers)).toEqual(history);
    });

    /*
     * She renewed with no relay confirming it, then let it go. The claim the renewal replaced was
     * to be withdrawn once the renewal was there; letting go is the last chance to withdraw it.
     */
    it('withdraws the claim a renewal replaced when the renewal is let go before any relay confirmed it', async () => {
      signOn();
      const { w, sent } = answering('took', 'unconfirmed');
      const m = mission('renew-then-go');
      await takePart(m, 'open', NOW, w);
      const first = sent[0]!.id;
      await takePart(m, 'open', NOW + 3_600, w);
      const renewal = sent[1]!.id;
      expect(deletionsOf(sent, first)).toEqual([]);
      expect(await letGo(m, NOW + 3_660, w)).toEqual({ sent: true });
      expect(deletionsOf(sent, renewal)).toHaveLength(1);
      expect(deletionsOf(sent, first)).toHaveLength(1);
      expect(deletionsOf(sent, first)[0]!.pubkey).toBe(sent[0]!.pubkey);
    });

    it('is not remembered as taken part in when every relay refused it', async () => {
      signOn();
      const { w } = answering('refused');
      await takePart(mission('never'), 'open', NOW, w);
      expect(tookPart(NOW, publishers)).toEqual([]);
      expect(held(NOW)).toEqual([]);
    });
  });

  describe('letting go with no signal [audit 11.S, finding 66]', () => {
    /*
     * In the crowd her signal dropped and she let go. The claim was forgotten before the release was
     * sent, so an hour later, with signal, the mission offered only "Take part", and her public claim
     * stayed on the relays until it lapsed.
     */
    it('keeps the release to send once there is signal, and sends the same one', async () => {
      signOn();
      const { w, sent } = answering('took', 'unconfirmed', 'took');
      const m = mission('crowd');
      await takePart(m, 'open', NOW, w);
      const claim = sent[0]!.id;
      expect(await letGo(m, NOW + 60, w)).toEqual({ sent: false, unconfirmed: true, because: expect.stringMatching(/may have arrived/) });
      // Off her claims at once: walking away is never refused.
      expect(held(NOW + 60)).toEqual([]);
      expect(unreleased(NOW + 60)).toEqual([expect.objectContaining({ address: m.address, claimId: claim })]);
      const firstRelease = labels(sent, 'released')[0]!;
      // An hour later, with signal, from the mission's own screen.
      expect(await letGo(m, NOW + 3_600, w)).toEqual({ sent: true });
      expect(labels(sent, 'released').map((e) => e.id)).toEqual([firstRelease.id, firstRelease.id]);
      expect(deletionsOf(sent, claim).length).toBeGreaterThan(0);
      expect(unreleased(NOW + 3_600)).toEqual([]);
    });

    it('can send it from what this device kept, with no mission to hand, sealed the way the claim was', async () => {
      signOn();
      const { w, sent } = answering('took', 'refused', 'took');
      const m = mission('crowd-sealed');
      await takePart(m, 'sealed', NOW, w);
      expect(await letGo(m, NOW + 60, w)).toMatchObject({ sent: false, unconfirmed: false });
      expect(await sendRelease(m.address, NOW + 3_600, w)).toEqual({ sent: true });
      expect(sent).toHaveLength(3);
      for (const e of sent) expect(e.kind).toBe(1059);
      // The same sealed release both times: one release, under one id.
      expect(sent[2]!.id).toBe(sent[1]!.id);
    });

    it('costs nothing: it holds no place in the three, and the mission can be taken again', async () => {
      signOn();
      const offline = answering('took', 'took', 'took', 'refused');
      for (const d of ['n1', 'n2', 'n3']) await takePart(mission(d), 'open', NOW, offline.w);
      await letGo(mission('n3'), NOW + 60, offline.w);
      expect(unreleased(NOW + 60)).toHaveLength(1);
      expect(refusal(mission('n4'), NOW + 60)).toBeNull();
      expect(refusal(mission('n3'), NOW + 60)).toBeNull();
    });

    /*
     * A released label names the mission, not the claim: sent after she took part again, it would
     * let go of the new claim. So taking part again drops it, and withdraws the old claim instead.
     */
    it('is dropped when she takes part again, so it can never let go of the new claim', async () => {
      signOn();
      const { w, sent } = answering('took', 'refused', 'took');
      const m = mission('back-again');
      await takePart(m, 'open', NOW, w);
      const old = sent[0]!.id;
      await letGo(m, NOW + 60, w);
      // The deletion request sent beside the release may never have arrived either.
      const before = deletionsOf(sent, old).length;
      expect((await takePart(m, 'open', NOW + 3_600, w)).ok).toBe(true);
      expect(unreleased(NOW + 3_600)).toEqual([]);
      // So taking part again asks for the old claim's withdrawal itself, under the key that signed it [review].
      const after = deletionsOf(sent, old);
      expect(after).toHaveLength(before + 1);
      expect(after.at(-1)!.pubkey).toBe(sent[0]!.pubkey);
      expect(await letGo(m, NOW + 3_600, answering('refused').w)).toMatchObject({ sent: false });
      expect(unreleased(NOW + 3_600)[0]!.claimId).not.toBe(old);
    });

    it('lapses by itself with the claim', async () => {
      signOn();
      const m = mission('lapse');
      await takePart(m, 'open', NOW, fakeWire().w);
      await letGo(m, NOW + 60, fakeWire([], false).w);
      expect(unreleased(NOW + 60)).toHaveLength(1);
      expect(unreleased(NOW + 86_400)).toEqual([]);
    });

    /*
     * With no signal at all every connection fails and nothing leaves the phone; the screen said
     * "Release unconfirmed", which everywhere else means it may have arrived, and she could read her
     * claim as maybe released and not send it [review].
     */
    it('says a release may have arrived only once it left the phone and no relay refused it', async () => {
      signOn();
      const m = mission('which');
      const offline = answering('took', 'refused', 'refused');
      await takePart(m, 'open', NOW, offline.w);
      expect(await letGo(m, NOW + 60, offline.w)).toEqual({ sent: false, unconfirmed: false, because: 'No relay took the release.' });
      expect(unreleased(NOW + 60)[0]!.mayHaveArrived).toBeUndefined();
      // A slow cell: it may have arrived — and a refusal after that says nothing about that time.
      const slow = answering('unconfirmed', 'took', 'refused');
      expect(await sendRelease(m.address, NOW + 120, slow.w)).toEqual({ sent: false, unconfirmed: true, because: expect.stringMatching(/may have arrived/) });
      expect(unreleased(NOW + 120)[0]!.mayHaveArrived).toBe(true);
      expect(await sendRelease(m.address, NOW + 180, slow.w)).toEqual({
        sent: false,
        unconfirmed: false,
        because: expect.stringMatching(/may have arrived\. No relay took it this time/)
      });
      expect(unreleased(NOW + 180)[0]!.mayHaveArrived).toBe(true);
    });

    it('is kept as maybe arrived while it is on its way, and as not sent when none could be built', async () => {
      signOn();
      const m = mission('on-its-way');
      await takePart(m, 'open', NOW, fakeWire().w);
      // A phone that dies mid-send keeps what it kept before sending: that the release may have left.
      let during: true | undefined;
      const dies: Wire = {
        publish: async (_urls, e) => {
          if (e.kind === 1985) during = unreleased(NOW + 60)[0]?.mayHaveArrived;
          return 'refused';
        },
        query: async (urls) => ({ events: [], answered: urls })
      };
      await letGo(m, NOW + 60, dies);
      expect(during).toBe(true);
      expect(unreleased(NOW + 60)[0]!.mayHaveArrived).toBeUndefined();
      // Sealed, and its poster's key came off the registry since: no release was signed.
      const s = mission('sealed-none');
      await takePart(s, 'sealed', NOW, answering().w);
      const nowhere: Wire = { publish: async () => 'took', query: async () => ({ events: [], answered: [] }), publishers: [] };
      expect(await letGo(s, NOW + 60, nowhere)).toMatchObject({ sent: false, unconfirmed: false, because: expect.stringMatching(/no longer reads the key/) });
      const kept = unreleased(NOW + 60).find((u) => u.address === s.address)!;
      expect(kept.release).toBeUndefined();
      expect(kept.mayHaveArrived).toBeUndefined();
    });
  });
});

/*
 * A sealed claim or release kept before 2026-10-17 was aimed by the poster's newest kind-10050 list,
 * which whoever holds an exposed key could sign; and the old key comes off the registry at the
 * cut-over. Sending one again went wherever it was kept to go [review]. It goes to the inbox this
 * release pins for the poster now, or nowhere, and says so.
 */
describe('a sealed claim or release sent again, kept before the inbox was pinned', () => {
  const ATTACKER = 'wss://attacker.example';
  /** Relays that answer each send with the next word given, then take everything, under `registry`. */
  function answering(registry: MissionPublishers | null, ...answers: Published[]) {
    const sent: { urls: string[]; event: Event }[] = [];
    const w: Wire = {
      publish: async (urls, event) => (sent.push({ urls, event }), answers.shift() ?? 'took'),
      query: async (urls) => ({ events: [], answered: urls }),
      ...(registry ? { publishers: registry } : {})
    };
    return { w, sent };
  }
  /** What a device kept before this release: the same records, aimed where a forged list said. */
  const aimedByAList = () => {
    set('wipeable', 'mission_claims', held(NOW).map((h) => ({ ...h, relays: [ATTACKER] })));
    set('wipeable', 'mission_releases', unreleased(NOW).map((u) => ({ ...u, releaseTo: [ATTACKER] })));
  };

  it('sends a held claim again to the pinned inbox, never to the relays it kept', async () => {
    signOn();
    const m = mission('kept-claim');
    expect((await takePart(m, 'sealed', NOW, answering(publishers, 'unconfirmed').w)).ok).toBe(true);
    aimedByAList();
    const { w, sent } = answering(publishers);
    expect(await claimAgain(m.address, NOW + 60, w)).toBe('took');
    expect(sent.map((s) => s.urls)).toEqual([[INBOX]]);
  });

  it('sends a held claim nowhere once its poster has no inbox here, keeps it as maybe arrived, and says so', async () => {
    signOn();
    const m = mission('kept-nowhere');
    await takePart(m, 'sealed', NOW, answering(publishers, 'unconfirmed').w);
    aimedByAList();
    const { w, sent } = answering([]);
    expect(await claimAgain(m.address, NOW + 60, w)).toEqual({
      nowhere:
        'No relay confirmed it; it may have arrived. NavCom no longer reads the key the poster posted this with, so there is nowhere to send it sealed. Nothing was sent this time.'
    });
    expect(sent).toEqual([]);
    expect(held(NOW + 60)[0]!.unconfirmed).toBeDefined();
  });

  it('sends a release again to the pinned inbox, never to where it was kept to go', async () => {
    signOn();
    const m = mission('kept-release');
    await takePart(m, 'sealed', NOW, answering(publishers).w);
    expect(await letGo(m, NOW + 60, answering(publishers, 'unconfirmed').w)).toMatchObject({ sent: false, unconfirmed: true });
    aimedByAList();
    expect(unreleased(NOW + 60)[0]!.releaseTo).toEqual([ATTACKER]);
    const { w, sent } = answering(publishers);
    expect(await sendRelease(m.address, NOW + 120, w)).toEqual({ sent: true });
    expect(sent.map((s) => s.urls)).toEqual([[INBOX]]);
  });

  it('sends a release nowhere once its poster has no inbox here, keeps it to send, and says so', async () => {
    signOn();
    const m = mission('kept-release-nowhere');
    await takePart(m, 'sealed', NOW, answering(publishers).w);
    await letGo(m, NOW + 60, answering(publishers, 'unconfirmed').w);
    aimedByAList();
    const { w, sent } = answering(oneKey(poster, 'Test Poster', true));
    expect(await sendRelease(m.address, NOW + 120, w)).toEqual({
      sent: false,
      unconfirmed: false,
      because: 'No relay confirmed it; it may have arrived. NavCom has no inbox for Test Poster, so there is nowhere to send it sealed. Nothing was sent this time.',
      nowhere: true
    });
    expect(sent).toEqual([]);
    expect(unreleased(NOW + 120)).toEqual([expect.objectContaining({ address: m.address, mayHaveArrived: true })]);
  });

  /**
   * The heat-relief campaign, under the key whose secret leaked [decided 2026-10-18]. Nothing is
   * sealed to that key any more — not a new claim, not one kept from before sent again, and not the
   * release of one — and its missions cannot be taken while its list is unconfirmed.
   */
  it('seals nothing to Mecha Jono’s old key: its missions cannot be taken, and a sealed claim kept from before neither goes again nor sends a release', async () => {
    signOn();
    const fixtures = JSON.parse(readFileSync(new URL('../../../../packages/core/test/fixtures/mission-packages.json', import.meta.url), 'utf8')) as Event[];
    const read = readMissionPackage(fixtures[0]);
    if (!read.ok) throw new Error(read.because);
    const heat = read.mission;
    const during = heat.validUntil - 2 * 86_400;
    expect(await takePart(heat, 'sealed', during, answering(null).w)).toEqual({ ok: false, because: 'retiring' });
    expect(await takePart(heat, 'open', during, answering(null).w)).toEqual({ ok: false, because: 'retiring' });
    // A sealed claim this device took before 2026-10-18, no relay having confirmed it.
    const wrap = buildSealedMissionClaim(ensureContactKey(), heat.publisher.pubkey, 'claimed', heat.address, during + 86_400, during);
    set('wipeable', 'mission_claims', [
      { address: heat.address, title: heat.title, visibility: 'sealed', ends: during + 86_400, claimId: null, relays: ['wss://nos.lol'], signer: contactPubkey(), unconfirmed: wrap }
    ]);
    const { w, sent } = answering(null);
    expect(await claimAgain(heat.address, during + 60, w)).toMatchObject({ nowhere: expect.stringMatching(/Sealed sending to Mecha Jono is paused/) });
    expect(await letGo(heat, during + 120, w)).toMatchObject({ sent: false, nowhere: true, because: expect.stringMatching(/^The release cannot go\..*ends by itself within a day\.$/) });
    expect(sent).toEqual([]);
    // Nothing kept to send later [P5].
    expect(unreleased(during + 120)).toEqual([]);
  });
});

/*
 * "Only Mecha Jono can see" was on every sealed claim, and every mission on the map is under the
 * key whose secret was exposed on 2026-09-28: whoever holds it can open what is sealed to it
 * [review]. The registry says which keys those are, and the screens read it from here.
 */
describe('who else can open what is sealed to the poster', () => {
  it('says Mecha Jono’s old key was exposed, and nothing of the new one or of a poster with no such mark', () => {
    expect(exposedOn('6301c4d09a014909e5a48b7d0c9aa859eec18804c2fc87eab4e414aa5a319692')).toBe('2026-09-28');
    expect(exposedOn('86f824c3f1e67c60b1dc15ce110648c4de5c3fb879022fbbcc5e8deb720e402c')).toBeNull();
    expect(exposedOn(poster, publishers)).toBeNull();
    expect(exposedOn(poster)).toBeNull();
  });
});
