/**
 * The wire half of who may close a `Distress` [G3; `signals.spec.md`, *The answer signature*]: what a
 * squad member signs, what is sealed to the executor's own key and what is not, the signal that asks
 * the watch to wake the others, and the kind a page says it is.
 */
import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools/core';
import type { SimplePool } from 'nostr-tools/pool';
import { nip44 } from 'nostr-tools';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { bytesToHex } from '@noble/hashes/utils';
import { seal } from '../src/crypto/envelope';
import {
  coverFor,
  coverOf,
  EXECUTOR_READS,
  openFromGroup,
  readersOf,
  sealToWatch,
  watchtowerAt
} from '../src/crypto/group';
import { isCurveKey } from '../src/crypto/keys';
import { kemPublicHex } from '../src/crypto/pq';
import { HOLDERS_MAX } from '../src/limits';
import { KIND_ANSWER_SIGNATURE, KIND_RESPONSE, SIGNAL_TYPES } from '../src/events/kinds';
import {
  answerSignatureEvent,
  answerSignedByResponder,
  signAnswer,
  type AnswerAbout,
  type ResponsePayload
} from '../src/events/response';
import { buildDistress, buildSignal, RESPONSE_WINDOW, type WakeOthersPayload } from '../src/events/signal';
import { pageKindOf, PAGE_KINDS } from '../src/escalation';
import { answeringKeys, sendDistress, sendSignal, waitForResponse } from '../src/transport';

const OPERATOR = generateSecretKey();
const OUR_PUBKEY = getPublicKey(OPERATOR);
const WATCH = generateSecretKey();
const WATCH_PUBKEY = getPublicKey(WATCH);
const EXECUTOR = generateSecretKey();
const EXECUTOR_PUBKEY = getPublicKey(EXECUTOR);
const WREN = generateSecretKey();
const WREN_PUBKEY = getPublicKey(WREN);
const ID = 'a'.repeat(64);
const NOW = 1_760_000_000;

const ABOUT: AnswerAbout = { watch: WATCH_PUBKEY, operator: OUR_PUBKEY, ids: [ID] };

/** 64 hex characters below the field prime that are not a point on the curve. */
function offCurve(): string {
  for (let i = 1; ; i++) {
    const key = i.toString(16).padStart(64, '0');
    if (!isCurveKey(key)) return key;
  }
}
const ANSWER: ResponsePayload = {
  type: 'ack',
  responder: { kind: 'human', callsign: 'Wren' },
  text: 'on my way',
  provenance: null
};

describe('a squad member signing an answer for themselves', () => {
  it('signs as themselves, and the signature checks', () => {
    const signed = signAnswer(WREN, ABOUT, ANSWER);
    expect(signed.responder.pubkey).toBe(WREN_PUBKEY);
    expect(signed.sig).toMatch(/^[0-9a-f]{128}$/);
    expect(signed.text, 'the words are untouched').toBe('on my way');
    expect(answerSignedByResponder(ABOUT, signed)).toBe(true);
  });

  it('is bound to every word the operator is shown, the attempts it answers, and who it answers', () => {
    const signed = signAnswer(WREN, ABOUT, ANSWER);
    const moved: [string, AnswerAbout, ResponsePayload][] = [
      ['other words', ABOUT, { ...signed, text: 'Wren is with you now.' }],
      ['no words', ABOUT, { ...signed, text: null }],
      ['another name', ABOUT, { ...signed, responder: { ...signed.responder, callsign: 'Raven' } }],
      ['another kind', ABOUT, { ...signed, responder: { ...signed.responder, kind: 'agent' } }],
      ['another type', ABOUT, { ...signed, type: 'answer' }],
      ['a ladder state added', ABOUT, { ...signed, ladder: 'acknowledged' }],
      ['another attempt', { ...ABOUT, ids: ['b'.repeat(64)] }, signed],
      ['an attempt added', { ...ABOUT, ids: [ID, 'b'.repeat(64)] }, signed],
      ['another operator', { ...ABOUT, operator: getPublicKey(generateSecretKey()) }, signed],
      ['another watch', { ...ABOUT, watch: getPublicKey(generateSecretKey()) }, signed],
      ['claimed by another key', ABOUT, { ...signed, responder: { ...signed.responder, pubkey: getPublicKey(generateSecretKey()) } }]
    ];
    for (const [what, about, payload] of moved) {
      expect(answerSignedByResponder(about, payload), what).toBe(false);
    }
  });

  it('reads the ids it answers in any order, each once', () => {
    const two = { ...ABOUT, ids: [ID, 'b'.repeat(64)] };
    const signed = signAnswer(WREN, two, ANSWER);
    expect(answerSignedByResponder({ ...ABOUT, ids: ['b'.repeat(64), ID, ID] }, signed)).toBe(true);
  });

  it('is false, never a throw, for anything malformed off the wire', () => {
    const signed = signAnswer(WREN, ABOUT, ANSWER);
    const junk: unknown[] = [
      { ...signed, sig: undefined },
      { ...signed, sig: 'zz' },
      { ...signed, sig: signed.sig!.toUpperCase() },
      { ...signed, sig: 42 },
      { ...signed, responder: { kind: 'human', callsign: 'Wren' } },
      { ...signed, responder: { ...signed.responder, pubkey: 'not a key' } },
      { ...signed, responder: undefined },
      null,
      { ...signed, sig: '0'.repeat(128) }
    ];
    for (const payload of junk) {
      expect(() => answerSignedByResponder(ABOUT, payload as ResponsePayload)).not.toThrow();
      expect(answerSignedByResponder(ABOUT, payload as ResponsePayload)).toBe(false);
    }
  });

  it('signs exactly the bytes the spec gives, so a second implementation can check it', () => {
    const event = answerSignatureEvent({ watch: 'W', operator: 'O', ids: ['2', '1', '2'] }, ANSWER, 'P');
    expect(event).toEqual({
      kind: KIND_ANSWER_SIGNATURE,
      pubkey: 'P',
      created_at: 0,
      tags: [],
      content: '["navcom-answer-v1","w","o",["1","2"],"ack","human","Wren","on my way",null]'
    });
    expect(KIND_ANSWER_SIGNATURE).toBe(20915);
  });
});

