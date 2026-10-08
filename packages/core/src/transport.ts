/**
 * Sending signals, and the one that must not be allowed to fail quietly.
 *
 * Promoted from the CLI so the terminal and the daemon share one implementation. The
 * publish-failure distinction is theirs and it matters: a signal that never left the device
 * is a different emergency from one that left and went unanswered, and reporting the second
 * when the first happened sends an operator looking in the wrong place.
 */

import type { Event } from 'nostr-tools/core';
import { finalizeEvent, verifyEvent } from 'nostr-tools/pure';
import type { SimplePool } from 'nostr-tools/pool';
import { normalizeURL } from 'nostr-tools/utils';

import { open } from './crypto/envelope.js';
import { executorOf, sealToWatch, watchtowerAt, type WatchtowerAddress } from './crypto/group.js';
import { isPubkey, type SecretKey } from './crypto/keys.js';
import { KIND_DISTRESS, KIND_RESPONSE, KIND_SIGNAL, type SignalType } from './events/kinds.js';
import { checkedText, type DistressPayload, type SignalPayload } from './events/signal.js';
import { answerSignedByResponder, type ResponsePayload } from './events/response.js';
import { CLOCK_TOLERANCE_SECONDS, STALE_AFTER_SECONDS } from './events/watch-state.js';
import { whyNotListable } from './relays.js';

/** A relay address, and something said about it: why it refused, or why nothing was sent there. */
export interface RelayReason {
  /** The address, as it was given. */
  url: string;
  /** One line of plain text. Often a relay's own words, and so wire data: clipped, never markup. */
  reason: string;
}

/**
 * Why a relay did not take an event. Three different things, and a screen must not say one for
 * another [review: G3 phase 1]:
 *
 * - `refused`: it answered, and the answer was no -- `OK false`, in its own words (`blocked: …`)
 * - `unconfirmed`: it was handed the event and said nothing in time, or its connection dropped while
 *   the event was out. **It may have it.** A relay on a congested cell that says OK after nostr-tools
 *   has stopped waiting holds the event, and was accounted as having refused a `Distress` it carried
 * - `unreached`: it was never handed the event. The connection failed, this pool would not connect,
 *   or the `Distress` was over before the event went
 */
export type RelayFailure = 'refused' | 'unconfirmed' | 'unreached';

/** What one relay said when it was handed one event. */
export interface RelayAnswer {
  /** The address, as it was given. */
  url: string;
  /** It said OK: it took the event. */
  ok: boolean;
  /** Present exactly when `ok` is false: which of the three ways it did not take it. */
  failure?: RelayFailure;
  /**
   * What it said, or what stood in for it: a relay's reason (`blocked: …`, `rate-limited: …`),
   * `publish timed out`, or why it could not be reached. Usually empty on an OK; never empty
   * otherwise.
   */
  reason: string;
}

/** Where one event went, relay by relay, once every relay has answered or run out of time. */
export interface PublishResult {
  /** One for each relay it was handed to, in the order given, each relay once however it was spelled. */
  answers: RelayAnswer[];
  /** Each address it was never handed to, and why: a mission relay, or one this pool cannot parse. */
  withheld: RelayReason[];
}

export class PublishError extends Error {
  /** Where it went: every relay refused it, could not be reached, or ran out of time. */
  readonly result?: PublishResult;

  constructor(message: string, result?: PublishResult) {
    super(message);
    this.result = result;
  }
}

/**
 * How long one relay may take over one publish before it is accounted as not having answered.
 *
 * nostr-tools gives up sooner by itself -- three seconds to connect and 4.4 to say OK -- so this
 * bounds only a pool that does not. Every attempt is accounted for, and this is what makes that a
 * promise rather than a hope.
 */
const PUBLISH_ACCOUNT_MS = 10_000;

/** The longest reason passed on, as given. A relay chooses what it puts there. */
const REASON_MAX = 200;
/** Control, line-separator and direction-override characters: nothing a reason needs, all of them ways to mislead. */
// eslint-disable-next-line no-control-regex
const UNPRINTABLE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;

/** Whatever a relay or the pool gave as a reason, as one clipped line of plain text. */
function reasonText(reason: unknown): string {
  let text = '';
  if (typeof reason === 'string') text = reason;
  else if (reason instanceof Error) text = reason.message;
  else if (Array.isArray(reason)) {
    // The pool's own close, one `{ url, reason }` per relay.
    const first = reason[0] as { reason?: unknown } | undefined;
    if (typeof first?.reason === 'string') text = first.reason;
  }
  text = text.replace(UNPRINTABLE, ' ').replace(/\s+/g, ' ').trim();
  return text.length > REASON_MAX ? `${text.slice(0, REASON_MAX - 1)}…` : text;
}

/** What stands in for a reason nobody gave, by what happened. */
const UNSAID: Record<RelayFailure, string> = {
  refused: 'refused, with no reason given',
  unconfirmed: 'no answer',
  unreached: 'not sent'
};

/**
 * What a failed publish means, from what the pool gave as its reason.
 *
 * nostr-tools 2.24 rejects with an `Error` carrying the relay's own words for an `OK false`, and with
 * words of its own for everything else: `publish timed out`; `relay connection …` when the socket went
 * while the event was out; a `SendingOnClosedConnection` when it went before; and a bare string,
 * `connection failure: …`, when it never connected. Its words are matched exactly. A version that
 * changed them would read every failure as a refusal, as all of them read before this, and the
 * real-pool tests would say so.
 */
function whatFailed(reason: unknown): RelayFailure {
  if (reason instanceof Error) {
    if (reason.name === 'SendingOnClosedConnection') return 'unreached';
    if (reason.message === 'publish timed out' || reason.message.startsWith('relay connection ')) return 'unconfirmed';
    return 'refused';
  }
  if (typeof reason === 'string' && /^(connection failure|connection skipped|duplicate url)/.test(reason)) {
    return 'unreached';
  }
  // Nothing says the relay answered no, or that it was never handed the event.
  return 'unconfirmed';
}

/** Whatever was given as an address, as text -- even an entry that cannot be made into any. */
function printable(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return String(value);
  } catch {
    // An object with no prototype, or a hostile `toString`: a caller's bug, never a fatal one.
    return '(an address that cannot be printed)';
  }
}

/** An address, as given, kept short enough to quote back. */
function addressText(url: unknown): string {
  const text = printable(url).replace(UNPRINTABLE, ' ').trim();
  return text.length > REASON_MAX ? `${text.slice(0, REASON_MAX - 1)}…` : text;
}

/** One relay, as given and as the pool will dial it. */
interface Relay {
  url: string;
  key: string;
}

/**
 * The relays an event may go to, each once however it is spelled, and those it may not.
 *
 * **Once, because nostr-tools keys a publish by the event's id on each connection.** Two spellings of
 * one relay -- `wss://r` and `wss://r/` -- were two publishes over one socket, the second replaced the
 * first's place in that table, and the first never settled: `allSettled` waited for ever, and a
 * `Distress` sat at its first attempt, saying nothing more, for as long as the phone was open.
 */
function sortRelays(relays: readonly unknown[]): { tried: Relay[]; withheld: (RelayReason & { key: string })[] } {
  const tried: Relay[] = [];
  const withheld: (RelayReason & { key: string })[] = [];
  const seen = new Set<string>();
  for (const url of relays) {
    const why = whyNotListable(url);
    let key: string;
    if (typeof url !== 'string') {
      // Never the key of a real address: `42` must not stand in for `wss://42` and push it out.
      key = `unparseable:${typeof url}:${printable(url)}`;
    } else {
      try {
        key = normalizeURL(url.trim());
      } catch {
        key = `unparseable:${url}`;
      }
    }
    if (seen.has(key)) continue;
    seen.add(key);
    if (why === null) tried.push({ url: url as string, key });
    else withheld.push({ url: addressText(url), reason: why, key });
  }
  return { tried, withheld };
}

/** Said of an attempt still waiting on its relay's listener when the `Distress` ended. */
const NOT_SENT_OVER = 'not sent: the Distress was over before it went';

/**
 * Hands one event to one relay, and says what it said -- always, within {@link PUBLISH_ACCOUNT_MS}.
 *
 * `gate`, when given, is waited on first: the listener on a relay this `Distress` has not used yet.
 * `ended` is asked when the gate opens, and **an attempt still waiting when the `Distress` ends is
 * never handed over** [review: G3 phase 1]. It went out after a stand-down, a wipe or a person's
 * answer, to a relay nothing had listened on, and was dialled afresh when that relay's listener had
 * failed to connect.
 */
