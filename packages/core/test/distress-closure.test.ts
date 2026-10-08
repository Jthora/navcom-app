/**
 * Who may close a `Distress` [G3; `escalation.spec.md`, *Who may close a Distress*].
 *
 * A `20912` saying `human` ended a `Distress` whenever the watch key had signed it. Every squad member
 * holds that key, so does everybody who ever did, and on a box so does the daemon the agent runs
 * beside: any of them could tell an operator in trouble that a person had it, and the phone stopped
 * sending. Probed on 2026-10-07: a forged answer ended a run with "Wren is responding."
 *
 * Now an answer ends it only when the phone can say who gave it: the executor's own key, which only
 * the executor holds, or a holder's own signature on that answer. Anything else that says `human` is
 * said as it was said, and the phone keeps sending. A watch that names neither keeps the old rule.
 *
 * The pool here honours `authors`, as a relay does: an answer from a key the phone did not ask for
 * never reaches it, which is how a phone that does not know the executor's key fails to hear it.
 */
import { describe, expect, it } from 'vitest';
import type { Event } from 'nostr-tools/core';
import { nip44 } from 'nostr-tools';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { seal } from '../src/crypto/envelope';
import { executorOf, watchtowerAt, type WatchtowerAddress } from '../src/crypto/group';
import { KIND_RESPONSE } from '../src/events/kinds';
import { signAnswer, watchCopy, type ResponsePayload } from '../src/events/response';
import { distressClosure, sendDistressUntilAcknowledged, type DistressPhase } from '../src/transport';

const OPERATOR = generateSecretKey();
const OUR_PUBKEY = getPublicKey(OPERATOR);
const WATCH = generateSecretKey();
const WATCH_PUBKEY = getPublicKey(WATCH);
const EXECUTOR = generateSecretKey();
const EXECUTOR_PUBKEY = getPublicKey(EXECUTOR);
const WREN = generateSecretKey();
const RAVEN = generateSecretKey();
/** Somebody who was a holder once, and has been taken off the list. Still holds the watch key. */
const FORMER = generateSecretKey();
/** Nobody this watch knows: no holder, never held the watch key. */
const STRANGER = generateSecretKey();

/** 64 hex characters below the field prime that are not a point on the curve, as a typo makes. */
const OFF_CURVE = (() => {
  for (let i = 1; ; i++) {
    const key = i.toString(16).padStart(64, '0');
    try {
      nip44.getConversationKey(OPERATOR, key);
    } catch {
      return key;
    }
  }
})();

const SQUAD = watchtowerAt(WATCH_PUBKEY, [getPublicKey(WREN), getPublicKey(RAVEN)]);
const BOX = watchtowerAt(WATCH_PUBKEY, undefined, undefined, EXECUTOR_PUBKEY);
/** A box handed over before it named its executor: today's rule. */
const OLD_BOX = watchtowerAt(WATCH_PUBKEY);

type Body = Partial<ResponsePayload>;

/** A `20912` signed by `author`, sealed by it to this operator, naming every id given. */
function response(author: Uint8Array, ids: string[], body: Body): Event {
  return finalizeEvent(
    {
      kind: KIND_RESPONSE,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', OUR_PUBKEY], ...ids.map((id) => ['e', id])],
      content: seal(author, OUR_PUBKEY, { text: null, provenance: null, ...body })
    },
    author
  );
}
const human = (callsign = 'Wren', text: string | null = 'Wren is responding.'): ResponsePayload => ({
  type: 'ack',
  responder: { kind: 'human', callsign },
  text,
  provenance: null
});
const node = (text: string, ladder: 'paging' | 'exhausted' = 'paging'): ResponsePayload => ({
  type: 'escalation-status',
  responder: { kind: 'node', callsign: 'escalation' },
  text,
  provenance: null,
  ladder
});
/** A squad member's answer from the board: signed by the watch key, and by their own over these ids. */
const holderAnswer = (holder: Uint8Array, ids: string[], body: ResponsePayload = human()) =>
  response(WATCH, ids, signAnswer(holder, { watch: WATCH_PUBKEY, operator: OUR_PUBKEY, ids }, body));