describe("the executor's own key, as a reader", () => {
  const box = watchtowerAt(WATCH_PUBKEY, undefined, undefined, EXECUTOR_PUBKEY);
  const capture = () => {
    const events: Event[] = [];
    const pool = {
      publish: (urls: string[], event: Event) => {
        events.push(event);
        return urls.map(() => Promise.resolve('ok'));
      }
    } as unknown as SimplePool;
    return { pool, events };
  };
  const opens = (secret: Uint8Array, content: string) => {
    try {
      openFromGroup(secret, OUR_PUBKEY, content);
      return true;
    } catch {
      return false;
    }
  };

  it('reads the acknowledgements and the asks to wake the others, which it acts on', async () => {
    for (const type of ['distress-ack', 'wake-others'] as const) {
      const { pool, events } = capture();
      await sendSignal(pool, ['wss://r'], OPERATOR, box, type, { distress_id: ID });
      expect(opens(EXECUTOR, events[0]!.content), `${type}: the executor cannot read it`).toBe(true);
      expect(opens(WATCH, events[0]!.content), `${type}: the box's holder cannot read it`).toBe(true);
      expect(opens(EXECUTOR, buildSignal(OPERATOR, box, type, { distress_id: ID }, NOW).content), `${type}, built`).toBe(true);
    }
    expect([...EXECUTOR_READS].sort()).toEqual(['distress-ack', 'wake-others']);
  });

  it('reads no Distress and no other signal: a ladder needs only who sent it, and the daemon reads the rest', async () => {
    const { pool, events } = capture();
    await sendDistress(pool, ['wss://r'], OPERATOR, box, { position: null, area: 'north side' });
    const others = SIGNAL_TYPES.filter((t) => !EXECUTOR_READS.includes(t));
    expect(others.length).toBe(SIGNAL_TYPES.length - 2);
    for (const type of others) await sendSignal(pool, ['wss://r'], OPERATOR, box, type, { text: 'bed tonight' } as never);
    expect(events).toHaveLength(others.length + 1);
    for (const e of events) {
      const type = e.tags.find((t) => t[0] === 't')?.[1] ?? 'distress';
      expect(opens(EXECUTOR, e.content), `the executor reads a ${type}`).toBe(false);
      expect(opens(WATCH, e.content), `the box cannot read a ${type}`).toBe(true);
    }
    expect(opens(EXECUTOR, buildDistress(OPERATOR, box, { position: null, area: 'x' }, NOW).content)).toBe(false);
  });

  it('is never a reason a message does not go: a key off the curve is read as none, and left out', async () => {
    // Past the field prime, and below it with no point there: no such key exists, and no wrap for it.
    for (const bad of ['f'.repeat(64), offCurve()]) {
      const broken = watchtowerAt(WATCH_PUBKEY, undefined, undefined, bad);
      expect(readersOf(broken, 'distress-ack'), bad).toEqual([WATCH_PUBKEY]);
      const { pool, events } = capture();
      await sendSignal(pool, ['wss://r'], OPERATOR, broken, 'distress-ack', { distress_id: ID });
      expect(opens(WATCH, events[0]!.content)).toBe(true);
      expect(opens(WATCH, sealToWatch(OPERATOR, broken, { distress_id: ID }, 'distress-ack'))).toBe(true);
    }
  });

  it('is left out where its wrap would take the envelope past the holder limit, and the holders still read it', () => {
    const members = Array.from({ length: HOLDERS_MAX }, () => generateSecretKey());
    const full = watchtowerAt(WATCH_PUBKEY, members.map((m) => getPublicKey(m)), undefined, EXECUTOR_PUBKEY);
    expect(readersOf(full, 'distress-ack')).toHaveLength(HOLDERS_MAX);
    expect(readersOf(full, 'distress-ack')).not.toContain(EXECUTOR_PUBKEY);
    const sealed = sealToWatch(OPERATOR, full, { distress_id: ID }, 'distress-ack');
    expect(opens(members[HOLDERS_MAX - 1]!, sealed)).toBe(true);
    expect(opens(EXECUTOR, sealed)).toBe(false);
  });

  it('falls back to the holders where its own wrap cannot be made for any other reason', () => {
    // A post-quantum key for the executor that does not parse refuses the whole envelope.
    const garbled = { ...box, kem: { [EXECUTOR_PUBKEY]: 'zz' } };
    const sealed = sealToWatch(OPERATOR, garbled, { distress_id: ID }, 'distress-ack');
    expect(opens(WATCH, sealed)).toBe(true);
    expect(opens(EXECUTOR, sealed)).toBe(false);
  });

  it("is added to a squad's holders, never put in place of them", () => {
    const squad = watchtowerAt(WATCH_PUBKEY, [WREN_PUBKEY], undefined, EXECUTOR_PUBKEY);
    expect(readersOf(squad, 'distress-ack')).toEqual([WREN_PUBKEY, EXECUTOR_PUBKEY]);
    expect(readersOf(squad, 'distress')).toEqual([WREN_PUBKEY]);
    expect(readersOf(watchtowerAt(WATCH_PUBKEY), 'distress-ack')).toEqual([WATCH_PUBKEY]);
  });
});