function answerOf(
  pool: SimplePool,
  url: string,
  event: Event,
  gate?: Promise<void>,
  ended?: () => boolean
): Promise<RelayAnswer> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok: boolean, reason: unknown, failure: RelayFailure = 'unconfirmed') => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const text = reasonText(reason);
      resolve(ok ? { url, ok, reason: text } : { url, ok, failure, reason: text || UNSAID[failure] });
    };
    const timer = setTimeout(
      () => finish(false, `no answer from the relay in ${PUBLISH_ACCOUNT_MS / 1_000}s`, 'unconfirmed'),
      PUBLISH_ACCOUNT_MS
    );
    const go = () => {
      if (done) return;
      if (ended?.()) {
        finish(false, NOT_SENT_OVER, 'unreached');
        return;
      }
      let pending: unknown;
      try {
        pending = pool.publish([url], event);
      } catch (e) {
        // An address nostr-tools cannot use throws for the whole call: one refusal, not every one.
        finish(false, e, 'unreached');
        return;
      }
      const each = Array.isArray(pending) ? (pending as unknown[]) : [];
      if (each.length === 0) {
        finish(false, 'the pool did not send it', 'unreached');
        return;
      }
      let failed = 0;
      const why: string[] = [];
      const how = new Set<RelayFailure>();
      for (const one of each) {
        Promise.resolve(one).then(
          (said) => finish(true, said),
          (e: unknown) => {
            how.add(whatFailed(e));
            // Its own words quote the whole event back; that it never went is all worth saying.
            const text =
              e instanceof Error && e.name === 'SendingOnClosedConnection'
                ? 'the connection closed before it was sent'
                : reasonText(e);
            if (text) why.push(text);
            if (++failed === each.length) {
              // One promise per relay from a real pool. For more, the likeliest that it has it.
              finish(false, why.join('; '), how.has('unconfirmed') ? 'unconfirmed' : how.has('refused') ? 'refused' : 'unreached');
            }
          }
        );
      }
    };
    if (gate) gate.then(go, go);
    else go();
  });
}

/** One event on its way: when it first left, who has it so far, and where it went once every relay has answered. */
interface Publishing {
  /** True at the first relay's OK; false once every relay has refused, failed or run out of time. */
  left: Promise<boolean>;
  settled: Promise<PublishResult>;
  /** Each relay that has said OK so far, as the pool dials it. It grows until `settled`. */
  took: ReadonlySet<string>;
}

/**
 * Hands an event to each relay on its own, and hears each answer [audit: relay paths, F01].
 *
 * nostr-tools normalises a whole list before it opens anything, so one address it could not parse
 * threw for every relay at once: a typo on one line of a watch config made every `Distress` attempt
 * read "never left the phone" while the other relays were fine. One by one, a bad address is one
 * refusal among the rest -- and an address `whyNotListable` refuses is never handed over at all.
 */
function publishEach(
  pool: SimplePool,
  relays: readonly unknown[],
  event: Event,
  how: { gate?: (key: string) => Promise<void> | undefined; ended?: () => boolean } = {}
): Publishing {
  const { tried, withheld } = sortRelays(relays);
  const took = new Set<string>();
  let leave!: (left: boolean) => void;
  const left = new Promise<boolean>((resolve) => {
    leave = resolve;
  });
  const answers = tried.map(({ url, key }) =>
    answerOf(pool, url, event, how.gate?.(key), how.ended).then((answer) => {
      if (answer.ok) {
        took.add(key);
        leave(true);
      }
      return answer;
    })
  );
  const settled = Promise.all(answers).then((list) => {
    leave(list.some((a) => a.ok));
    return { answers: list, withheld: withheld.map(({ url, reason }) => ({ url, reason })) };
  });
  return { left, settled, took };
}

/** Why nothing took it, relay by relay. */
function failureOf(result: PublishResult): string {
  const why = [
    ...result.answers.map((a) => `${a.url}: ${a.reason || 'refused, with no reason given'}`),
    ...result.withheld.map((w) => `${w.url}: not sent, ${w.reason}`)
  ];
  return `Failed to publish to any relay (${result.answers.length} tried): ${why.join('; ') || 'no relay was given'}`;
}

/**
 * Hands an event to every relay it may go to, and says what each said. Throws when none took it,
 * because silence downstream would otherwise be misdiagnosed.
 */
async function publishOrThrow(pool: SimplePool, relays: readonly unknown[], event: Event): Promise<PublishResult> {
  const result = await publishEach(pool, relays, event).settled;
  if (result.answers.some((a) => a.ok)) return result;
  throw new PublishError(failureOf(result), result);
}

/** A caller's own callback, which must not turn a signal that left into one that did not. */
function tell(onPublished: ((result: PublishResult) => void) | undefined, result: PublishResult): void {
  try {
    onPublished?.(result);
  } catch {
    /* the caller's to fix; the signal is out either way */
  }
}

export async function sendSignal(
  pool: SimplePool,
  relays: readonly string[],
  secret: SecretKey,
  watchtower: WatchtowerAddress,
  type: SignalType,
  payload: SignalPayload,
  /**
   * Told where it went, relay by relay, once every relay has answered or run out of time. A signal
   * no relay took throws a {@link PublishError} carrying the same, so both outcomes say which relay
   * refused it and why.
   */
  onPublished?: (result: PublishResult) => void
): Promise<Event> {
  // Enforced here, not only in buildSignal/buildDistress: this is the path every real
  // sender actually uses (the terminal and the CLI both call this, not the builders), and
  // an unchecked path is a cap that only exists in the tests that exercise it.
  checkedText(payload);
  const event = finalizeEvent(
    {
      kind: KIND_SIGNAL,
      // Type unencrypted so a client can filter without decrypting; payload sealed to
      // whoever holds the watch, and to the executor's own key for what it acts on.
      tags: [['p', watchtower.pubkey], ['t', type]],
      content: sealToWatch(secret, watchtower, payload, type),
      created_at: Math.floor(Date.now() / 1000)
    },
    secret
  );
  tell(onPublished, await publishOrThrow(pool, relays, event));
  return event;
}

/** A `Distress`, signed and sealed to whoever holds the watch. */
function sealDistress(secret: SecretKey, watchtower: WatchtowerAddress, payload: DistressPayload): Event {
  checkedText(payload);
  return finalizeEvent(
    {
      kind: KIND_DISTRESS,
      // No `t` tag: identified by kind, so a subscriber filtering signal types cannot miss it.
      tags: [['p', watchtower.pubkey]],
      content: sealToWatch(secret, watchtower, payload, 'distress'),
      created_at: Math.floor(Date.now() / 1000)
    },
    secret
  );
}

export async function sendDistress(
  pool: SimplePool,
  relays: readonly string[],
  secret: SecretKey,
  watchtower: WatchtowerAddress,
  payload: DistressPayload,
  /**
   * Told the event once it is signed, before it is sent.
   *
   * An answer can come back before every relay has said OK — one slow relay takes up to seven
   * seconds to give up — and a caller that learns the id only when the publish settles throws
   * that answer away as naming a signal it never sent [audit: relay paths, D2 review].
   */
  onSigned?: (event: Event) => void,
  /** Told where it went, relay by relay, as {@link sendSignal}'s is. */
  onPublished?: (result: PublishResult) => void
): Promise<Event> {
  const event = sealDistress(secret, watchtower, payload);
  onSigned?.(event);
  tell(onPublished, await publishOrThrow(pool, relays, event));
  return event;
}

/**
 * Waits for the `20912` addressed to us that answers `sent`.
 *
 * For a signal asked once — a `Query`, an `Assist`, a sign-on. **A `Distress` does not use it**:
 * a wait that resolves on the first answer was the slot a daemon's instant agent acknowledgement
 * took on every attempt, and everything the ladder said after it — "nobody has been woken"
 * included — was dropped [audit: relay paths, #31, #32]. `sendDistressUntilAcknowledged` learns
 * every answer from its own listener instead.
 *
 * It asks no relay that `whyNotListable` refuses: the signal was never sent there, so no answer can
 * come from there, and the request would name this operator's key to a relay that keeps logs.
 */