/**
 * A pool that honours `authors`, keeps nothing, and answers each attempt as `reply` says, delivering
 * to every open subscription right after the publish. `honourAuthors: false` is a relay that ignores
 * the filter and hands over everything addressed to this operator.
 */
function watchPool(reply: (id: string, attempt: number, sent: string[]) => Event[], { honourAuthors = true } = {}) {
  const sent: string[] = [];
  const filters: { authors?: string[] }[] = [];
  const subs: { authors?: string[]; onevent: (e: Event) => void; open: boolean }[] = [];
  const deliver = (event: Event) => {
    for (const s of subs) if (s.open && (!honourAuthors || !s.authors || s.authors.includes(event.pubkey))) s.onevent(event);
  };
  return {
    publish(urls: string[], event: { id: string }) {
      if (!sent.includes(event.id)) {
        sent.push(event.id);
        for (const e of reply(event.id, sent.length, [...sent])) queueMicrotask(() => deliver(e));
      }
      return urls.map(() => Promise.resolve('ok'));
    },
    subscribeMany(
      _urls: string[],
      filter: { authors?: string[] },
      params: { onevent: (e: Event) => void; oneose?: () => void }
    ) {
      filters.push(filter);
      const sub = { authors: filter.authors, onevent: params.onevent, open: true };
      subs.push(sub);
      queueMicrotask(() => params.oneose?.());
      return {
        close() {
          sub.open = false;
        }
      };
    },
    close() {},
    deliver,
    filters,
    get attempts() {
      return sent.length;
    },
    sentIds: () => [...sent]
  };
}

/** A `Distress` to `address` on that pool until it ends, or until `stopAfterMs` of backoff, with every phase. */
async function drive(
  pool: ReturnType<typeof watchPool>,
  address: WatchtowerAddress,
  opts: { stopAfterMs?: number; localExhaustedAfterMs?: number } = {}
) {
  const controller = new AbortController();
  const phases: DistressPhase[] = [];
  let clock = 0;
  const result = await sendDistressUntilAcknowledged(
    pool as never,
    ['wss://r'],
    OPERATOR,
    OUR_PUBKEY,
    address,
    { position: null, area: 'north side' },
    {
      ackWindowMs: 5,
      backoffMs: 1_000,
      maxBackoffMs: 1_000,
      localExhaustedAfterMs: opts.localExhaustedAfterMs ?? 600_000,
      clock: () => clock,
      sleep: async (ms: number) => {
        await new Promise((r) => setTimeout(r, 5));
        clock += ms;
        if (clock > (opts.stopAfterMs ?? 4_000)) controller.abort();
      },
      signal: controller.signal,
      onPhase: (p) => phases.push(p)
    }
  ).catch((e: unknown) => e);
  const names = phases.map((p) => p.phase);
  const said = <K extends DistressPhase['phase']>(k: K) => phases.filter((p) => p.phase === k) as Extract<DistressPhase, { phase: K }>[];
  return { result, phases, names, said };
}

