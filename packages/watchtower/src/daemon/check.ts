import type { SimplePool } from "nostr-tools/pool";
import type { Event } from "nostr-tools/pure";
import type { Filter } from "nostr-tools/filter";
import { nodePool } from "../shared/nostr-node.js";
import { KIND_DISTRESS, KIND_SIGNAL } from "../shared/kinds.js";
import {
  KIND_WATCH_STATE,
  STALE_AFTER_SECONDS,
  readWatchStateAt,
  sanitizeForLog,
  type WatchStateRead,
} from "@navcom/core";

/**
 * What an operator would see if they pointed at this box right now.
 *
 * ## Why this exists
 *
 * The escalation half of a Watchtower has two ways to check itself — `--check` asks whether
 * the roster can be paged, `--drill` runs the whole ladder. The daemon half had **no flags at
 * all**: `process.argv[2]` was a config path and nothing else. So a Stationkeeper could prove
 * they were able to wake somebody, and had no way to prove an operator could *see* their
 * watch.
 *
 * Milestone 9.6 says a restore drill "will probably fail the first time, and that is the
 * finding". It is only a finding if somebody can see it. Until this, the first thing that
 * would notice a box publishing nothing readable was an operator at sign-on, being told Dark
 * — and `stationkeeper.md`, which asks a volunteer to take the highest-privilege position in
 * the system, does not contain the word *check*.
 *
 * ## Why it reads rather than asserts
 *
 * It computes the answer with the **operator's own filter and the operator's own reader** —
 * `{ kinds: [10910], authors: [pubkey], limit: 1 }` and `readWatchStateAt`, the same pair
 * `web/src/lib/terminal/relay.ts` uses. Two implementations of "is this watch up" would drift,
 * and the one that drifted would be this one, because nobody signs on to it.
 *
 * It also publishes nothing. The question is whether what is *already out there* is readable,
 * so a box whose daemon has died reports exactly what an operator would be told rather than
 * a state this command created for itself.
 */

/** Per-relay reachability, because "up on one of three" is real and otherwise invisible. */
export interface RelayReach {
  url: string;
  reached: boolean;
  error?: string;
  /**
   * Whether the relay answered **the box's own subscription** -- the `#p` REQ the daemon and the
   * executor hear every signal and Distress through [#38]. Absent where it was not reached.
   *
   * A relay can take writes and serve the watch state to anybody while refusing that one REQ (an
   * inbox that wants AUTH) or holding it unanswered. This command used to read only the watch
   * state, so it reported such a box as seen and exited zero while no Distress sent there could
   * reach it.
   */
  hears?: boolean;
  /** Why it does not: the relay's refusal, or that it never answered. */
  deaf?: string;
}

export interface WatchCheck {
  pubkey: string;
  relays: RelayReach[];
  /** The newest `10910` any relay served, or null when none did. */
  found: { createdAt: number; ageSeconds: number } | null;
  /** What an operator's terminal would render from it. */
  read: WatchStateRead;
  /** True when an operator signing on right now would be told a watch is up. */
  visible: boolean;
  /** True when at least one reachable relay answered the box's own subscription. */
  hearing: boolean;
}

/**
 * How long a relay may take to connect. Bounded, because `ws` sets no handshake timeout of its
 * own: a relay that took the TCP connection and never answered the upgrade left this command
 * printing nothing and never exiting, so its cron line never failed [#11].
 */
const CONNECT_MS = 5_000;

/** nostr-tools' longest timer, so its own stand-in for an EOSE never answers for a relay. */
const NEVER_MS = 2_147_483_647;

/** A relay as `ensureRelay` hands it over, as far as this needs it. */
interface Subscribing {
  subscribe(
    filters: Filter[],
    params: { oneose?: () => void; onclose?: (reason: string) => void; eoseTimeout?: number },
  ): { close(reason?: string): void };
}

/**
 * Asks the relay for exactly what the daemon and the executor ask it for, and says whether it
 * answered. A refusal is the relay's own words; silence past `timeoutMs` is said as silence.
 * Nothing is published, and `limit: 0` asks for nothing stored.
 */