export function waitForResponse(
  pool: SimplePool,
  relays: readonly string[],
  secret: SecretKey,
  ourPubkey: string,
  /**
   * The Watchtower **address**, not a holder: its pubkey, or the whole address.
   *
   * A response is signed by the watch identity and sealed straight back to the one operator
   * who asked, so the return leg has no group envelope: there is exactly one recipient and
   * wrapping a key for them would be overhead with no membership to express.
   *
   * **Pass the address where the watch names its executor.** The executor answers the signals it
   * acts on — a `wake-others`, an acknowledgement — with its own key, and a wait given only the
   * pubkey asks for the watch key's answers alone: it hears the executor only through the watch
   * key's copy, and not at all where there is none.
   */
  watchtower: string | WatchtowerAddress,
  /**
   * The signal being answered, or several: a response naming any of them is accepted.
   *
   * **Responses are ephemeral, and relays keep them briefly or not at all** — strfry for five
   * minutes, most never — so this hears only what arrives while it is open. An answer published
   * before it opened, or after it closed, is gone [audit: relay paths, F25].
   */
  sent: Event | readonly Event[],
  timeoutMs: number,
  /** Ends the wait at once when the operator stops, rather than after the whole window. */
  signal?: AbortSignal
): Promise<ResponsePayload> {
  const answering = (Array.isArray(sent) ? sent : [sent as Event]) as readonly Event[];
  const address = typeof watchtower === 'string' ? watchtowerAt(watchtower) : watchtower;
  const authors = answeringKeys(address);
  return new Promise((resolve, reject) => {
    let done = false;
    let closer: { close(): void } | null = null;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      // Assigned below; guarded because a synchronous failure can land here first.
      closer?.close();
      fn();
    };

    const timer = setTimeout(
      () => finish(() => reject(new Error(`No response from Watchtower within ${timeoutMs}ms`))),
      timeoutMs
    );
    const stop = () => finish(() => reject(new Error('Stopped by the operator')));
    if (signal?.aborted) {
      stop();
      return;
    }
    signal?.addEventListener('abort', stop, { once: true });

    try {
      closer = pool.subscribeMany(
        relays.filter((url) => whyNotListable(url) === null),
        {
          kinds: [KIND_RESPONSE],
          authors,
          '#p': [ourPubkey],
          '#e': answering.map((e) => e.id)
          // No `since`. It would have to be derived from this device's own clock, and a
          // fast client clock silently filters out a real, on-time response server-side
          // before the client ever sees it — a false "nobody answered" when somebody did.
          // The `#e` tag already narrows to exactly the responses to this one signal, so
          // `since` was never load-bearing for correctness: nothing could reference this
          // event's id before it existed.
        },
        {
          onevent(event) {
            // Defence in depth, matching the daemon's check on incoming signals. Decryption
            // already authenticates the sender through NIP-44's shared secret, so this is
            // not load-bearing — it is an inconsistency worth closing rather than a hole.
            if (!verifyEvent(event)) return;
            // Only the watch, or its executor: a relay that ignores the filter is no way in. And
            // opened with the key this side knows for that author, never the event's own claim.
            if (!authors.includes(event.pubkey)) return;
            try {
              const payload = open<ResponsePayload>(secret, sealedBy(address, event.pubkey), event.content);
              finish(() => resolve(payload));
            } catch {
              // Undecryptable means not for us. Keep waiting rather than failing.
            }
          }
        }
      );
    } catch (err) {
      // A synchronous failure (a malformed relay URL, say) would otherwise leave the timer
      // armed to fire into nothing minutes after the real error was reported.
      finish(() => reject(err instanceof Error ? err : new Error(String(err))));
      return;
    }
    if (done) closer.close();
  });
}

/**
 * The keys that answer for this watch: the watch key, and the executor's own where the watch names
 * one. What a listener asks a relay for, and the only authors it reads.
 */
export function answeringKeys(address: WatchtowerAddress): string[] {
  const executor = executorOf(address);
  return executor ? [address.pubkey, executor] : [address.pubkey];
}

/**
 * The key an answer from `author` was sealed by, as this side knows it: the executor's own where the
 * executor signed it, and the watch key's for anything else — so an answer signed by anybody else is
 * opened with the watch key, and fails.
 */
function sealedBy(address: WatchtowerAddress, author: string): string {
  const executor = executorOf(address);
  return executor && author === executor ? executor : address.pubkey;
}

/**
 * Whose answer ended a `Distress`, as this phone could tell [`escalation.spec.md`, *Who may close a
 * Distress*]:
 *
 * - `executor`: signed by the escalation executor's own key, which only it holds
 * - `holder`: carrying the signature of one of the holders this phone was handed, made with their own
 *   key, on this answer to these attempts
 * - `watch-key`: signed by the watch key and nothing more, on a watch that names neither. Today's
 *   rule, kept for a watch handed over before it named its executor: the daemon beside the agent, and
 *   anybody who ever held the watch key, can send that
 */
export type ClosedBy = 'executor' | 'holder' | 'watch-key';

/** Who may end a `Distress` sent to one watch. */
export interface DistressClosure {
  /**
   * Whether a person's answer has to be attributable before it ends a `Distress`: to the executor's
   * own key, or to a holder's own signature.
   *
   * **False only for a watch that names neither**: a box handed over before it named its executor.
   * It keeps the rule it had, and a screen says so — *this watch does not yet name its escalation
   * key* — because on it, the daemon the agent runs beside can end a `Distress`.
   */
  attributed: boolean;
  /** The executor's own key, or null when the watch names none. */
  executor: string | null;
  /**
   * The holders whose own signature on an answer ends a `Distress`: the keys handed over as holding
   * the watch, less the watch key itself and the executor's. Empty for a box, which is its own holder.
   */
  holders: string[];
}

/**
 * Who may end a `Distress` sent to this watch.
 *
 * A squad's holders are known the moment it is handed over, so its rule applies at once. A box's
 * executor key arrives with a watch handed over after it existed; until then, `attributed` is false.
 */
export function distressClosure(address: WatchtowerAddress): DistressClosure {
  const executor = executorOf(address);
  const watch = address.pubkey.toLowerCase();
  const holders = [
    ...new Set(address.holders.map((h) => (typeof h === 'string' ? h.trim().toLowerCase() : '')))
  ].filter((h) => isPubkey(h) && h !== watch && h !== executor);
  return { attributed: executor !== null || holders.length > 0, executor, holders };
}