describe("a squad's watch: only a holder's own signature ends a Distress", () => {
  it('an answer the watch key signed and nobody else did is said, and the phone keeps sending', async () => {
    // Somebody who ever held the watch key, telling an operator in trouble that Wren has it.
    const pool = watchPool((id) => [response(WATCH, [id], human('Wren'))]);
    const { names, said, result } = await drive(pool, SQUAD);

    expect(names, 'a forged answer ended the Distress').not.toContain('acknowledged');
    expect(result, 'it ended on that answer').toBeInstanceOf(Error);
    expect(pool.attempts, 'it stopped sending').toBeGreaterThan(2);
    const unconfirmed = said('human-unconfirmed');
    expect(unconfirmed.length, 'said each time it came').toBe(pool.attempts);
    expect(unconfirmed[0]!.response.responder.callsign, 'said as it was said').toBe('Wren');
    expect(unconfirmed[0]!.response.text).toBe('Wren is responding.');
    expect(unconfirmed[0]!.earlier).toBeUndefined();
    expect(names, 'an answer, though not one that closes: the window was not silent').not.toContain('no-answer');
  });

  it("ends on a holder's own signature over this answer, and says how it knows", async () => {
    const pool = watchPool((id, attempt) => (attempt === 2 ? [holderAnswer(RAVEN, [id], human('Raven', 'on my way'))] : []));
    const { said, result } = await drive(pool, SQUAD);

    const ended = said('acknowledged');
    expect(ended).toHaveLength(1);
    expect(ended[0]!.by).toBe('holder');
    expect((result as ResponsePayload).text).toBe('on my way');
    expect(pool.attempts).toBe(2);
  });

  it('does not end on a signature from a key that is not one of its holders', async () => {
    // Taken off the list, and still holding the watch key: they sign for themselves, correctly.
    const pool = watchPool((id) => [holderAnswer(FORMER, [id], human('Wren'))]);
    const { names, said } = await drive(pool, SQUAD);
    expect(names).not.toContain('acknowledged');
    expect(said('human-unconfirmed').length).toBeGreaterThan(0);
    expect(pool.attempts).toBeGreaterThan(2);
  });

  it("does not end on a holder's signature carried onto other words", async () => {
    const pool = watchPool((id) => {
      const signed = signAnswer(WREN, { watch: WATCH_PUBKEY, operator: OUR_PUBKEY, ids: [id] }, human('Wren', 'Running late, 40 min'));
      return [response(WATCH, [id], { ...signed, text: 'Wren is with you now.' })];
    });
    const { names, said } = await drive(pool, SQUAD);
    expect(names).not.toContain('acknowledged');
    expect(said('human-unconfirmed')[0]!.response.text, 'said as it came, not as it was signed').toBe('Wren is with you now.');
  });

  it("does not end on a holder's signature carried onto another attempt", async () => {
    // Wren signed an answer to attempt one, which never reached this phone; whoever kept it
    // replays her signed words to every attempt after it, under the watch key.
    let first: ResponsePayload | null = null;
    const pool = watchPool((id, attempt) => {
      if (attempt === 1) {
        first = signAnswer(WREN, { watch: WATCH_PUBKEY, operator: OUR_PUBKEY, ids: [id] }, human('Wren'));
        return [];
      }
      return [response(WATCH, [id], first!)];
    });
    const { names, said } = await drive(pool, SQUAD);
    expect(names).not.toContain('acknowledged');
    expect(pool.attempts).toBeGreaterThan(2);
    expect(said('human-unconfirmed').length, 'each replay said as unconfirmed').toBe(pool.attempts - 1);
  });

  it("does not let a report the watch key signs join this run to a ladder nobody runs", async () => {
    // A former member says this run's attempt joined "ladder" X, then Wren's real answer to X — an
    // earlier Distress of this operator's — would read as an answer to this one.
    const earlier = 'e'.repeat(64);
    const pool = watchPool((id, attempt) =>
      attempt === 1
        ? [response(WATCH, [id, earlier], node('Paging Wren.'))]
        : attempt === 2
          ? [holderAnswer(WREN, [earlier], human('Wren', 'Acknowledged 20 min ago.'))]
          : []
    );
    const { names } = await drive(pool, SQUAD);
    expect(names, 'an answer to an earlier Distress ended this one').not.toContain('acknowledged');
    expect(pool.attempts).toBeGreaterThan(2);
  });

  it("says an unconfirmed answer about an earlier Distress is about an earlier one", async () => {
    const earlier = 'e'.repeat(64);
    const pool = watchPool((id) => [response(WATCH, [id, earlier], human('Wren', 'Acknowledged 20 min ago.'))]);
    const { said } = await drive(pool, SQUAD, { stopAfterMs: 1_500 });
    expect(said('human-unconfirmed')[0]!.earlier).toBe(true);
  });

  it('still says nobody is answering, once, though unconfirmed answers keep coming', async () => {
    const pool = watchPool((id) => [response(WATCH, [id], human('Wren'))]);
    const { said } = await drive(pool, SQUAD, { stopAfterMs: 8_000, localExhaustedAfterMs: 3_000 });
    expect(said('nobody-answering'), 'the phone never said nobody had come').toHaveLength(1);
    expect(said('human-unconfirmed').length).toBeGreaterThan(3);
  });
});