describe('what cover a message to a watch that names its executor gets', () => {
  const kem = (pub: string) => ({ [pub]: kemPublicHex(pub === EXECUTOR_PUBKEY ? EXECUTOR : WATCH) });

  it("counts the executor's wrap on what it reads, and only there", () => {
    // The box's own key is covered; the executor has published no post-quantum key.
    const box = watchtowerAt(WATCH_PUBKEY, undefined, kem(WATCH_PUBKEY), EXECUTOR_PUBKEY);
    expect(coverOf(box.holders, box.kem), 'what a screen computing from the holders says').toBe('hybrid');
    expect(coverFor(box, 'distress-ack')).toBe('classical');
    expect(coverFor(box, 'wake-others')).toBe('classical');
    expect(coverFor(box, 'query')).toBe('hybrid');
    expect(coverFor(box, 'distress')).toBe('hybrid');
    const covered = { ...box, kem: { ...box.kem, ...kem(EXECUTOR_PUBKEY) } };
    expect(coverFor(covered, 'distress-ack')).toBe('hybrid');
    expect(coverFor(watchtowerAt(WATCH_PUBKEY, undefined, kem(WATCH_PUBKEY)), 'distress-ack'), 'no executor named').toBe('hybrid');
  });
});

describe('a key somebody could hold', () => {
  it('is on the curve, as the library that seals to it agrees, for any 64 hex characters', () => {
    let on = 0;
    for (let i = 0; i < 300; i++) {
      const key = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
      let sealable = true;
      try {
        nip44.getConversationKey(OPERATOR, key);
      } catch {
        sealable = false;
      }
      expect(isCurveKey(key), key).toBe(sealable);
      if (sealable) on++;
    }
    // About half of all x-coordinates are on the curve; both kinds were checked.
    expect(on).toBeGreaterThan(90);
    expect(on).toBeLessThan(210);
    expect(isCurveKey(WREN_PUBKEY)).toBe(true);
    for (const junk of ['f'.repeat(64), WREN_PUBKEY.toUpperCase(), WREN_PUBKEY.slice(1), '', null, 42]) {
      expect(isCurveKey(junk), String(junk)).toBe(false);
    }
  });
});