export type DistressPhase =
  | { phase: 'sending'; attempt: number }
  /**
   * **The attempt left the phone: the first relay said OK.**
   *
   * Said at that OK, not once every relay has answered. One relay slow to answer -- nostr-tools
   * waits 4.4 seconds for an OK, and some relays take longer -- used to hold this, and the window
   * after it, for the whole of that time. Where the attempt went is `accounted`, once every relay
   * has answered or run out of time.
   */
  | { phase: 'sent'; attempt: number }
  /**
   * Nothing took it: no relay said OK. Every relay refused it, could not be reached or ran out of
   * time, or there was no relay it may go to. `error` names each, and why.
   *
   * **Not always "it never left."** A relay that says OK after nostr-tools has stopped waiting holds
   * the attempt. The attempt's `accounted`, said after this, puts each relay under `refused`,
   * `unconfirmed` (it may have it) or `unreached` (it does not).
   */
  | { phase: 'unreachable'; attempt: number; error: string }
  /**
   * Nothing answered this attempt — not a person, not an agent, not the watch's ladder — **and
   * this phone was listening, for the whole of its window, on a relay where an answer would
   * come**: a listener whose relay had answered it -- a real end-of-stored-events, or an event --
   * before the window began, and that was still open when it ended, on a relay `could-not-hear`
   * describes. When there was none, the attempt is `could-not-hear` instead.
   */
  | { phase: 'no-answer'; attempt: number }
  /**
   * **This attempt left, and this phone cannot say it was listening where an answer would come.**
   *
   * Said instead of `no-answer` when no listener heard the whole window on a relay where the watch
   * would answer. That is a relay the watch has been heard on in the last five minutes, when the
   * caller gives `watchStateAgeMs` and the watch has been heard on any; otherwise, a relay that took
   * this attempt. On every such relay, the listener was refused (one that wants AUTH refuses it at
   * once), dropped during the window, still waiting for its relay's end-of-stored-events when the
   * window began, or never answered at all. "No answer" there was a claim about the watch that was
   * really about the phone [G3 phase 1]: somebody may have answered, and the answer gone past.
   *
   * It is not proof that nothing was heard. A relay that takes a subscription and never ends its
   * stored events may still deliver live ones, and an answer that arrives is an answer, whatever
   * this said. The loop keeps sending, and keeps trying to listen.
   */
  | { phase: 'could-not-hear'; attempt: number }
  /**
   * **This phone is listening for answers on no relay, and an answer now would most likely be missed.**
   *
   * Said once when it becomes true: every listener has closed, failed to connect, or taken its
   * subscription and said nothing for ten seconds. `relays` is each relay this `Distress` is
   * using, with why it is not listening there -- a relay's own words where it gave any, such as
   * `auth-required: …`. Not closure, and nothing stops: attempts still go out. A listener that
   * closed is opened again after a wait that grows to fifteen seconds, and at once with every
   * attempt; one whose relay took the subscription and has said nothing is closed and asked again
   * with every attempt.
   */
  | { phase: 'listening-nowhere'; attempt: number; relays: RelayReason[] }
  /**
   * **Listening again**, after `listening-nowhere`: a relay sent its end-of-stored-events, or an
   * event, on a listener that is still open. `relays` is each relay listening now.
   */
  | { phase: 'listening-again'; attempt: number; relays: string[] }
  /**
   * **From this attempt on, also sent to these relays.**
   *
   * When the relays are given as a function, it is read again before every attempt, and the set
   * only widens: a relay once used is used until the operator stands down. A listener is opened
   * on each new relay before this attempt is handed to it. Said before this attempt's `sending`.
   */
  | { phase: 'also-sending'; attempt: number; relays: string[] }
  /**
   * **Where an attempt went, once every relay has answered or run out of time.**
   *
   * `took` is each relay that said OK. Each relay that did not is in one of three lists, because
   * they are three different things ({@link RelayFailure}) [review: G3 phase 1]:
   *
   * - `refused`: it answered no, and `reason` is its own words (`blocked: …`)
   * - `unconfirmed`: it was handed the attempt and said nothing in time (`publish timed out`), or
   *   its connection dropped while the attempt was out. **It may have it**, and a screen must not
   *   call it a refusal
   * - `unreached`: it was never handed the attempt, because it could not be reached
   *
   * `withheld` is each address this `Distress` will not send to at all, and why: a mission relay,
   * or one this phone cannot parse. A relay left out is named, not silently gone.
   *
   * `heard`, only when the caller gave `watchStateAgeMs`: those of `took` that this phone has read
   * the watch's state from in the last five minutes. A relay that took the attempt but where the
   * watch has not been heard is a relay where nobody may be listening. It counts relays, never
   * people. Without the function the account says only which relays took it.
   *
   * It can arrive after the attempt's window, and after the next attempt's `sending`: `attempt`
   * says which it accounts for. Never said once the `Distress` is over.
   */
  | {
      phase: 'accounted';
      attempt: number;
      took: string[];
      refused: RelayReason[];
      unconfirmed: RelayReason[];
      unreached: RelayReason[];
      withheld: RelayReason[];
      heard?: string[];
    }
  /**
   * A response arrived, and it was an agent.
   *
   * Not closure. Invariant 5: an agent is never the sole responder to `Distress`, so this
   * proves the signal is getting through and nothing more — the loop keeps going. Said once
   * per attempt: a daemon acknowledges every attempt, and the line means the same each time.
   */
  | { phase: 'agent-holding'; attempt: number; response: ResponsePayload }
  /**
   * The watch's escalation ladder, saying where it is.
   *
   * Authored by the node — not a person, and not an agent — and shown as exactly that. Not
   * closure: the loop keeps going, because only a human ends a Distress. **Every** report is
   * said, as it arrives: "nobody has been woken" follows "Paging Wren." by one round trip, and a
   * loop that kept only the first answer of each attempt threw the second away [#31, #32].
   *
   * `unconfirmed` is set when it was not signed by whoever runs the ladder: the watch key, on a box
   * that names its executor — the executor's own copy lost on the way, or the daemon beside the agent
   * saying it — or on a squad's watch, where nothing runs one. Said as it was said, and marked so.
   */
  | { phase: 'watch-status'; attempt: number; response: ResponsePayload; unconfirmed?: true }
  /**
   * **Nobody is coming, and the watch said so.**
   *
   * The ladder reached `exhausted`: nobody on call answered and nobody is left to try. Shown
   * the moment it arrives. Before this existed the phone filed it under "an agent answered",
   * dropped its words, and the operator learned nothing until `nobody-answering` fired ten
   * minutes later — a working watch telling the truth at once, and the screen withholding it.
   *
   * Retrying still continues, and sooner: an exhausted ladder holds nothing, so the backoff
   * this lands in is cut short and the next attempt opens a fresh one. Only the operator ends a
   * Distress, and a human who answers late still counts. `unconfirmed` as for `watch-status`.
   */
  | { phase: 'watch-exhausted'; attempt: number; response: ResponsePayload; unconfirmed?: true }
  /**
   * **A person answered an earlier `Distress` from this operator — not this one.**
   *
   * For `ack_holds_seconds` after a human acknowledged, the executor answers a new `20911`
   * from that operator with the same acknowledgement, naming the new attempt *and* the one the
   * human answered (`escalation.spec.md`, *An acknowledged Distress, sent again*). When the one
   * the human answered is an id this run never sent, and the watch never said this run joined
   * its ladder, this run started after the answer: the app was reopened or the phone wiped once
   * the ladder was over, or this is a new emergency. The watch has not escalated it.
   *
   * A run that started while that ladder was still paging is not this case. The watch joined its
   * attempts to the ladder and said so, naming both, and a person answering that ladder answered
   * this run too [review: relay paths, R1].
   *
   * Said so, by name, and **not closure**: the loop keeps sending, because only a person
   * answering *this* Distress ends it [invariant 2]. Once the hold closes, a later attempt
   * opens a ladder and pages. It closed this run in under a tenth of a second, under the
   * heading "Answered", before this existed [#0].
   */
  | { phase: 'acknowledged-earlier'; attempt: number; response: ResponsePayload }
  /**
   * **An answer that says a person has it, and this phone cannot tell who sent it.**
   *
   * The watch names who may end a `Distress` ({@link distressClosure}): its executor's own key, or
   * the holders' own signatures. This answer came from neither. It is signed by the watch key alone
   * — which the daemon beside the agent holds, and so does everybody who ever held the watch — and
   * carries no holder's signature that checks, or one from a key this phone was not handed as a
   * holder. It may be true: a squad member's phone that has not taken the update yet answers this way.
   *
   * Said as it was said, with `response` — who it says answered and their words — and **never
   * closure** [invariant 2]: the loop keeps sending, and `nobody-answering` still comes once. `earlier`
   * is set when it also names an id this `Distress` never sent and never joined. Said each time one
   * arrives, as the watch's reports are.
   */
  | { phase: 'human-unconfirmed'; attempt: number; response: ResponsePayload; earlier?: true }
  /**
   * **Nobody is coming, and the device worked that out by itself.**
   *
   * Failure mode 4 in `escalation.spec.md`: `EXHAUSTED` must reach the operator's own
   * device even with no watch and no network. Every other phase here describes what the
   * node said; this one is what the phone concluded when the node said nothing at all —
   * which is the case where the operator most needs to be told, and the one where the node
   * is least able to tell them.
   *
   * **And it says when the phone could not hear**: `couldNotHear` is set when any attempt's
   * window passed with nothing listening (`could-not-hear`), with how many of the attempts that
   * left that was. Then "nobody answered" is partly, or wholly, "this phone could not have heard
   * them". Absent when every window was heard.
   *
   * Emitted **once**, and it does not stop anything. Retrying continues, because only the
   * operator ends a Distress. It is a message, not a state.
   */
  | {
      phase: 'nobody-answering';
      attempt: number;
      elapsedMs: number;
      couldNotHear?: { attempts: number; of: number };
    }
  /**
   * **A person answered this `Distress`, and it is over.** `by` is how this phone knows who
   * ({@link ClosedBy}); `watch-key` only on a watch that names neither its executor nor its holders.
   */
  | { phase: 'acknowledged'; response: ResponsePayload; by: ClosedBy };

export interface DistressOptions {
  /** How long to wait for an acknowledgement before publishing again. */
  ackWindowMs?: number;
  /** First backoff, doubled each attempt up to `maxBackoffMs`. */
  backoffMs?: number;
  maxBackoffMs?: number;
  /** Every transition. The operator is told what is happening, always. */
  onPhase?: (phase: DistressPhase) => void;
  /** Aborts the retry loop. Only an operator, or an acknowledgement, should do this. */
  signal?: AbortSignal;
  /**
   * How long without a human before the device says so on its own.
   *
   * Defaults to the ladder's whole budget — 300s paging plus 300s contact. Past that, a
   * working node would already have reported `EXHAUSTED`, so silence means the node is not
   * working and the phone is the only thing left that can tell the operator.
   */
  localExhaustedAfterMs?: number;
  /**
   * The backoff between attempts. Injected for tests so they do not wait in real time.
   *
   * Handed a signal that aborts when the operator stops, when a person answers, and when the
   * watch says nobody can be reached — the moments a backoff must not be waited out. A sleep
   * that ignores it only delays those: the loop looks again when it returns.
   */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Injected for tests. Real code has no business reading a clock it cannot control. */
  clock?: () => number;
  /**
   * How long ago this phone last read the watch's state from a relay, in milliseconds, or null when
   * it has read none there.
   *
   * Given, each attempt's `accounted` names which of the relays that took it the watch was heard
   * on in the last five minutes ({@link STALE_AFTER_SECONDS}); a state dated further ahead of this
   * phone's clock than {@link CLOCK_TOLERANCE_SECONDS} does not count. And each window is heard only
   * through a relay the watch was heard on, when it was heard on any (`could-not-hear`).
   *
   * Called with each address as it was first given: for each relay that took an attempt, when the
   * attempt is accounted for, and for each relay this `Distress` uses, as each window ends. Never
   * fatal: a throw counts as not heard.
   */
  watchStateAgeMs?: (url: string) => number | null | undefined;
}

/** Ends early when the signal aborts, so a stop never waits out a backoff of up to a minute. */
const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });

/** How long a listener waits for its relay to connect — the pool's own default for a subscription. */
const LISTENER_CONNECT_MS = 3_000;
/** The longest wait before a closed listener is opened again. */
const LISTENER_REOPEN_MAX_MS = 15_000;
/**
 * How long a relay may hold a listener's subscription without answering before it counts as not
 * listening. The box and the rest of the phone use the same ten seconds.
 */