describe("a box that names its executor: only the executor's own key ends a Distress", () => {
  it('listens for the executor beside the watch key', async () => {
    const pool = watchPool(() => []);
    await drive(pool, BOX, { stopAfterMs: 500 });
    expect(pool.filters.length).toBeGreaterThan(0);
    for (const f of pool.filters) expect(f.authors).toEqual([WATCH_PUBKEY, EXECUTOR_PUBKEY]);
  });

  it("ends on a person's answer the executor signed with its own key", async () => {
    const pool = watchPool((id, attempt) => (attempt === 2 ? [response(EXECUTOR, [id], human('Wren'))] : []));
    const { said, result } = await drive(pool, BOX);
    expect(said('acknowledged').map((p) => p.by)).toEqual(['executor']);
    expect((result as ResponsePayload).responder.callsign).toBe('Wren');
    expect(pool.attempts).toBe(2);
  });

  it('does not end on one the watch key signed: the daemon beside the agent holds that key', async () => {
    const pool = watchPool((id) => [response(WATCH, [id], { ...human('Wren'), ladder: 'acknowledged' })]);
    const { names, said } = await drive(pool, BOX);
    expect(names).not.toContain('acknowledged');
    expect(said('human-unconfirmed').length).toBeGreaterThan(0);
    expect(pool.attempts).toBeGreaterThan(2);
  });

  it("joins a ladder only on the executor's report of it, never the watch key's", async () => {
    // The watch key says attempt one joined X; the executor's held answer to X is then a person's
    // answer to an earlier Distress, not this one.
    const earlier = 'e'.repeat(64);
    const forged = watchPool((id, attempt) =>
      attempt === 1
        ? [response(WATCH, [id, earlier], node('Paging Wren.'))]
        : attempt === 2
          ? [response(EXECUTOR, [id, earlier], { ...human('Wren', 'Acknowledged 20 min ago.'), ladder: 'acknowledged' })]
          : []
    );
    const a = await drive(forged, BOX);
    expect(a.names).not.toContain('acknowledged');
    expect(a.names, 'the executor said a person answered an earlier Distress').toContain('acknowledged-earlier');

    // The executor's own report of the same thing is believed, as the watch key's was before.
    const real = watchPool((id, attempt) =>
      attempt === 1
        ? [response(EXECUTOR, [id, earlier], node('Paging Wren.'))]
        : attempt === 2
          ? [response(EXECUTOR, [earlier], human('Wren'))]
          : []
    );
    const b = await drive(real, BOX);
    expect(b.said('acknowledged').map((p) => p.by)).toEqual(['executor']);
  });

  it("says the executor's report once when the watch key's copy of it follows", async () => {
    const pool = watchPool((id) => {
      const own = response(EXECUTOR, [id], node('Paging Wren.'));
      // The copy's words differ here only so the test can tell which one was said.
      const copy = response(WATCH, [id], watchCopy(node('Paging Wren. (copy)'), own.id));
      return [own, copy];
    });
    const { said } = await drive(pool, BOX, { stopAfterMs: 1_500 });
    const texts = said('watch-status').map((p) => p.response.text);
    expect(texts.length, 'said once per attempt, and only once').toBe(pool.attempts);
    expect(texts.every((t) => t === 'Paging Wren.'), `said: ${texts.join(' | ')}`).toBe(true);
  });

  it("says a watch-key response whose copy_of names another of the watch key's, rather than passing it over", async () => {
    // Only what the executor's own key signed is an original a copy can repeat.
    const pool = watchPool((id) => {
      const first = response(WATCH, [id], node('Paging Wren.'));
      return [first, response(WATCH, [id], watchCopy(node('Paging Raven.'), first.id))];
    });
    const { said } = await drive(pool, BOX, { stopAfterMs: 1_500 });
    const texts = said('watch-status').map((p) => p.response.text);
    expect(texts).toContain('Paging Wren.');
    expect(texts, 'dropped without a word').toContain('Paging Raven.');
  });

  it("marks a ladder report the watch key signed, and never the executor's own or an old box's", async () => {
    // The daemon beside the agent saying the roster is being paged, beside the executor saying so.
    const box = watchPool((id) => [response(EXECUTOR, [id], node('Paging Wren.')), response(WATCH, [id], node('Paging Raven.'))]);
    const a = await drive(box, BOX, { stopAfterMs: 1_500 });
    const marks = Object.fromEntries(a.said('watch-status').map((p) => [p.response.text, p.unconfirmed ?? false]));
    expect(marks).toEqual({ 'Paging Wren.': false, 'Paging Raven.': true });

    const exhausted = watchPool((id) => [response(WATCH, [id], node("Couldn't reach anyone.", 'exhausted'))]);
    expect((await drive(exhausted, BOX, { stopAfterMs: 1_500 })).said('watch-exhausted')[0]!.unconfirmed).toBe(true);
    const squad = watchPool((id) => [response(WATCH, [id], node('Paging Wren.'))]);
    expect((await drive(squad, SQUAD, { stopAfterMs: 1_500 })).said('watch-status')[0]!.unconfirmed, 'nothing runs a ladder on a squad').toBe(true);
    const old = watchPool((id) => [response(WATCH, [id], node('Paging Wren.'))]);
    expect((await drive(old, OLD_BOX, { stopAfterMs: 1_500 })).said('watch-status')[0]!.unconfirmed).toBeUndefined();
  });

  it("ends on the executor's answer though the watch key's copy of it came first, and was said as unconfirmed", async () => {
    const pool = watchPool((id, attempt) => {
      if (attempt !== 2) return [];
      const own = response(EXECUTOR, [id], { ...human('Wren'), ladder: 'acknowledged' });
      return [response(WATCH, [id], watchCopy({ ...human('Wren'), ladder: 'acknowledged' }, own.id)), own];
    });
    const { names, said } = await drive(pool, BOX);
    expect(said('acknowledged').map((p) => p.by)).toEqual(['executor']);
    expect(names, 'the copy was dropped without a word').toContain('human-unconfirmed');
    expect(names.indexOf('human-unconfirmed')).toBeLessThan(names.indexOf('acknowledged'));
    expect(pool.attempts).toBe(2);
  });

  it("says the watch key's copy when the executor's own never arrived, and it does not close", async () => {
    // A relay that refused the executor's key, say. Heard, never closure, never silence.
    const pool = watchPool((id) => [
      response(WATCH, [id], watchCopy(node('Paging Wren.'), 'c'.repeat(64))),
      response(WATCH, [id], watchCopy({ ...human('Wren'), ladder: 'acknowledged' }, 'd'.repeat(64)))
    ]);
    const { names, said } = await drive(pool, BOX, { stopAfterMs: 1_500 });
    expect(said('watch-status').map((p) => p.response.text)).toContain('Paging Wren.');
    expect(said('human-unconfirmed').length).toBeGreaterThan(0);
    expect(names).not.toContain('acknowledged');
  });
});

