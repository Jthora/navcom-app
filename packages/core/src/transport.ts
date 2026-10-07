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
import { sealToGroup, type WatchtowerAddress } from './crypto/group.js';
import type { SecretKey } from './crypto/keys.js';
import { KIND_DISTRESS, KIND_RESPONSE, KIND_SIGNAL, type SignalType } from './events/kinds.js';
import { checkedText, type DistressPayload, type SignalPayload } from './events/signal.js';
import type { ResponsePayload } from './events/response.js';

export class PublishError extends Error {}

/**
 * The addresses this pool can parse. A subscription across several relays is refused whole when
 * any one address is malformed, which turned one typo into "nobody answered" from every relay.
 */
function parseable(relays: string[]): string[] {
  return relays.filter((url) => {
    try {
      normalizeURL(url);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Throws when no relay accepted. Silence downstream would otherwise be misdiagnosed.
 *
 * **One relay at a time.** nostr-tools normalises the whole list before it opens anything, so one
 * address it cannot parse threw for every relay at once — a typo on one line of a watch config
 * made every Distress attempt read "never left the phone" while the other relays were fine.
 * Published one by one, a bad address is one refusal among the rest [audit: relay paths, F01].
 */
async function publishOrThrow(pool: SimplePool, relays: string[], event: Event): Promise<void> {
  const results = await Promise.allSettled(
    relays.flatMap((url) => {
      try {
        return pool.publish([url], event);
      } catch (e) {
        return [Promise.reject(e)];
      }
    })
  );
  if (results.some((r) => r.status === 'fulfilled')) return;
  const reasons = results
    .map((r) => (r.status === 'rejected' ? String(r.reason) : null))
    .filter((r): r is string => r !== null);
  throw new PublishError(
    `Failed to publish to any relay (${relays.length} tried): ${reasons.join('; ') || 'unknown error'}`
  );
}

export async function sendSignal(
  pool: SimplePool,
  relays: string[],
  secret: SecretKey,
  watchtower: WatchtowerAddress,
  type: SignalType,
  payload: SignalPayload
): Promise<Event> {
  // Enforced here, not only in buildSignal/buildDistress: this is the path every real
  // sender actually uses (the terminal and the CLI both call this, not the builders), and
  // an unchecked path is a cap that only exists in the tests that exercise it.
  checkedText(payload);
  const event = finalizeEvent(
    {
      kind: KIND_SIGNAL,
      // Type unencrypted so a client can filter without decrypting; payload sealed to
      // whoever holds the watch.
      tags: [['p', watchtower.pubkey], ['t', type]],
      content: sealToGroup(secret, watchtower.holders, payload, watchtower.kem),
      created_at: Math.floor(Date.now() / 1000)
    },
    secret
  );
  await publishOrThrow(pool, relays, event);
  return event;
}

export async function sendDistress(
  pool: SimplePool,
  relays: string[],
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
  onSigned?: (event: Event) => void
): Promise<Event> {
  checkedText(payload);
  const event = finalizeEvent(
    {
      kind: KIND_DISTRESS,
      // No `t` tag: identified by kind, so a subscriber filtering signal types cannot miss it.
      tags: [['p', watchtower.pubkey]],
      content: sealToGroup(secret, watchtower.holders, payload, watchtower.kem),
      created_at: Math.floor(Date.now() / 1000)
    },
    secret
  );
  onSigned?.(event);
  await publishOrThrow(pool, relays, event);
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
 */
export function waitForResponse(
  pool: SimplePool,
  relays: string[],
  secret: SecretKey,
  ourPubkey: string,
  /**
   * The Watchtower **address**, not a holder.
   *
   * A response is signed by the watch identity and sealed straight back to the one operator
   * who asked, so the return leg has no group envelope: there is exactly one recipient and
   * wrapping a key for them would be overhead with no membership to express.
   */
  watchtower: string,
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
        parseable(relays),
        {
          kinds: [KIND_RESPONSE],
          authors: [watchtower],
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
            try {
              const payload = open<ResponsePayload>(secret, watchtower, event.content);
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

export type DistressPhase =
  | { phase: 'sending'; attempt: number }
  | { phase: 'sent'; attempt: number }
  | { phase: 'unreachable'; attempt: number; error: string }
  /** Nothing answered this attempt — not a person, not an agent, not the watch's ladder. */
  | { phase: 'no-answer'; attempt: number }
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
   */
  | { phase: 'watch-status'; attempt: number; response: ResponsePayload }
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
   * Distress, and a human who answers late still counts.
   */
  | { phase: 'watch-exhausted'; attempt: number; response: ResponsePayload }
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
   * **Nobody is coming, and the device worked that out by itself.**
   *
   * Failure mode 4 in `escalation.spec.md`: `EXHAUSTED` must reach the operator's own
   * device even with no watch and no network. Every other phase here describes what the
   * node said; this one is what the phone concluded when the node said nothing at all —
   * which is the case where the operator most needs to be told, and the one where the node
   * is least able to tell them.
   *
   * Emitted **once**, and it does not stop anything. Retrying continues, because only the
   * operator ends a Distress. It is a message, not a state.
   */
  | { phase: 'nobody-answering'; attempt: number; elapsedMs: number }
  | { phase: 'acknowledged'; response: ResponsePayload };

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

/** A pool that can hand over its relay, as `SimplePool` does, and may refuse to connect. */
interface OwnRelayPool {
  ensureRelay?: SimplePool['ensureRelay'];
  allowConnectingToRelay?: (url: string, operation: ['read', unknown[]]) => boolean;
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
 */
export async function sendDistressUntilAcknowledged(
  pool: SimplePool,
  relays: string[],
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
   */
  const laddered = new Set<string>();
  /** An id that is this Distress's: one it sent, or a ladder the watch said it is part of. */
  const ours = (id: string) => sent.has(id) || laddered.has(id);
  /** Verified ids already handled — one relay and the next deliver the same event. */
  const heardIds = new Set<string>();
  /** A person's answer to this Distress. Ends it. */
  let latched: ResponsePayload | null = null;

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
    const named = event.tags.filter((t) => t[0] === 'e').map((t) => t[1] ?? '');
    if (!named.some(ours)) return;
    let response: ResponsePayload;
    try {
      response = open<ResponsePayload>(secret, watchtower.pubkey, event.content);
    } catch {
      return; // Not for us.
    }
    heardIds.add(event.id);
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
      if (named.every(ours) || named.some((id) => laddered.has(id))) {
        latched = response;
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
      // answer: one claiming `acknowledged` is a person's to make, and adds nothing here.
      if (response.ladder !== 'acknowledged') for (const id of named) if (id) laddered.add(id);
      if (response.ladder === 'exhausted') {
        report({ phase: 'watch-exhausted', attempt, response });
        // Nothing is left of that ladder to wait on, so the backoff is not waited out.
        if (waiting?.exhaustedEnds) waiting.controller.abort();
      } else {
        report({ phase: 'watch-status', attempt, response });
      }
      return;
    }
    if (!agentSaidNow) {
      agentSaidNow = true;
      report({ phase: 'agent-holding', attempt, response });
    }
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
   * **Subscribed on the relay itself** where the pool can hand it over, as the box's listener is
   * [#3]. The pool's own wrapper calls `reason.startsWith(...)` on every close, so a relay that
   * sent `CLOSED` with a reason that was not a string — `null`, or the `{}` a JavaScript relay
   * makes of an Error — threw there: the listener never heard the close and never came back. A
   * pool without `ensureRelay` (the fakes in tests) is subscribed through `subscribeMany`.
   *
   * **And it never opens again once the Distress is over** [#1] — finished, or stopped by the
   * operator. A burn stops the Distress before it destroys the pool, and a listener that came
   * back through the destroyed pool would put this operator's key and their watch's on the wire
   * a second after the phone was meant to have gone quiet.
   *
   * The filter is deliberately wide and the narrowing happens in the handler, against the ids
   * this Distress has sent. A filter cannot be widened after it is opened, and what lives in a
   * handler can be tested anywhere.
   */
  const RESPONSES = { kinds: [KIND_RESPONSE], authors: [watchtower.pubkey], '#p': [ourPubkey] };
  interface Listening {
    sub: { close(reason?: string): void } | null;
    /** True once its own `onclose` has fired, or once this closed it. Never closed twice. */
    closed: boolean;
    /** The wait before it is opened again. */
    wait: number;
  }
  const listeners = new Map<string, Listening>();
  const reopening = new Map<string, ReturnType<typeof setTimeout>>();
  const own = pool as unknown as OwnRelayPool;

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
    const entry: Listening = { sub: null, closed: false, wait };
    listeners.set(url, entry);
    const handlers = {
      onevent: heard,
      // Any reason at all, of any type: it is wire data.
      onclose: () => {
        entry.closed = true;
        reopenLater(url, entry);
      }
    };

    if (typeof own.ensureRelay !== 'function') {
      try {
        entry.sub = pool.subscribeMany([url], RESPONSES, handlers);
      } catch {
        // Unparseable: it would fail identically every time. Not retried, never fatal.
        listeners.delete(url);
      }
      return;
    }
    // A pool that has been told not to connect — a burned one — is not argued with.
    if (own.allowConnectingToRelay?.(url, ['read', [RESPONSES]]) === false) {
      listeners.delete(url);
      return;
    }
    own.ensureRelay.call(pool, url, { connectionTimeout: LISTENER_CONNECT_MS }).then(
      (relay) => {
        // Over, or superseded, while it was connecting: there is nothing to open.
        if (over() || listeners.get(url) !== entry || entry.closed) return;
        if (!relay.connected) {
          entry.closed = true;
          reopenLater(url, entry);
          return;
        }
        try {
          entry.sub = relay.subscribe([RESPONSES], handlers);
        } catch {
          entry.closed = true;
          reopenLater(url, entry);
        }
      },
      () => {
        if (listeners.get(url) !== entry) return;
        entry.closed = true;
        reopenLater(url, entry);
      }
    );
  };

  /** Opens again, now, any listener that has closed. An attempt going out is a moment the network is being used anyway. */
  const relisten = () => {
    for (const [url, entry] of listeners) if (entry.closed) listen(url, entry.wait);
  };

  /** Closes every listener and stops every reopen. Safe to call twice. */
  const silence = () => {
    for (const timer of reopening.values()) clearTimeout(timer);
    reopening.clear();
    for (const entry of listeners.values()) {
      if (entry.closed) continue;
      entry.closed = true;
      entry.sub?.close();
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

  const acknowledged = (response: ResponsePayload): ResponsePayload => {
    say({ phase: 'acknowledged', response });
    return response;
  };

  // One listener per relay however it is spelled, and none for an address the pool cannot parse:
  // that fails the same way every time, and the attempt's own send already says so.
  const urls = [...new Set(parseable(relays).map((url) => normalizeURL(url)))];
  opts.signal?.addEventListener('abort', silence, { once: true });
  for (const url of urls) listen(url);

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
      relisten();

      say({ phase: 'sending', attempt });
      held = [];
      let left = false;
      try {
        await sendDistress(pool, relays, secret, watchtower, payload, (signed) => {
          // Recorded before it is sent, so an answer that beats a slow relay's OK names an id
          // this loop knows [audit: relay paths, D2 review].
          sent.add(signed.id);
        });
        left = true;
        say({ phase: 'sent', attempt });
      } catch (e) {
        say({ phase: 'unreachable', attempt, error: e instanceof Error ? e.message : String(e) });
      } finally {
        const meanwhile = held ?? [];
        held = null;
        for (const phase of meanwhile) say(phase);
      }
      if (latched) return acknowledged(latched);
      if (stopped()) throw cancelled();

      if (left) {
        await pause(ackWindow, false);
        if (latched) return acknowledged(latched);
        if (stopped()) throw cancelled();
        if (!answeredNow) report({ phase: 'no-answer', attempt });
      }

      // Said once, and it changes nothing. The loop keeps going because only the operator
      // ends a Distress — but an operator who knows nobody is coming can act on that, and one
      // who is still watching attempt numbers tick up has been told nothing useful.
      const elapsedMs = clock() - startedAt;
      if (!saidNobodyAnswering && elapsedMs >= localExhaustedAfter) {
        saidNobodyAnswering = true;
        report({ phase: 'nobody-answering', attempt, elapsedMs });
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
