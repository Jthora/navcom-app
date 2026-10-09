import type { SimplePool } from "nostr-tools/pool";
import type { Event } from "nostr-tools/pure";
import { nodePool } from "../shared/nostr-node.js";
import { KIND_DISTRESS, KIND_SIGNAL } from "../shared/kinds.js";
import { probeRelays, type RelayReach } from "../shared/subscription-check.js";
import { readHearing, relayKey, type HearingRead } from "../shared/hearing.js";
import {
  KIND_WATCH_STATE,
  STALE_AFTER_SECONDS,
  readWatchStateAt,
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

/** Per-relay reachability, and whether each answers the box's own subscription: `shared/subscription-check.ts`. */
export type { RelayReach } from "../shared/subscription-check.js";

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
  /** `[log] hearing_state_path`, where this config names one. */
  hearingPath?: string;
  /** What the escalation executor's hearing file says, read as the running daemon reads it. Absent with no path. */
  executor?: HearingRead;
  /**
   * Whether some relay is heard on by both: it answers the box's subscription here, and the hearing
   * file says the executor hears there. Only those carry the watch state from a running daemon given
   * that file. Absent with no path.
   */
  bothHear?: boolean;
}

/**
 * How long a relay may take to connect. Bounded, because `ws` sets no handshake timeout of its
 * own: a relay that took the TCP connection and never answered the upgrade left this command
 * printing nothing and never exiting, so its cron line never failed [#11].
 */
const CONNECT_MS = 5_000;

/** Why a relay of this config is withheld when the executor's file does not name it. */
export const NOT_THE_EXECUTORS = "it is not among the escalation executor's relays -- add it to escalation.toml";

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
 *
 * `both` is whether any relay is heard on by both the daemon and the escalation executor, as its
 * hearing file says. A daemon given that file publishes only there, so where there is none it is the
 * same third cause, one process along: a running daemon withholding the state, as it should.
 */
export function remedy(read: WatchStateRead, staleAfterSeconds = STALE_AFTER_SECONDS, hearing = true, both = true): string {
  if (!read.dark) return "An operator signing on now would see this watch.";
  const withheld = !hearing
    ? "No relay answers the box's subscription, and the daemon publishes the watch state only on relays " +
      "that do, so a running daemon is withholding it from all of them. Fix that first (above)."
    : !both
      ? "No relay is heard on by both this daemon and the escalation executor, and the daemon publishes the " +
        "watch state only where both hear, so a running daemon is withholding it from all of them. Fix that first (above)."
      : null;
  switch (read.reason) {
    case "absent":
      if (withheld) {
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
      if (withheld) {
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
  /** `[log] hearing_state_path`: read as the running daemon reads it, where the config names one. */
  hearingPath?: string;
}): Promise<WatchCheck> {
  // Through the factory, so it works on Node 20, which has no global WebSocket [F07].
  const pool = opts.pool ?? nodePool();
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  const timeoutMs = opts.timeoutMs ?? 8_000;

  // Exactly what the daemon and the executor ask each relay for.
  const reach: RelayReach[] = await probeRelays(
    pool,
    opts.relays,
    { kinds: [KIND_SIGNAL, KIND_DISTRESS], "#p": [opts.pubkey], limit: 0 },
    { timeoutMs, connectMs: Math.min(timeoutMs, CONNECT_MS) },
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

  // The file is read the way the running daemon reads it, so this cannot believe one it would not.
  const executor = opts.hearingPath ? readHearing(opts.hearingPath, { watch: opts.pubkey, now: now() }) : undefined;
  const bothHear =
    executor === undefined
      ? undefined
      : executor.ok && reach.some((r) => r.hears === true && executor.hears.has(relayKey(r.url)));

  return {
    pubkey: opts.pubkey,
    relays: reach,
    found: at ? { createdAt: at.created_at, ageSeconds: now() - at.created_at } : null,
    read,
    visible: !read.dark,
    hearing: reach.some((r) => r.hears === true),
    ...(opts.hearingPath ? { hearingPath: opts.hearingPath } : {}),
    ...(executor ? { executor } : {}),
    ...(bothHear === undefined ? {} : { bothHear }),
  };
}

/**
 * Whether `watchtower-daemon --check` passes: an operator would see the watch, some relay answers the
 * box's subscription, and some relay is heard on by both processes, as the hearing file says.
 *
 * **No hearing file configured fails it.** A daemon given none publishes wherever it hears, so a relay
 * that refuses the executor shows a live watch while a `Distress` sent only there pages nobody: the
 * failure the file exists to close [watch-state.spec.md]. The daemon has no default for it, so that a
 * box upgraded to this version does not read Dark until its executor writes the file, and says so at
 * every start -- in a journal nobody may read. This is the line that runs unattended, as a cron line,
 * so it is the one that has to catch it.
 */
export function checkPasses(check: WatchCheck): boolean {
  return check.visible && check.hearing && check.bothHear === true;
}

/** What `--check` says with no `[log] hearing_state_path`, and why it fails. */
export const NO_HEARING_FILE =
  "[check] NO [log] hearing_state_path: this daemon publishes wherever it hears, without asking where the " +
  "escalation executor hears, so a relay that refuses the executor shows a live watch while a Distress sent only " +
  "there pages nobody. This check fails until it is set to the executor's [escalation] hearing_state_path";

/** What the escalation executor's hearing file says about this config's relays, as report lines. */
function executorLines(check: WatchCheck): string[] {
  const path = check.hearingPath;
  if (!path || !check.executor) return [NO_HEARING_FILE];
  const read = check.executor;
  if (!read.ok) return [`[check] THE ESCALATION EXECUTOR HEARS NOWHERE, as far as this daemon can tell: ${read.why}`];
  const mine = [...new Map(check.relays.map((r) => [relayKey(r.url), r.url])).entries()];
  const heard = mine.filter(([key]) => read.hears.has(key));
  const lines = [
    `[check] the escalation executor's hearing file (${path}, ${read.ageSeconds}s old): it hears on ` +
      `${heard.length}/${mine.length} of this config's relays`,
  ];
  for (const [key, url] of mine) {
    if (read.hears.has(key)) continue;
    const why = read.deaf.get(key) ?? NOT_THE_EXECUTORS;
    lines.push(`[check]   ${url}: the escalation executor does not hear there (${why}) -- the daemon withholds the watch state there`);
  }
  return lines;
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
  // About the file on this machine, so said whether or not any relay was reachable.
  lines.push(...executorLines(check));

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
  // Only where the box hears at all: otherwise the line above is the cause, and the executor's
  // relays are not the first thing to change.
  if (check.hearing && check.bothHear === false) {
    lines.push(
      "[check] NO RELAY WHERE THE DAEMON AND THE ESCALATION EXECUTOR BOTH HEAR, so the daemon publishes the watch " +
        "state nowhere and operators read Dark. Fix the executor's relays first: navcom-escalation --check names them",
    );
  }
  lines.push(`[check] ${remedy(check.read, staleAfterSeconds, check.hearing, check.bothHear !== false)}`);
  return lines;
}