describe("a watch that names neither keeps today's rule, and says so", () => {
  it('ends on a person the watch key signed, and says that is all it knows', async () => {
    const pool = watchPool((id) => [response(WATCH, [id], human('Wren'))]);
    const { said } = await drive(pool, OLD_BOX);
    expect(said('acknowledged').map((p) => p.by)).toEqual(['watch-key']);
    expect(pool.attempts).toBe(1);
  });

  it('is told apart from one whose closure is attributed', () => {
    expect(distressClosure(OLD_BOX)).toEqual({ attributed: false, executor: null, holders: [] });
    expect(distressClosure(BOX)).toEqual({ attributed: true, executor: EXECUTOR_PUBKEY, holders: [] });
    expect(distressClosure(SQUAD)).toEqual({
      attributed: true,
      executor: null,
      holders: [getPublicKey(WREN), getPublicKey(RAVEN)]
    });
    // The watch key listed as a holder is not a holder's own key: that is the key everybody had.
    expect(distressClosure(watchtowerAt(WATCH_PUBKEY, [WATCH_PUBKEY])).attributed).toBe(false);
  });

  it('reads an executor that is not a key as none, rather than a key nobody can sign as', () => {
    // Off the curve: past the field prime, and below it but with no point there — a typo's odds.
    for (const bad of ['zz', 'F'.repeat(63), WATCH_PUBKEY, '', 'f'.repeat(64), 'ff'.repeat(32), OFF_CURVE]) {
      expect(executorOf(watchtowerAt(WATCH_PUBKEY, undefined, undefined, bad)), bad).toBeNull();
    }
    expect(executorOf(watchtowerAt(WATCH_PUBKEY, undefined, undefined, EXECUTOR_PUBKEY.toUpperCase()))).toBe(EXECUTOR_PUBKEY);
  });

  it('a box naming an executor key off the curve keeps the old rule, rather than never ending', async () => {
    for (const bad of ['f'.repeat(64), OFF_CURVE]) {
      const address = watchtowerAt(WATCH_PUBKEY, undefined, undefined, bad);
      expect(distressClosure(address), bad).toEqual({ attributed: false, executor: null, holders: [] });
      const pool = watchPool((id) => [response(WATCH, [id], human('Wren'))]);
      const { said } = await drive(pool, address);
      expect(said('acknowledged').map((p) => p.by), `${bad}: a person's answer never ended it`).toEqual(['watch-key']);
      for (const f of pool.filters) expect(f.authors, 'asked a relay for a key nobody holds').toEqual([WATCH_PUBKEY]);
    }
  });
});

