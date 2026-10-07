/**
 * The Distress loop as phones cached it before 2026-10-07 -- `main`'s
 * `sendDistressUntilAcknowledged`, kept as it was, for the tests of what the executor still does
 * for it [review: relay paths, #13].
 *
 * Two things set it apart from the current loop, and the executor's held acknowledgement exists
 * for both: it records an attempt only once the publish has settled on every relay, so an answer
 * naming only an attempt it has not recorded yet is dropped; and it waits for answers per attempt,
 * with one always-open listener that keeps only a person's answer and the ladder's `exhausted`.
 * It ends on any person's answer naming an id it holds -- it cannot tell an earlier Distress's.
 *
 * Not production code and not to be fixed: its faults are what is under test.
 */
import type { SimplePool } from "nostr-tools/pool";
import type { Event } from "nostr-tools/core";
import { verifyEvent } from "nostr-tools/pure";
import {
  KIND_RESPONSE,
  open,
  sendDistress,
  waitForResponse,
  type DistressPayload,
  type ResponsePayload,
  type SecretKey,
  type WatchtowerAddress,
} from "@navcom/core";

export interface OlderClientOptions {
  ackWindowMs?: number;
  backoffMs?: number;
  maxBackoffMs?: number;
  signal?: AbortSignal;
  onPhase?: (phase: { phase: string; attempt?: number }) => void;
}

export async function olderClientLoop(
  pool: SimplePool,
  relays: string[],
  secret: SecretKey,
  ourPubkey: string,
  watchtower: WatchtowerAddress,
  payload: DistressPayload,
  opts: OlderClientOptions = {},
): Promise<ResponsePayload> {
  const ackWindow = opts.ackWindowMs ?? 20_000;
  const maxBackoff = opts.maxBackoffMs ?? 60_000;
  const report = opts.onPhase ?? (() => {});
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      if (opts.signal?.aborted) return resolve();
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(done, ms);
      opts.signal?.addEventListener("abort", done, { once: true });
    });
  let backoff = opts.backoffMs ?? 2_000;
  let attempt = 0;
  const outstanding: Event[] = [];
  let latched: ResponsePayload | null = null;

  const persistent = pool.subscribeMany(
    relays,
    { kinds: [KIND_RESPONSE], authors: [watchtower.pubkey], "#p": [ourPubkey] },
    {
      onevent(event: Event) {
        if (latched || !verifyEvent(event)) return;
        const answers = event.tags.filter((t) => t[0] === "e").map((t) => t[1]);
        if (!outstanding.some((o) => answers.includes(o.id))) return;
        try {
          const response = open<ResponsePayload>(secret, watchtower.pubkey, event.content);
          if (response.responder?.kind === "human") latched = response;
        } catch {
          // Not for us.
        }
      },
    },
  );
  const stopped = () => opts.signal?.aborted === true;
  try {
    for (;;) {
      if (stopped()) throw new Error("Distress cancelled by the operator");
      if (latched) return latched;
      attempt++;
      report({ phase: "sending", attempt });
      let sent: Event | null = null;
      try {
        // Recorded only once every relay has settled -- the gap the executor's second send covers.
        sent = await sendDistress(pool, relays, secret, watchtower, payload);
        outstanding.push(sent);
        report({ phase: "sent", attempt });
      } catch (e) {
        report({ phase: "unreachable", attempt });
        void e;
      }
      if (stopped()) throw new Error("Distress cancelled by the operator");
      if (sent) {
        try {
          const response = await waitForResponse(
            pool, relays, secret, ourPubkey, watchtower.pubkey, outstanding, ackWindow, opts.signal,
          );
          if (response.responder?.kind === "human") return response;
          report({ phase: response.responder?.kind === "node" ? "watch-status" : "agent-holding", attempt });
        } catch {
          if (stopped()) throw new Error("Distress cancelled by the operator");
          report({ phase: "no-answer", attempt });
        }
      }
      await sleep(backoff);
      if (stopped()) throw new Error("Distress cancelled by the operator");
      backoff = Math.min(backoff * 2, maxBackoff);
      if (latched) return latched;
    }
  } finally {
    persistent.close();
  }
}
