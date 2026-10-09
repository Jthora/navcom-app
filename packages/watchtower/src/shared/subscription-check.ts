import type { SimplePool } from "nostr-tools/pool";
import type { Filter } from "nostr-tools/filter";
import { sanitizeForLog } from "./validate.js";

/**
 * Asking a relay for one subscription, as a running process makes it, and saying whether it answers.
 *
 * Every `--check` here asks the same question of its own process's REQ -- the daemon's, the
 * executor's, the keyless pager's -- because a relay can take writes and serve the watch state to
 * anybody while refusing that one REQ (an inbox that wants NIP-42 AUTH) or holding it unanswered.
 * It started as the daemon's alone; the executor's and the pager's `--check` read nothing of the
 * kind, so a relay that refused only them passed every check while a `Distress` sent only there paged
 * nobody.
 */

/** Per-relay reachability, because "up on one of three" is real and otherwise invisible. */
export interface RelayReach {
  url: string;
  reached: boolean;
  error?: string;
  /**
   * Whether the relay answered **the subscription asked for** -- the `#p` REQ every signal and
   * Distress arrives through [#38]. Absent where it was not reached.
   *
   * A relay can take writes and serve the watch state to anybody while refusing that one REQ (an
   * inbox that wants AUTH) or holding it unanswered. The daemon's check used to read only the watch
   * state, so it reported such a box as seen and exited zero while no Distress sent there could
   * reach it.
   */
  hears?: boolean;
  /** Why it does not: the relay's refusal, or that it never answered. */
  deaf?: string;
}

/** nostr-tools' longest timer, so its own stand-in for an EOSE never answers for a relay. */
const NEVER_MS = 2_147_483_647;

/** A relay as `ensureRelay` hands it over, as far as this needs it. */
export interface Subscribing {
  subscribe(
    filters: Filter[],
    params: { oneose?: () => void; onclose?: (reason: string) => void; eoseTimeout?: number },
  ): { close(reason?: string): void };
}

/**
 * Asks the relay for exactly `filter` and says whether it answered. A refusal is the relay's own
 * words; silence past `timeoutMs` is said as silence. Nothing is published, and `limit: 0` asks for
 * nothing stored.
 *
 * `noun` names the subscription in the reason: the daemon's report has always said "the box's
 * subscription", and the executor's and the pager's say "the subscription", since each asks for its own.
 */
export function answers(
  relay: Subscribing,
  filter: Filter,
  timeoutMs: number,
  noun = "the box's subscription",
): Promise<Pick<RelayReach, "hears" | "deaf">> {
  return new Promise((resolve) => {
    let settled = false;
    let closed = false;
    let sub: { close(reason?: string): void } | null = null;
    const finish = (result: Pick<RelayReach, "hears" | "deaf">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Never closed twice: nostr-tools counts a second close as a second operation ending.
      if (sub && !closed) {
        closed = true;
        sub.close("checked");
      }
      resolve(result);
    };
    const timer = setTimeout(
      () =>
        finish({
          hears: false,
          deaf: `took ${noun} and did not answer in ${
            timeoutMs >= 1_000 ? `${Math.round(timeoutMs / 1_000)}s` : `${timeoutMs}ms`
          }`,
        }),
      timeoutMs,
    );
    try {
      sub = relay.subscribe([{ ...filter }], {
        oneose: () => finish({ hears: true }),
        onclose: (reason: unknown) => {
          closed = true;
          const said = typeof reason === "string" && reason !== "" ? sanitizeForLog(reason, 160) : "no reason given";
          finish({ hears: false, deaf: `refused ${noun}: ${said}` });
        },
        eoseTimeout: NEVER_MS,
      });
      clearTimeout((sub as unknown as { eoseTimeoutHandle?: ReturnType<typeof setTimeout> }).eoseTimeoutHandle);
      if (settled && !closed) {
        closed = true;
        sub.close("checked");
      }
    } catch (err: unknown) {
      finish({ hears: false, deaf: err instanceof Error ? err.message : String(err) });
    }
  });
}

/**
 * Each relay, reached and asked for `filter`, all at once. `connectMs` bounds the connection, because
 * `ws` sets no handshake timeout of its own: a relay that took the TCP connection and never answered
 * the upgrade left a check printing nothing and never exiting [#11].
 */
export async function probeRelays(
  pool: Pick<SimplePool, "ensureRelay">,
  urls: readonly string[],
  filter: Filter,
  opts: { timeoutMs: number; connectMs: number; noun?: string },
): Promise<RelayReach[]> {
  return Promise.all(
    urls.map(async (url): Promise<RelayReach> => {
      let relay: Subscribing;
      try {
        relay = (await pool.ensureRelay(url, { connectionTimeout: opts.connectMs })) as unknown as Subscribing;
      } catch (err: unknown) {
        return { url, reached: false, error: sanitizeForLog(err instanceof Error ? err.message : String(err), 160) };
      }
      return { url, reached: true, ...(await answers(relay, filter, opts.timeoutMs, opts.noun)) };
    }),
  );
}