const LISTENER_SILENT_MS = 10_000;
/** nostr-tools' longest timer, as a subscription's EOSE timeout: its stand-in for an EOSE never fires. */
const NEVER_MS = 2_147_483_647;

/** A pool that can hand over its relay, as `SimplePool` does, and may refuse to connect. */
interface OwnRelayPool {
  ensureRelay?: SimplePool['ensureRelay'];
  allowConnectingToRelay?: (url: string, operation: ['read', unknown[]]) => boolean;
}

/** Resolves when `p` does, or after `ms`, whichever is first. */
function within(p: Promise<void> | undefined, ms: number): Promise<void> | undefined {
  if (!p) return undefined;
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    p.then(done, done);
  });
}

/**
 * Sends `Distress` and **keeps sending until a human acknowledges it.**
 *
 * The spec requires retry with backoff, indefinitely, and that requirement is what makes an
 * ephemeral transport acceptable for the one signal that matters: relays do not store these
 * events, so a single failed publish is a signal nobody ever receives.
 *
 * It never gives up on its own. It reports every attempt, including the ones that failed to
 * leave the device — an operator who knows nothing is getting through can act on that, and
 * one who believes help is coming when it isn't has been misled at the worst moment.
 *
 * **A human ends this, not a response.** An agent answering is reported as
 * `agent-holding` and the loop continues, because invariant 2 says `Distress` terminates in
 * a human, and invariant 5 says an agent is never the sole responder. An agent ack that
 * stopped the retries would satisfy neither while looking, on screen, exactly like help.
 * A person answering an *earlier* Distress is `acknowledged-earlier`, and does not end it either.
 * A person answering a ladder the watch said this Distress joined is answering this one.
 *
 * **And only a person this phone can attribute** ({@link distressClosure}): an answer signed by the
 * executor's own key, or carrying a holder's own signature. One that says `human` and is neither is
 * `human-unconfirmed`, said as it was said, and the loop keeps sending. A watch that names neither
 * its executor nor its holders keeps the old rule, and `acknowledged` says so (`by: 'watch-key'`).
 *
 * The watch's own escalation ladder is neither, and is reported as `watch-status` — or
 * `watch-exhausted` the moment it says nobody can be reached, which the operator must learn
 * when the watch knows it rather than when this phone's timer runs out.
 *
 * **Every answer is learned from one place: a listener on each relay, open for the whole
 * Distress** [audit: relay paths, #31–#34]. Each attempt used to wait for the first answer naming
 * it and stop listening, so on a box whose daemon acknowledges every attempt at once, that
 * acknowledgement took the slot every time: the ladder's "nobody has been woken" a moment later
 * was dropped, a held human answer lost the race and waited out a backoff, and the screen said
 * "an agent answered" until the watch gave up five minutes on. Now an attempt's window ends
 * only when it runs out or a person answers, and everything the watch says is reported as it
 * arrives.
 *
 * **And what it says about answers is only as good as its listening** [G3 phase 1]. A
 * listener counts once its relay has sent a real end-of-stored-events. Nothing counted before:
 * a relay that wants AUTH closed the listener at once, it reopened for ever, and the screen said
 * "no answer" after every attempt and "nobody is answering" ten minutes on, about a phone that
 * could not have heard anybody. Now it says `could-not-hear`, and says when it is listening
 * nowhere and when it is listening again. A window counts as heard only through a listener whose
 * relay had answered it before the window began, on a relay where an answer would come.
 *
 * **Where it goes.** `relays` is a list, or a function returning one that is read again before
 * every attempt; the set only ever widens, and a new relay gets a listener before an attempt goes
 * there. The first attempt goes at once, to what was given, and waits on no read and no handshake.
 * Nothing is ever sent, or asked, where {@link whyNotListable} refuses -- The Record and its
 * mirrors above all -- and each attempt's `accounted` says so. Nothing more is handed to the pool
 * once the operator has stood down or a person has answered: an attempt still waiting on a new
 * relay's listener never goes. One the pool already holds, for a relay whose connection is still
 * opening, goes when it opens; the pool keeps no way to take it back.
 */