describe('a box that names no executor, as every box did before', () => {
  it('a Distress names the watch alone in its filter where no executor is named, as before', async () => {
    const pool = watchPool(() => []);
    await drive(pool, OLD_BOX, { stopAfterMs: 500 });
    for (const f of pool.filters) expect(f.authors).toEqual([WATCH_PUBKEY]);
  });

  it('a person answering an old box is never asked for a holder signature it cannot have', async () => {
    // Wren's answer carries a signature from a key that is no holder here: the old rule ignores it.
    const pool = watchPool((id) => [holderAnswer(FORMER, [id], human('Wren'))]);
    const { said } = await drive(pool, OLD_BOX);
    expect(said('acknowledged').map((p) => p.by)).toEqual(['watch-key']);
  });

});

describe('a relay that ignores the authors filter', () => {
  it("never lets a stranger's sealed 'a person has it' reach the operator, on any watch", async () => {
    // Every watch in the field today names neither: there, only the author check and the key the
    // answer is opened with stand between a stranger and an operator told a person has it.
    for (const [name, address] of [['old box', OLD_BOX], ['box', BOX], ['squad', SQUAD]] as const) {
      const pool = watchPool((id) => [response(STRANGER, [id], human('Wren', 'Stranger here.'))], { honourAuthors: false });
      const { names, phases } = await drive(pool, address, { stopAfterMs: 1_500 });
      expect(names, `${name}: a stranger ended the Distress`).not.toContain('acknowledged');
      const shown = phases.some((p) => 'response' in p && p.response.text === 'Stranger here.');
      expect(shown, `${name}: a stranger's words were shown as the watch's`).toBe(false);
      expect(pool.attempts, `${name}: it stopped sending`).toBeGreaterThan(1);
    }
  });

  it("still ends on the watch's own answer there, as before", async () => {
    const pool = watchPool(
      (id) => [response(STRANGER, [id], human('Raven', 'Stranger here.')), response(WATCH, [id], human('Wren'))],
      { honourAuthors: false }
    );
    const { said } = await drive(pool, OLD_BOX);
    expect(said('acknowledged').map((p) => p.response.responder.callsign)).toEqual(['Wren']);
  });
});