function hears(relay: Subscribing, pubkey: string, timeoutMs: number): Promise<Pick<RelayReach, "hears" | "deaf">> {
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
          deaf: `took the box's subscription and did not answer in ${
            timeoutMs >= 1_000 ? `${Math.round(timeoutMs / 1_000)}s` : `${timeoutMs}ms`
          }`,
        }),
      timeoutMs,
    );
    try {
      sub = relay.subscribe([{ kinds: [KIND_SIGNAL, KIND_DISTRESS], "#p": [pubkey], limit: 0 }], {
        oneose: () => finish({ hears: true }),
        onclose: (reason: unknown) => {
          closed = true;
          const said = typeof reason === "string" && reason !== "" ? sanitizeForLog(reason, 160) : "no reason given";
          finish({ hears: false, deaf: `refused the box's subscription: ${said}` });
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
 * The fix, per reason, in the terms the person running the box can act on.
 *
 * Deliberately not the terminal's wording. The operator is told what it means for them —
 * "nothing here can tell a live watch from a dead one" — and the Stationkeeper needs what to
 * go and change, which is a different sentence about the same fact.
 *
 * `hearing` is whether any relay answered the box's own subscription. Where none did, a running
 * daemon withholds the watch state from every relay [#38], so "absent" and "stale" have a third
 * cause, and it is the one to fix first: told only the other two, a Stationkeeper went to restart
 * a daemon that was running and doing what it should [review: relay paths].
 */
export function remedy(read: WatchStateRead, staleAfterSeconds = STALE_AFTER_SECONDS, hearing = true): string {
  if (!read.dark) return "An operator signing on now would see this watch.";
  const withheld =
    "No relay answers the box's subscription, and the daemon publishes the watch state only on relays " +
    "that do, so a running daemon is withholding it from all of them. Fix that first (above).";
  switch (read.reason) {
    case "absent":
      if (!hearing) {
        return (
          `No relay served anything for this key. ${withheld} If the watch is still absent after that, ` +
          "the daemon is not running, or it is publishing to relays this config does not list."
        );
      }
      return (
        "No relay served anything for this key. Either the daemon is not running, or it is " +
        "publishing to relays this config does not list."
      );
    case "corrupt":
      return (
        "A relay is serving something signed by this key that cannot be parsed as a watch " +
        "state. Something else is publishing 10910 from this key, or the daemon is a " +
        "different version than the operators are reading."
      );
    case "clock":
      return (
        "The stored watch state is stamped in this machine's future, so no age computed from " +
        "it means anything. This box's clock has moved backwards, or something else published " +
        "for it. Fix the clock before trusting anything else here."
      );
    case "stale":
      if (!hearing) {
        return (
          `The last watch state is ${read.ageSeconds ?? "?"}s old and operators treat anything ` +
          `over ${staleAfterSeconds}s as Dark. ${withheld} If it is still stale after that, the daemon ` +
          "has stopped republishing, or it cannot reach the relays it thinks it can."
        );
      }
      return (
        `The last watch state is ${read.ageSeconds ?? "?"}s old and operators treat anything ` +
        `over ${staleAfterSeconds}s as Dark. The daemon has stopped republishing, or it cannot ` +
        "reach the relays it thinks it can."
      );
    default:
      return "Dark, with no reason given, which is itself a bug worth reporting.";
  }
}

/**
 * Reads this watch the way an operator would.
 *
 * `now` and the pool are injectable so this is testable without a clock or a network — the
 * point of the whole exercise is that a check nobody can run is not a check.
 */
export async function checkWatch(opts: {
  pubkey: string;
  relays: string[];
  pool?: SimplePool;
  now?: () => number;
  timeoutMs?: number;
  staleAfterSeconds?: number;
}): Promise<WatchCheck> {
  // Through the factory, so it works on Node 20, which has no global WebSocket [F07].
  const pool = opts.pool ?? nodePool();
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  const timeoutMs = opts.timeoutMs ?? 8_000;

  const reach: RelayReach[] = await Promise.all(
    opts.relays.map(async (url): Promise<RelayReach> => {
      let relay: Subscribing;
      try {
        relay = (await pool.ensureRelay(url, { connectionTimeout: Math.min(timeoutMs, CONNECT_MS) })) as unknown as Subscribing;
      } catch (err: unknown) {
        return { url, reached: false, error: err instanceof Error ? err.message : String(err) };
      }
      return { url, reached: true, ...(await hears(relay, opts.pubkey, timeoutMs)) };
    }),
  );

  // Newest wins. A relay serving a preserved copy long after the daemon died is the exact
  // case `readWatchStateAt` was given an age for, so the age has to come from the event.
  let newest: Event | null = null;
  const reached = reach.filter((r) => r.reached).map((r) => r.url);

  if (reached.length > 0) {
    await new Promise<void>((resolve) => {
      const done = setTimeout(finish, timeoutMs);
      let sub: { close(): void } | null = null;
      function finish() {
        clearTimeout(done);
        sub?.close();
        resolve();
      }
      try {
        sub = pool.subscribeMany(
          reached,
          { kinds: [KIND_WATCH_STATE], authors: [opts.pubkey], limit: 1 },
          {
            onevent(event: Event) {
              if (!newest || event.created_at > newest.created_at) newest = event;
            },
            oneose: finish,
          },
        );
      } catch {
        finish();
      }
    });
  }

  const at = newest as Event | null;
  const read = readWatchStateAt(at?.content ?? null, {
    createdAt: at?.created_at ?? null,
    now: now(),
    ...(opts.staleAfterSeconds === undefined ? {} : { staleAfterSeconds: opts.staleAfterSeconds }),
  });

  return {
    pubkey: opts.pubkey,
    relays: reach,
    found: at ? { createdAt: at.created_at, ageSeconds: now() - at.created_at } : null,
    read,
    visible: !read.dark,
    hearing: reach.some((r) => r.hears === true),
  };
}

/** Plain lines, in the order somebody debugging at 1am reads them. */
export function report(check: WatchCheck, staleAfterSeconds = STALE_AFTER_SECONDS): string[] {
  const lines = [`[check] watch ${check.pubkey}`];
  for (const r of check.relays) {
    if (!r.reached) {
      lines.push(`[check]   ${r.url}: UNREACHABLE -- ${r.error ?? "no reason given"}`);
    } else if (r.hears) {
      lines.push(`[check]   ${r.url}: reached, and it answers the box's subscription`);
    } else {
      lines.push(
        `[check]   ${r.url}: reached, but it ${r.deaf ?? "did not answer the box's subscription"} -- a Distress ` +
          "sent only there is not heard, and the daemon does not publish the watch state there",
      );
    }
  }

  /*
   * Nothing reachable is not a finding about the box, and saying both would be worse than
   * saying neither. Found by running the command rather than by testing it: the first version
   * printed "this says nothing about the daemon" and then, two lines later, the `absent`
   * remedy telling somebody their daemon was not running. That is how a person ends up
   * rebuilding a working box while their network is down.
   */
  if (check.relays.every((r) => !r.reached)) {
    lines.push("[check] No relay was reachable, so this says nothing about the daemon.");
    lines.push("[check] Fix the network or the relay list and run this again. Nothing below would mean anything.");
    return lines;
  }

  lines.push(
    check.found
      ? `[check] newest watch state: ${check.found.ageSeconds}s old`
      : "[check] newest watch state: none served",
  );
  lines.push(
    `[check] an operator would see: ${check.visible ? `${check.read.state.state.toUpperCase()}` : "DARK"}` +
      (check.read.reason ? ` (${check.read.reason})` : ""),
  );
  // First when it is true: it is the cause of what follows, and the remedy below says so.
  if (!check.hearing) {
    lines.push(
      "[check] NO RELAY ANSWERS THE BOX'S SUBSCRIPTION, so no signal and no Distress reaches it. Pick a relay " +
        "that serves this box without NIP-42 AUTH, or fix the one that is not answering.",
    );
  }
  lines.push(`[check] ${remedy(check.read, staleAfterSeconds, check.hearing)}`);
  return lines;
}