export async function sendDistressUntilAcknowledged(
  pool: SimplePool,
  relays: readonly string[] | (() => readonly string[]),
  secret: SecretKey,
  ourPubkey: string,
  watchtower: WatchtowerAddress,
  payload: DistressPayload,
  opts: DistressOptions = {}
): Promise<ResponsePayload> {
  const ackWindow = opts.ackWindowMs ?? 20_000;
  const maxBackoff = opts.maxBackoffMs ?? 60_000;
  const sleep = opts.sleep ?? defaultSleep;
  const say = opts.onPhase ?? (() => {});

  const clock = opts.clock ?? (() => Date.now());
  const localExhaustedAfter = opts.localExhaustedAfterMs ?? 600_000;
  const startedAt = clock();

  let backoff = opts.backoffMs ?? 2_000;
  let attempt = 0;
  let saidNobodyAnswering = false;
  /** Attempts that left and whose window ran out, and of those, how many this phone could not hear. */
  let windows = 0;
  let unheard = 0;

  /**
   * Every id this Distress has sent, uncapped.
   *
   * An answer naming any of them is an answer to this Distress, however late — somebody
   * arriving late is still somebody arriving. And it is what tells a person's answer to *this*
   * Distress from one to an earlier: a held acknowledgement names the attempt it reached and
   * the one the person answered, and only when the second is here, or in `laddered` below, did
   * they answer this one. The cap it once had served a relay filter that no longer exists, and a
   * capped list would read an answer to this run's first attempt, two hours on, as somebody
   * else's.
   */
  const sent = new Set<string>();
  /**
   * Ids the watch has named in a ladder report that also named one of this Distress's: the
   * ladders it is part of [review: relay paths, R1].
   *
   * A Distress started again while the first one's ladder was still paging — the app reopened or
   * evicted, the phone wiped and the Distress sent again, as the wipe screen says to — has its
   * attempts joined to that ladder, and the watch says so to each one, naming the attempt and the
   * ladder's own id. The person paged answers the id the page carried, which this run never sent.
   * Read against `sent` alone, that answer was dropped, the hold's repeat of it read as an answer
   * to an earlier Distress, and the phone went on sending for half an hour while Wren was on her
   * way; when the hold closed, the roster was paged again for the same emergency. The watch treats
   * these attempts as one Distress, and so does this.
   *
   * Only a report authored by the node feeds it, never a person's answer: that is the difference
   * between this run joining a ladder and the watch repeating an answer to one it never joined.
   * **And only one from whoever runs the ladder** ({@link speaksForLadder}): a report the watch key
   * signs, on a watch whose closure is attributed, could otherwise turn a person's answer to an
   * earlier `Distress` into an answer to this one.
   */
  const laddered = new Set<string>();
  /** An id that is this Distress's: one it sent, or a ladder the watch said it is part of. */
  const ours = (id: string) => sent.has(id) || laddered.has(id);
  /** Verified ids already handled — one relay and the next deliver the same event. */
  const heardIds = new Set<string>();
  /** Of those, the ones the executor's own key signed: what a watch-key copy can be a copy of. */
  const fromExecutor = new Set<string>();
  /** A person's answer to this Distress. Ends it. */
  let latched: ResponsePayload | null = null;
  /** How this phone knows who gave it. */
  let latchedBy: ClosedBy = 'watch-key';

  /**
   * **Who may end this `Distress`** [`escalation.spec.md`, *Who may close a Distress*].
   *
   * A `20912` saying `human` used to end it whenever the watch key had signed it. Every squad member
   * holds that key, and so does everybody who ever did, and on a box so does the daemon the agent
   * runs beside: any of them could tell an operator in trouble that a person had it, and the phone
   * stopped sending. Now an answer ends it only when this phone can say who gave it — the executor's
   * own key, or a holder's own signature on it — except on a watch that names neither, which keeps
   * the rule it had and says so.
   */
  const closure = distressClosure(watchtower);
  /** Who answers here: the watch key, and the executor's own key where the watch names one. */
  const speakers = answeringKeys(watchtower);
  const sealerFor = (author: string) => sealedBy(watchtower, author);
  /**
   * Whose ladder reports say which ladder these attempts are in: the executor's, where the watch names
   * it; the watch key's only on a watch that names nobody, as before. Nothing runs a ladder on a
   * squad's watch, so nothing there does.
   */
  const speaksForLadder = (author: string) =>
    closure.executor ? author === closure.executor : !closure.attributed && author === watchtower.pubkey;
  /** Who gave a person's answer, as far as this phone can tell, or null when it cannot. */
  const closedBy = (author: string, response: ResponsePayload, named: string[]): ClosedBy | null => {
    if (closure.executor && author === closure.executor) return 'executor';
    const signer = response.responder?.pubkey;
    if (
      typeof signer === 'string' &&
      closure.holders.includes(signer) &&
      answerSignedByResponder({ watch: watchtower.pubkey, operator: ourPubkey, ids: named }, response)
    ) {
      return 'holder';
    }
    return closure.attributed ? null : 'watch-key';
  };

  // What this attempt has heard, so "no answer" is said only when nothing answered, and an
  // agent, or an earlier acknowledgement, once per attempt rather than once per relay.
  let answeredNow = false;
  let agentSaidNow = false;
  let earlierSaidNow = false;

  /**
   * Phases heard while an attempt is still going out, said once it has.
   *
   * An answer can beat a slow relay's OK by seconds; said at once it would read "an agent
   * answered" above "left the phone", which is the wrong way round for somebody reading it.
   */
  let held: DistressPhase[] | null = null;
  const report = (phase: DistressPhase) => {
    if (held) held.push(phase);
    else say(phase);
  };

  let finished = false;
  /**
   * Whether the operator has ended it.
   *
   * Checked after every await, not only at the top of a pass. A pass is a send, a wait of up
   * to `ackWindowMs` and a sleep of up to `maxBackoffMs`, and a Distress a wipe had cancelled
   * went on for up to a minute: the send button stayed unavailable and late phases reached the
   * screen.
   */
  const stopped = () => opts.signal?.aborted === true;
  /** Nothing listens, and nothing is opened, once this is true: a burn means nothing left talking. */
  const over = () => finished || stopped();
  const cancelled = () => new Error('Distress cancelled by the operator');

  /** The wait in progress, so an answer can end it early. Only a backoff is ended by `exhausted`. */
  let waiting: { controller: AbortController; exhaustedEnds: boolean } | null = null;

  const heard = (event: Event) => {
    if (over() || latched || !verifyEvent(event) || heardIds.has(event.id)) return;
    // Only the watch, or its executor, answers here: a relay that ignores the filter is no way in.
    if (!speakers.includes(event.pubkey)) return;
    const named = event.tags.filter((t) => t[0] === 'e').map((t) => t[1] ?? '');
    if (!named.some(ours)) return;
    let response: ResponsePayload;
    try {
      // Sealed by whoever signed it, and opened with that key as this phone knows it: the
      // executor's where the executor signed, and the watch key's for anything else. Never with
      // `event.pubkey`, so the author check above is not the only thing between a stranger's
      // sealed "a person has it" and a watch that names nobody: it fails to open here too.
      response = open<ResponsePayload>(secret, sealerFor(event.pubkey), event.content);
    } catch {
      return; // Not for us.
    }
    heardIds.add(event.id);
    if (closure.executor && event.pubkey === closure.executor) fromExecutor.add(event.id);
    // The watch key's copy of a response this phone has already heard from the executor: said once.
    if (
      closure.executor &&
      event.pubkey !== closure.executor &&
      typeof response.copy_of === 'string' &&
      fromExecutor.has(response.copy_of)
    ) {
      return;
    }
    // An absent responder kind is treated as not-a-human. The spec requires the field on every
    // response, so a missing one is a broken responder, and guessing "human" there is the one
    // wrong guess this loop must never make.
    const kind = response.responder?.kind;

    if (kind === 'human') {
      /*
       * Only a person answering this Distress closes it [invariant 2]: every id they name is this
       * Distress's, or one of them is a ladder the watch said it is part of. The second covers a
       * held answer to another of this operator's attempts — a second phone, a second tab — that
       * names this run's own ladder beside an id this run never sent.
       */
      const thisOne = named.every(ours) || named.some((id) => laddered.has(id));
      /*
       * **And only an answer this phone can attribute** [G3]: the executor's own key, or a holder's
       * own signature. Anything else that says a person has it is said as it was said, and the
       * loop keeps sending. Shown, because it may be true; never closure, because anybody who ever
       * held the watch key can send it.
       */
      const by = closedBy(event.pubkey, response, named);
      if (by === null) {
        answeredNow = true;
        report({ phase: 'human-unconfirmed', attempt, response, ...(thisOne ? {} : { earlier: true as const }) });
        return;
      }
      if (thisOne) {
        latched = response;
        latchedBy = by;
        waiting?.controller.abort();
        return;
      }
      // Somebody answered a Distress this run never sent and never joined. Said; not closure [#0].
      answeredNow = true;
      if (!earlierSaidNow) {
        earlierSaidNow = true;
        report({ phase: 'acknowledged-earlier', attempt, response });
      }
      return;
    }

    answeredNow = true;
    if (kind === 'node') {
      // The watch saying which ladder these attempts are in. A ladder's report, not a repeated
      // answer: one claiming `acknowledged` is a person's to make, and adds nothing here. Only from
      // whoever runs the ladder.
      const ladderSaid = speaksForLadder(event.pubkey);
      if (response.ladder !== 'acknowledged' && ladderSaid) {
        for (const id of named) if (id) laddered.add(id);
      }
      // Said either way, and marked when it is not from whoever runs the ladder.
      const unsure = closure.attributed && !ladderSaid ? { unconfirmed: true as const } : {};
      if (response.ladder === 'exhausted') {
        report({ phase: 'watch-exhausted', attempt, response, ...unsure });
        // Nothing is left of that ladder to wait on, so the backoff is not waited out.
        if (waiting?.exhaustedEnds) waiting.controller.abort();
      } else {
        report({ phase: 'watch-status', attempt, response, ...unsure });
      }
      return;
    }
    if (!agentSaidNow) {
      agentSaidNow = true;
      report({ phase: 'agent-holding', attempt, response });
    }
  };

  /*
   * **Where it goes: every relay it has been given, in the order first given, and never fewer.**
   *
   * Read again before every attempt when `relays` is a function, so a watch that says it moved is
   * followed while a `Distress` runs. A relay that drops out of a later read is kept: a running
   * `Distress` never narrows, because the one it drops may be the one somebody is listening on.
   * An address that may not carry operator traffic is kept too, as `withheld`, so every account
   * names it and says why nothing went there.
   */
  const targets: Relay[] = [];
  const withheld = new Map<string, RelayReason>();
  const read = (): readonly unknown[] => {
    if (typeof relays !== 'function') return relays;
    try {
      const got: unknown = relays();
      return Array.isArray(got) ? got : [];
    } catch {
      // A broken read is no new relay, never a fatal one: the Distress keeps what it has.
      return [];
    }
  };
  const widen = (): Relay[] => {
    let sorted: ReturnType<typeof sortRelays>;
    try {
      sorted = sortRelays(read());
    } catch {
      // A list that throws while it is read, entry by entry, is no new relay, and never a fatal one:
      // an entry that could not be printed ended the Distress before its first attempt [review: G3
      // phase 1]. `sortRelays` survives any entry; this is for a list that will not be iterated.
      return [];
    }
    const { tried, withheld: refused } = sorted;
    const added: Relay[] = [];
    for (const relay of tried) {
      if (targets.some((known) => known.key === relay.key)) continue;
      targets.push(relay);
      added.push(relay);
    }
    for (const { key, url, reason } of refused) if (!withheld.has(key)) withheld.set(key, { url, reason });
    return added;
  };

  /*
   * **One listener per relay, open for the whole Distress, and each one heals itself**
   * [audit: relay paths, F03].
   *
   * Responses are ephemeral (`20912`), so relays do not store them: one published while nothing
   * is subscribed is not delayed, it is gone. The executor answers each later attempt with where
   * its ladder stands, or with a person's acknowledgement while it holds one — but a transition
   * between attempts (`exhausted`, or a person answering) is sent once, when it happens, a hold
   * lasts only `ack_holds_seconds` and not past a restart, and nothing re-sends an agent's answer.
   * So nothing here may depend on being subscribed at the right moment: this listener is.
   *
   * It used to be one subscription across every relay, opened once. The phone's pool does not
   * reconnect, so the first time every socket dropped — a network handoff, or the app set aside
   * to dial somebody — it was gone for the rest of the Distress and nothing said so. Per relay,
   * because a pool reports a subscription across several relays closed only once every one has
   * gone. A closed listener is opened again after a wait that doubles to fifteen seconds, and at
   * once when an attempt goes out.
   *
   * **A listener counts only once its relay has answered it**: a real end-of-stored-events, or an
   * event on it, and not closed since. nostr-tools fires a stand-in for an EOSE 4.4 seconds after a
   * request nobody answered; it is put out of reach, as the box's listener and the rest of the phone
   * already do (`relay-listener.ts`, `subscribe.ts`). A relay that takes the subscription and says
   * nothing for {@link LISTENER_SILENT_MS} counts as not listening. Its subscription is left open in
   * case it does, and is closed and asked again with the next attempt [review: G3 phase 1]: a
   * relay that dropped the request without a word was otherwise never asked again, however long the
   * Distress ran.
   *
   * **Subscribed on the relay itself** where the pool can hand it over, as the box's listener is
   * [#3]. The pool's own wrapper calls `reason.startsWith(...)` on every close, so a relay that
   * sent `CLOSED` with a reason that was not a string — `null`, or the `{}` a JavaScript relay
   * makes of an Error — threw there: the listener never heard the close and never came back. A
   * pool without `ensureRelay` (the fakes in tests) is subscribed through `subscribeMany`, and
   * counts once that subscription's `oneose` fires.
   *
   * **And it never opens again once the Distress is over** [#1] — finished, or stopped by the
   * operator. A burn stops the Distress before it destroys the pool, and a listener that came
   * back through the destroyed pool would put this operator's key and their watch's on the wire
   * a second after the phone was meant to have gone quiet.
   *
   * The filter is deliberately wide and the narrowing happens in the handler, against the ids
   * this Distress has sent. A filter cannot be widened after it is opened, and what lives in a
   * handler can be tested anywhere. Its authors are the watch key and, where the watch names one,
   * the executor's own key: the one whose answer ends a `Distress` on a box.
   */
  const RESPONSES = { kinds: [KIND_RESPONSE], authors: speakers, '#p': [ourPubkey] };
  interface Listening {
    sub: { close(reason?: string): void } | null;
    /** True once its own `onclose` has fired, or once this closed it. Never closed twice. */
    closed: boolean;
    /** Closed for good: it would fail the same way every time, or this pool connects to nothing. */
    final: boolean;
    /** The wait before it is opened again. */
    wait: number;
    /** Its relay answered it: a real end-of-stored-events, or an event on it. */
    answered: boolean;
    /** Taken and never answered for {@link LISTENER_SILENT_MS}. Still open, in case it does. */
    silent: boolean;
    silence: ReturnType<typeof setTimeout> | null;
    /** Why it is not listening, in its relay's words where it gave any. */
    why: string | null;
    /** Settles once the subscription has been handed to the relay, or could not be, or the Distress is over. */
    ready: Promise<void>;
    /** Settles `ready`. */
    release: () => void;
  }
  const listeners = new Map<string, Listening>();
  const reopening = new Map<string, ReturnType<typeof setTimeout>>();
  const own = pool as unknown as OwnRelayPool;

  /** What has been said about listening: once each way, so a relay retrying is not a line a second. */
  let hearing: 'unknown' | 'nowhere' | 'somewhere' = 'unknown';
  /** Says when this phone starts listening nowhere, and when it is listening again. */
  const changed = () => {
    if (over() || attempt === 0) return;
    const now = targets.map((relay) => ({ relay, entry: listeners.get(relay.key) }));
    const on = now.filter(({ entry }) => entry?.answered && !entry.closed).map(({ relay }) => relay.url);
    if (on.length > 0) {
      if (hearing === 'nowhere') report({ phase: 'listening-again', attempt, relays: on });
      hearing = 'somewhere';
      return;
    }
    // Still being asked: a relay that has not yet answered, failed or gone quiet may yet.
    if (now.some(({ entry }) => entry && !entry.closed && !entry.silent)) return;
    if (hearing === 'nowhere') return;
    hearing = 'nowhere';
    report({
      phase: 'listening-nowhere',
      attempt,
      relays: now.map(({ relay, entry }) => ({ url: relay.url, reason: entry?.why ?? 'not listening' }))
    });
  };

  const reopenLater = (url: string, entry: Listening) => {
    if (over() || listeners.get(url) !== entry || reopening.has(url)) return;
    const next = Math.min(entry.wait * 2, LISTENER_REOPEN_MAX_MS);
    reopening.set(
      url,
      setTimeout(() => {
        reopening.delete(url);
        listen(url, next);
      }, entry.wait)
    );
  };

  const listen = (url: string, wait = 1_000) => {
    if (over()) return;
    const pending = reopening.get(url);
    if (pending !== undefined) clearTimeout(pending);
    reopening.delete(url);
    let subscribed!: () => void;
    const ready = new Promise<void>((resolve) => {
      subscribed = resolve;
    });
    const entry: Listening = {
      sub: null,
      closed: false,
      final: false,
      wait,
      answered: false,
      silent: false,
      silence: null,
      why: null,
      ready,
      release: subscribed
    };
    listeners.set(url, entry);
    const current = () => !over() && listeners.get(url) === entry && !entry.closed;
    const quiet = () => {
      if (entry.silence) clearTimeout(entry.silence);
      entry.silence = null;
    };
    const answer = () => {
      if (!current() || entry.answered) return;
      entry.answered = true;
      entry.silent = false;
      entry.why = null;
      quiet();
      changed();
    };
    /** Gone: closed by its relay, dropped with its connection, or never opened. */
    const lost = (why: string, final = false) => {
      subscribed();
      if (entry.closed) return;
      entry.closed = true;
      entry.final = final;
      entry.why = why;
      quiet();
      if (listeners.get(url) !== entry) return;
      if (!final) reopenLater(url, entry);
      changed();
    };
    const handlers = {
      onevent: (event: Event) => {
        // An event on the subscription is the relay answering it, whether or not EOSE follows.
        if (!entry.answered) answer();
        heard(event);
      },
      // Deferred: nostr-tools' pool reports a failed subscription as an end-of-stored-events and a
      // close in the same moment, so only a subscription still open a moment later has answered.
      oneose: () => queueMicrotask(answer),
      // Any reason at all, of any type: it is wire data.
      onclose: (reason: unknown) => lost(reasonText(reason) || 'closed, with no reason given')
    };
    /** Handed to the relay. Said not listening if the relay takes it and says nothing. */
    const asked = () => {
      subscribed();
      if (!current() || entry.answered) return;
      entry.silence = setTimeout(() => {
        entry.silence = null;
        if (!current() || entry.answered) return;
        entry.silent = true;
        entry.why = `took the subscription and has not answered in ${LISTENER_SILENT_MS / 1_000}s`;
        changed();
      }, LISTENER_SILENT_MS);
    };

    if (typeof own.ensureRelay !== 'function') {
      try {
        entry.sub = pool.subscribeMany([url], { ...RESPONSES }, handlers);
      } catch (e) {
        // It would fail identically every time. Not retried, never fatal.
        lost(`could not subscribe: ${reasonText(e) || 'refused'}`, true);
        return;
      }
      asked();
      return;
    }
    // A pool that has been told not to connect — a burned one — is not argued with.
    if (own.allowConnectingToRelay?.(url, ['read', [RESPONSES]]) === false) {
      lost('this phone is not connecting to relays', true);
      return;
    }
    let connecting: ReturnType<SimplePool['ensureRelay']>;
    try {
      connecting = own.ensureRelay.call(pool, url, { connectionTimeout: LISTENER_CONNECT_MS });
    } catch (e) {
      lost(`could not connect: ${reasonText(e) || 'no reason given'}`);
      return;
    }
    connecting.then(
      (relay) => {
        // Over, or superseded, while it was connecting: there is nothing to open.
        if (!current()) {
          subscribed();
          return;
        }
        if (!relay.connected) {
          lost('the connection dropped as it opened');
          return;
        }
        try {
          // Only a real EOSE counts: the stand-in is put off as far as a timer goes, and then
          // cleared, because nostr-tools never clears it on close. The field is private in its
          // types and public at runtime; if it is renamed, NEVER_MS still holds the rule.
          const sub = relay.subscribe([{ ...RESPONSES }], { ...handlers, eoseTimeout: NEVER_MS });
          clearTimeout((sub as unknown as { eoseTimeoutHandle?: ReturnType<typeof setTimeout> }).eoseTimeoutHandle);
          entry.sub = sub;
        } catch (e) {
          lost(`could not subscribe: ${reasonText(e) || 'refused'}`);
          return;
        }
        asked();
      },
      (e: unknown) => {
        if (listeners.get(url) !== entry) {
          subscribed();
          return;
        }
        lost(`could not connect: ${reasonText(e) || 'no reason given'}`);
      }
    );
  };

  /** Lets go of a listener: closed, and nothing it says is heard. Safe to call twice. */
  const retire = (entry: Listening) => {
    if (entry.silence) clearTimeout(entry.silence);
    entry.silence = null;
    if (entry.closed) return;
    entry.closed = true;
    try {
      entry.sub?.close();
    } catch {
      /* it is gone either way */
    }
  };

  /**
   * Asks again, now, wherever this phone is not listening: on a relay whose listener closed, and on
   * one that took the subscription and has said nothing for {@link LISTENER_SILENT_MS}. An attempt
   * going out is a moment the network is being used anyway.
   *
   * A silent one is closed first and asked afresh [review: G3 phase 1]. A relay that dropped the
   * request without a word -- an older one at its subscription limit, saying so in a `NOTICE` -- was
   * never asked again, and the phone stayed deaf there for the whole Distress. One that kept the
   * request loses nothing by being asked again.
   */
  const relisten = () => {
    for (const [url, entry] of listeners) {
      if (entry.closed ? entry.final : !entry.silent) continue;
      retire(entry);
      listen(url, entry.wait);
    }
  };

  /** Closes every listener, stops every reopen, and lets nothing wait on a listener. Safe to call twice. */
  const silence = () => {
    for (const timer of reopening.values()) clearTimeout(timer);
    reopening.clear();
    for (const entry of listeners.values()) {
      retire(entry);
      // An attempt waiting on this listener learns at once that it goes nowhere.
      entry.release();
    }
  };

  /**
   * Waits `ms`, or less: until the operator stops, a person answers this Distress, or — for the
   * backoff only — the watch says nobody can be reached. The window is a timer of its own, so a
   * test's injected sleep stands only for the backoff, as it always has.
   */
  const pause = async (ms: number, exhaustedEnds: boolean) => {
    if (latched || stopped()) return;
    const controller = new AbortController();
    const forward = () => controller.abort();
    opts.signal?.addEventListener('abort', forward, { once: true });
    waiting = { controller, exhaustedEnds };
    try {
      await (exhaustedEnds ? sleep : defaultSleep)(ms, controller.signal);
    } finally {
      waiting = null;
      opts.signal?.removeEventListener('abort', forward);
    }
  };

  /**
   * Waits for an attempt to leave, or not, ending at once when the operator stops or a person
   * answers: a relay slow to say OK must not hold either of those. `ended` when it was cut short.
   */
  const leaving = async (going: Promise<boolean>): Promise<boolean | 'ended'> => {
    if (latched || stopped()) return 'ended';
    const controller = new AbortController();
    const forward = () => controller.abort();
    opts.signal?.addEventListener('abort', forward, { once: true });
    waiting = { controller, exhaustedEnds: false };
    try {
      return await Promise.race([
        going,
        new Promise<'ended'>((resolve) => controller.signal.addEventListener('abort', () => resolve('ended'), { once: true }))
      ]);
    } finally {
      waiting = null;
      opts.signal?.removeEventListener('abort', forward);
    }
  };

  /** Whether this phone read the watch's state from `url` in the last five minutes, as the caller says. */
  const heardWithin = (url: string): boolean => {
    let age: unknown;
    try {
      age = opts.watchStateAgeMs?.(url);
    } catch {
      return false;
    }
    return (
      typeof age === 'number' &&
      Number.isFinite(age) &&
      age >= -CLOCK_TOLERANCE_SECONDS * 1_000 &&
      age <= STALE_AFTER_SECONDS * 1_000
    );
  };

  /**
   * Where an answer to an attempt would come [review: G3 phase 1]: the relays the watch has been
   * heard on in the last five minutes, when the caller says and it has been heard on any; otherwise
   * the relays that took the attempt.
   *
   * The watch answers on its own relays, so a listener anywhere else hears nothing, however well it
   * listens. A relay that served this phone's request and refused every write, beside one that took
   * the attempt and refused the request, read as listening: "no answer" was said while Wren's
   * answer went past on the relay this phone could not read. And a watch heard nowhere is not a
   * phone that cannot hear. The attempts went where they went, and "could not hear" there would be
   * a hope that nothing supports.
   */
  const answerable = (took: ReadonlySet<string>): ReadonlySet<string> => {
    if (opts.watchStateAgeMs) {
      const on = targets.filter((relay) => heardWithin(relay.url)).map((relay) => relay.key);
      if (on.length > 0) return new Set(on);
    }
    return took;
  };

  const accountOf = (n: number, result: PublishResult, away: RelayReason[]): DistressPhase => {
    const took = result.answers.filter((a) => a.ok).map((a) => a.url);
    const not = (failure: RelayFailure): RelayReason[] =>
      result.answers
        .filter((a) => !a.ok && (a.failure ?? 'unconfirmed') === failure)
        .map(({ url, reason }) => ({ url, reason: reason || UNSAID[failure] }));
    return {
      phase: 'accounted',
      attempt: n,
      took,
      refused: not('refused'),
      unconfirmed: not('unconfirmed'),
      unreached: not('unreached'),
      withheld: away,
      ...(opts.watchStateAgeMs ? { heard: took.filter(heardWithin) } : {})
    };
  };

  const acknowledged = (response: ResponsePayload): ResponsePayload => {
    say({ phase: 'acknowledged', response, by: latchedBy });
    return response;
  };

  opts.signal?.addEventListener('abort', silence, { once: true });
  // The first attempt goes where it was given, at once, and waits on nothing [G3 phase 1].
  for (const relay of widen()) listen(relay.key);

  try {
    for (;;) {
      // A person's answer first, after every await: one heard a moment before a stand-down is
      // still the answer, and the operator is owed "Wren has it" rather than "nobody answered".
      if (latched) return acknowledged(latched);
      if (stopped()) throw cancelled();
      attempt++;
      answeredNow = false;
      agentSaidNow = false;
      earlierSaidNow = false;

      // A relay first named now is listened on before anything goes there, so an answer to this
      // attempt that arrives only there is not published to nobody.
      const added = attempt === 1 ? [] : widen();
      for (const relay of added) listen(relay.key);
      if (added.length > 0) say({ phase: 'also-sending', attempt, relays: added.map((r) => r.url) });
      relisten();
      changed();

      say({ phase: 'sending', attempt });
      held = [];
      let left = false;
      /** The relays that have taken this attempt so far. */
      let took: ReadonlySet<string> = new Set();
      try {
        const event = sealDistress(secret, watchtower, payload);
        // Recorded before it is sent, so an answer that beats a slow relay's OK names an id this
        // loop knows [audit: relay paths, D2 review].
        sent.add(event.id);
        const fresh = new Set(added.map((r) => r.key));
        const going = publishEach(pool, targets.map((r) => r.url), event, {
          gate: (key) => (fresh.has(key) ? within(listeners.get(key)?.ready, LISTENER_CONNECT_MS + 1_000) : undefined),
          // Nothing still waiting on a new relay's listener goes out once this is over, a person
          // having answered included [review: G3 phase 1].
          ended: () => over() || latched !== null
        });
        took = going.took;
        const n = attempt;
        const away = [...withheld.values()];
        void going.settled.then((result) => {
          if (!over()) report(accountOf(n, result, away));
        });
        const outcome = await leaving(going.left);
        if (outcome === true) {
          left = true;
          say({ phase: 'sent', attempt });
        } else if (outcome === false) {
          const result = await going.settled;
          say({ phase: 'unreachable', attempt, error: failureOf({ answers: result.answers, withheld: away }) });
        }
      } catch (e) {
        say({ phase: 'unreachable', attempt, error: e instanceof Error ? e.message : String(e) });
      } finally {
        const meanwhile = held ?? [];
        held = null;
        // Nothing is said once the operator has stood down, held or not: an `accounted` that
        // arrived while this attempt was going out reached the screen after "stopped" [review: G3
        // phase 1].
        if (!over()) for (const phase of meanwhile) say(phase);
      }
      if (latched) return acknowledged(latched);
      if (stopped()) throw cancelled();

      if (left) {
        /*
         * Who could hear this window: a listener whose relay had answered it before the window
         * began, and that is still open when it ends [review: G3 phase 1]. One still connecting
         * then, or still waiting on its relay's end-of-stored-events, was asked too late for an
         * answer sent at once -- an agent's hold comes within a second, and relays keep no `20912`
         * to hand a request that arrives after it. This can only err towards `could-not-hear`: a
         * relay that says OK before it ends a request's stored events costs the first window.
         */
        const listening = [...listeners].filter(([, entry]) => entry.answered && !entry.closed);
        await pause(ackWindow, false);
        if (latched) return acknowledged(latched);
        if (stopped()) throw cancelled();
        // ...and only where an answer would come.
        const where = answerable(took);
        const couldHear = listening.some(([key, entry]) => where.has(key) && !entry.closed);
        windows++;
        if (!answeredNow) {
          if (!couldHear) unheard++;
          report(couldHear ? { phase: 'no-answer', attempt } : { phase: 'could-not-hear', attempt });
        }
      }

      // Said once, and it changes nothing. The loop keeps going because only the operator
      // ends a Distress — but an operator who knows nobody is coming can act on that, and one
      // who is still watching attempt numbers tick up has been told nothing useful.
      const elapsedMs = clock() - startedAt;
      if (!saidNobodyAnswering && elapsedMs >= localExhaustedAfter) {
        saidNobodyAnswering = true;
        report({
          phase: 'nobody-answering',
          attempt,
          elapsedMs,
          ...(unheard > 0 ? { couldNotHear: { attempts: unheard, of: windows } } : {})
        });
      }

      await pause(backoff, true);
      if (latched) return acknowledged(latched);
      if (stopped()) throw cancelled();
      backoff = Math.min(backoff * 2, maxBackoff);
    }
  } finally {
    finished = true;
    opts.signal?.removeEventListener('abort', silence);
    silence();
  }
}