describe("hearing the executor's answer to a signal", () => {
  const box = watchtowerAt(WATCH_PUBKEY, undefined, undefined, EXECUTOR_PUBKEY);
  const SENT = { id: 'b'.repeat(64), created_at: NOW } as unknown as Event;
  const reply = (author: Uint8Array, text: string) =>
    finalizeEvent(
      {
        kind: KIND_RESPONSE,
        created_at: NOW,
        tags: [['p', OUR_PUBKEY], ['e', SENT.id]],
        content: seal(author, OUR_PUBKEY, { type: 'ack', responder: { kind: 'node', callsign: 'escalation' }, text, provenance: null })
      },
      author
    );
  /** A relay that hands over whatever is given, honouring `authors` only when asked to. */
  const relay = (honourAuthors: boolean) => {
    const seen: { authors?: string[] }[] = [];
    let deliver: (e: Event) => void = () => {};
    const pool = {
      subscribeMany: (_r: string[], filter: { authors?: string[] }, params: { onevent: (e: Event) => void }) => {
        seen.push(filter);
        deliver = (e) => {
          if (!honourAuthors || !filter.authors || filter.authors.includes(e.pubkey)) params.onevent(e);
        };
        return { close() {} };
      }
    } as unknown as SimplePool;
    return { pool, seen, deliver: (e: Event) => deliver(e) };
  };

  it('asks for the executor beside the watch key, and opens its answer with its own key', async () => {
    const r = relay(true);
    const waiting = waitForResponse(r.pool, ['wss://r'], OPERATOR, OUR_PUBKEY, box, SENT, 2_000);
    r.deliver(reply(EXECUTOR, 'Paging Raven, Owl.'));
    await expect(waiting).resolves.toMatchObject({ text: 'Paging Raven, Owl.' });
    expect(r.seen[0]!.authors).toEqual([WATCH_PUBKEY, EXECUTOR_PUBKEY]);
    expect(answeringKeys(box)).toEqual([WATCH_PUBKEY, EXECUTOR_PUBKEY]);
  });

  it('still asks for the watch key alone where it is given only the pubkey, as every caller did', async () => {
    const r = relay(true);
    const waiting = waitForResponse(r.pool, ['wss://r'], OPERATOR, OUR_PUBKEY, WATCH_PUBKEY, SENT, 50);
    r.deliver(reply(EXECUTOR, 'Paging Raven, Owl.'));
    await expect(waiting).rejects.toThrow(/No response/);
    expect(r.seen[0]!.authors).toEqual([WATCH_PUBKEY]);
  });

  it("hears no stranger's answer from a relay that ignores the filter", async () => {
    const r = relay(false);
    const waiting = waitForResponse(r.pool, ['wss://r'], OPERATOR, OUR_PUBKEY, box, SENT, 50);
    r.deliver(reply(generateSecretKey(), 'The watch is paging everyone.'));
    await expect(waiting).rejects.toThrow(/No response/);
  });
});

describe('asking the watch to wake the others', () => {
  it('is a signal of its own, answered as fast as an acknowledgement', () => {
    expect(SIGNAL_TYPES).toContain('wake-others');
    expect(RESPONSE_WINDOW['wake-others']).toBe(10);
    const ask: WakeOthersPayload = { distress_id: ID };
    const event = buildSignal(OPERATOR, watchtowerAt(WATCH_PUBKEY), 'wake-others', ask, NOW);
    expect(event.tags).toContainEqual(['t', 'wake-others']);
    expect(openFromGroup(WATCH, OUR_PUBKEY, event.content)).toEqual(ask);
  });
});

describe('the kind a page says it is', () => {
  it('is a repeat or a drill only when it says so exactly, and otherwise a page about a new Distress', () => {
    expect(PAGE_KINDS).toEqual(['first', 'repeat', 'drill']);
    expect(pageKindOf('repeat')).toBe('repeat');
    expect(pageKindOf('first')).toBe('first');
    expect(pageKindOf('drill'), 'a drill shown as a real Distress').toBe('drill');
    // A sender from before the field, a template left unfilled, and anything garbled: alarm.
    for (const v of [undefined, null, '', '{{kind}}', 'REPEAT', 'repeat ', 'DRILL', ' drill', 42, {}, ['repeat']]) {
      expect(pageKindOf(v), JSON.stringify(v)).toBe('first');
    }
  });

  it('reads the older drill flag only where the kind names nothing it knows', () => {
    // A sender from before `kind`, or a template that left it unfilled, that still said drill.
    expect(pageKindOf(undefined, true)).toBe('drill');
    expect(pageKindOf('{{kind}}', true)).toBe('drill');
    // A kind that says what it is wins: a real page is never read as a drill by a stray flag.
    expect(pageKindOf('first', true)).toBe('first');
    expect(pageKindOf('repeat', true)).toBe('repeat');
    expect(pageKindOf(undefined, 'true'), 'only exactly true').toBe('first');
    expect(pageKindOf(undefined, false)).toBe('first');
  });
});
