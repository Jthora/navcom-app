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
  payload: DistressPayload
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
  await publishOrThrow(pool, relays, event);
  return event;
}

/** Waits for the `20912` addressed to us that answers `sent`. */
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
   * The signal being answered — or **every signal this Distress has sent so far**.
   *
   * One event is right for a Query or an Assist, which are asked once. A `Distress` is not:
   * it republishes as a **new signed event with a new id** every time nothing answers, and
   * listening only for a response to the newest id loses two real cases.
   *
   * A person woken at 3am takes longer than the 20s window to reach for a phone, so by the
   * time they acknowledge, the one they were paged about is no longer the one being listened
   * for — their answer is filtered out at the relay and the operator is told nothing. And
   * between windows the loop sleeps with no subscription open at all, so an answer arriving
   * in the gap is missed even when the id does match.
   *
   * Passing every id fixes the first: the response is accepted whichever signal it names. It
   * does not fix the second, though this once said it did. **Responses are ephemeral, and
   * relays keep them briefly or not at all** — strfry for five minutes, most never — so one
   * published in a gap reaches only a subscription already open. That is the Distress-long
   * listener in `sendDistressUntilAcknowledged`, not this wait [audit: relay paths, F25].
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
  | { phase: 'no-answer'; attempt: number }
  /**
   * A response arrived, and it was an agent.
   *
   * Not closure. Invariant 5: an agent is never the sole responder to `Distress`, so this
   * proves the signal is getting through and nothing more — the loop keeps going.
   */
  | { phase: 'agent-holding'; attempt: number; response: ResponsePayload }
  /**
   * The watch's escalation ladder, saying where it is.
   *
   * Authored by the node — not a person, and not an agent — and shown as exactly that. Not
   * closure: the loop keeps going, because only a human ends a Distress.
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
   * Retrying still continues. Only the operator ends a Distress, and a human who answers late
   * still counts.
   */
  | { phase: 'watch-exhausted'; attempt: number; response: ResponsePayload }
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
   * Injected for tests so they do not wait in real time. Handed the loop's `signal`, and a
   * sleep that ignores it only delays a stop — the loop checks again when it returns.
   */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Injected for tests. Real code has no business reading a clock it cannot control. */
  clock?: () => number;
}

