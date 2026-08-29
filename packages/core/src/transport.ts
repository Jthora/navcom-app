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

import { open } from './crypto/envelope.js';
import { sealToGroup, type WatchtowerAddress } from './crypto/group.js';
import type { SecretKey } from './crypto/keys.js';
import { KIND_DISTRESS, KIND_RESPONSE, KIND_SIGNAL, type SignalType } from './events/kinds.js';
import { checkedText, type DistressPayload, type SignalPayload } from './events/signal.js';
import type { ResponsePayload } from './events/response.js';

export class PublishError extends Error {}

/** Throws when no relay accepted. Silence downstream would otherwise be misdiagnosed. */
async function publishOrThrow(pool: SimplePool, relays: string[], event: Event): Promise<void> {
  const results = await Promise.allSettled(pool.publish(relays, event));
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
  sent: Event,
  timeoutMs: number
): Promise<ResponsePayload> {
  return new Promise((resolve, reject) => {
    let done = false;
    let closer: { close(): void } | null = null;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      // Assigned below; guarded because a synchronous failure can land here first.
      closer?.close();
      fn();
    };

    const timer = setTimeout(
      () => finish(() => reject(new Error(`No response from Watchtower within ${timeoutMs}ms`))),
      timeoutMs
    );

    try {
      closer = pool.subscribeMany(
        relays,
        {
          kinds: [KIND_RESPONSE],
          authors: [watchtower],
          '#p': [ourPubkey],
          '#e': [sent.id]
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
  /** Injected for tests so they do not wait in real time. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected for tests. Real code has no business reading a clock it cannot control. */
  clock?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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

  for (;;) {
    if (opts.signal?.aborted) throw new Error('Distress cancelled by the operator');
    attempt++;

    report({ phase: 'sending', attempt });
    let sent: Event | null = null;
    try {
      sent = await sendDistress(pool, relays, secret, watchtower, payload);
      report({ phase: 'sent', attempt });
    } catch (e) {
      report({ phase: 'unreachable', attempt, error: e instanceof Error ? e.message : String(e) });
    }

    if (sent) {
      try {
        const response = await waitForResponse(
          pool, relays, secret, ourPubkey, watchtower.pubkey, sent, ackWindow
        );
        // An absent responder kind is treated as not-a-human. The spec requires the field on
        // every response, so a missing one is a broken responder, and guessing "human"
        // there is the one wrong guess this loop must never make.
        if (response.responder?.kind === 'human') {
          report({ phase: 'acknowledged', response });
          return response;
        }
        report({ phase: 'agent-holding', attempt, response });
      } catch {
        report({ phase: 'no-answer', attempt });
      }
    }

    // Said once, and it changes nothing. The loop keeps going because only the operator
    // ends a Distress — but an operator who knows nobody is coming can act on that, and one
    // who is still watching attempt numbers tick up has been told nothing useful.
    const elapsedMs = clock() - startedAt;
    if (!saidNobodyAnswering && elapsedMs >= localExhaustedAfter) {
      saidNobodyAnswering = true;
      report({ phase: 'nobody-answering', attempt, elapsedMs });
    }

    await sleep(backoff);
    backoff = Math.min(backoff * 2, maxBackoff);
  }
}