/** Ends early when the operator stops, so a stop never waits out a backoff of up to a minute. */
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
 *
 * The watch's own escalation ladder is neither, and is reported as `watch-status` — or
 * `watch-exhausted` the moment it says nobody can be reached, which the operator must learn
 * when the watch knows it rather than when this phone's timer runs out.
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
  const report = opts.onPhase ?? (() => {});

  const clock = opts.clock ?? (() => Date.now());
  const localExhaustedAfter = opts.localExhaustedAfterMs ?? 600_000;
  const startedAt = clock();

  let backoff = opts.backoffMs ?? 2_000;
  let attempt = 0;
  let saidNobodyAnswering = false;

  /**
   * Every signal this Distress has published, so a late answer to any of them is still an
   * answer. Capped because a relay filter is not unbounded and a Distress can run for hours;
   * sixty-four covers about an hour of retries at this backoff, and an acknowledgement older
   * than every one of those is not the case anybody is trying to catch.
   */
  const outstanding: Event[] = [];
  const OUTSTANDING = 64;

  /**
   * One subscription, open for the whole `Distress`, beside the per-attempt one.
   *
   * The per-attempt wait listens for `ackWindowMs` and then the loop sleeps for the backoff
   * — twenty seconds of listening in every eighty at steady state. **Responses are ephemeral
   * (`20912`), so relays do not store them**: an acknowledgement published while nothing is
   * subscribed is not delayed, it is gone. Roughly three quarters of the window a human could
   * answer in had no listener at all, and the executor publishes an ack exactly once, on the
   * ladder's transition.
   *
   * The filter is deliberately wider than the per-attempt one and the narrowing happens in
   * the handler instead, against the ids actually outstanding. A filter cannot be widened
   * after it is opened, and this file's own history says the rest: what lives in a filter is
   * untested until it runs against a real relay, and what lives in a handler can be tested
   * anywhere.
   */
  let latched: ResponsePayload | null = null;
  /**
   * The watch saying nobody can be reached, heard on the always-open subscription.
   *
   * At default timings the per-attempt listener is closed from roughly 243s to 303s, and a
   * ladder with people on call reaches `exhausted` at about 300s — so the report that matters
   * most landed in that gap, was dropped, and the operator learned it from the phone's own
   * timer after all. Kept here and reported at the loop's next look, the way a late human
   * acknowledgement already was.
   */
  let heardExhausted: ResponsePayload | null = null;
  /** Whether the current ladder's `exhausted` has been reported, so it is said once. */
  let exhaustedShown = false;

  const heard = (event: Event) => {
    if (latched || !verifyEvent(event)) return;
    const answers = event.tags.filter((t) => t[0] === 'e').map((t) => t[1]);
    if (!outstanding.some((o) => answers.includes(o.id))) return;
    try {
      const payload = open<ResponsePayload>(secret, watchtower.pubkey, event.content);
      // Only a human closes a Distress [invariant 5]. An agent seen here changes
      // nothing; the per-attempt path already reports it when it lands in a window.
      if (payload.responder?.kind === 'human') latched = payload;
      // The one non-human report that must never be lost to the gap. It closes nothing.
      else if (payload.responder?.kind === 'node' && payload.ladder === 'exhausted') {
        heardExhausted = payload;
      }
    } catch {
      // Not for us.
    }
  };

  /*
   * **One listener per relay, and each one heals itself** [audit: relay paths, F03].
   *
   * The listener used to be one subscription across every relay, opened once. The phone's pool
   * does not reconnect, so the first time every socket dropped — a network handoff, or the app
   * set aside to dial somebody — the listener was gone for the rest of the Distress and nothing
   * said so. An acknowledgement that then landed between attempts was lost, and the watch,
   * hearing the next attempt, paged its roster again. Per relay, because a pool reports a
   * subscription across several relays closed only once every one of them has gone.
   *
   * A closed listener is reopened after a short wait that doubles to fifteen seconds, until
   * the Distress ends. An address this pool cannot parse is not retried: it fails the same way
   * every time, and the per-attempt path already says so.
   */
  const RESPONSES = { kinds: [KIND_RESPONSE], authors: [watchtower.pubkey], '#p': [ourPubkey] };
  let finished = false;
  const listeners = new Map<string, { token: object; sub: { close(): void } | null }>();
  const reopening = new Map<string, ReturnType<typeof setTimeout>>();
  const listen = (url: string, wait = 1_000) => {
    if (finished) return;
    reopening.delete(url);
    const token = {};
    listeners.set(url, { token, sub: null });
    try {
      const sub = pool.subscribeMany([url], RESPONSES, {
        onevent: heard,
        onclose: () => {
          if (finished || listeners.get(url)?.token !== token) return;
          listeners.set(url, { token, sub: null });
          if (!reopening.has(url)) reopening.set(url, setTimeout(() => listen(url, Math.min(wait * 2, 15_000)), wait));
        }
      });
      if (listeners.get(url)?.token === token) listeners.set(url, { token, sub });
    } catch {
      // Unparseable: it will fail identically every time. Not retried, never fatal.
      listeners.delete(url);
    }
  };
  for (const url of relays) listen(url);
  /** Reopens, now, any listener that is down and not already waiting to come back. */
  const relisten = () => {
    for (const [url, l] of listeners) if (!l.sub && !reopening.has(url)) listen(url);
  };

  /** Closes the Distress if a human answered while nothing else was listening. */
  const answered = (): ResponsePayload | null => latched;

  /**
   * Whether the operator has ended it.
   *
   * Checked after every await, not only at the top of a pass. A pass is a send, a wait of up
   * to `ackWindowMs` and a sleep of up to `maxBackoffMs`, and a Distress a wipe had cancelled
   * went on for up to a minute: the send button stayed unavailable and late phases reached the
   * screen.
   */
  const stopped = () => opts.signal?.aborted === true;
  const cancelled = () => new Error('Distress cancelled by the operator');

  const reportExhausted = (response: ResponsePayload) => {
    if (exhaustedShown) return;
    exhaustedShown = true;
    report({ phase: 'watch-exhausted', attempt, response });
  };
  const reportHeard = () => {
    if (heardExhausted) reportExhausted(heardExhausted);
    heardExhausted = null;
  };

  try {
  for (;;) {
    if (stopped()) throw cancelled();
    const early = answered();
    if (early) {
      report({ phase: 'acknowledged', response: early });
      return early;
    }
    attempt++;
    relisten();

    report({ phase: 'sending', attempt });
    let sent: Event | null = null;
    try {
      sent = await sendDistress(pool, relays, secret, watchtower, payload);
      outstanding.push(sent);
      if (outstanding.length > OUTSTANDING) outstanding.shift();
      report({ phase: 'sent', attempt });
    } catch (e) {
      report({ phase: 'unreachable', attempt, error: e instanceof Error ? e.message : String(e) });
    }
    if (stopped()) throw cancelled();

    if (sent) {
      try {
        const response = await waitForResponse(
          pool, relays, secret, ourPubkey, watchtower.pubkey, outstanding, ackWindow, opts.signal
        );
        // An absent responder kind is treated as not-a-human. The spec requires the field on
        // every response, so a missing one is a broken responder, and guessing "human"
        // there is the one wrong guess this loop must never make.
        if (response.responder?.kind === 'human') {
          report({ phase: 'acknowledged', response });
          return response;
        }
        // The watch's own ladder speaks as the node: not a person, and not an agent. Its word
        // that nobody can be reached is reported the moment it arrives. It used to fall through
        // to "an agent answered" with its text thrown away, and the operator learned it ten
        // minutes later from `nobody-answering`.
        if (response.responder?.kind === 'node') {
          if (response.ladder === 'exhausted') reportExhausted(response);
          else {
            // A later status means a new ladder opened on a resend, so its own end is news.
            exhaustedShown = false;
            report({ phase: 'watch-status', attempt, response });
          }
        } else {
          report({ phase: 'agent-holding', attempt, response });
        }
      } catch {
        if (stopped()) throw cancelled();
        report({ phase: 'no-answer', attempt });
      }
    }
    reportHeard();

    // Said once, and it changes nothing. The loop keeps going because only the operator
    // ends a Distress — but an operator who knows nobody is coming can act on that, and one
    // who is still watching attempt numbers tick up has been told nothing useful.
    const elapsedMs = clock() - startedAt;
    if (!saidNobodyAnswering && elapsedMs >= localExhaustedAfter) {
      saidNobodyAnswering = true;
      report({ phase: 'nobody-answering', attempt, elapsedMs });
    }

    await sleep(backoff, opts.signal);
    if (stopped()) throw cancelled();
    backoff = Math.min(backoff * 2, maxBackoff);

    // The gap is exactly where an ephemeral response goes unheard, so it is checked on the
    // way out of it as well as on the way in.
    reportHeard();
    const late = answered();
    if (late) {
      report({ phase: 'acknowledged', response: late });
      return late;
    }
  }
  } finally {
    finished = true;
    for (const t of reopening.values()) clearTimeout(t);
    for (const l of listeners.values()) l.sub?.close();
  }
}
