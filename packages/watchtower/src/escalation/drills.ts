import { existsSync, readFileSync } from "node:fs";
import { evaluateDrill, nextDrillAt, type Author, type Drill } from "@navcom/core";
import { TEST_PREFIX, type pageAll } from "./pager.js";
import type { OnCallEntry } from "./config.js";
import { writeStateFile } from "../shared/state-file.js";

/**
 * Running drills, and getting the result somewhere an operator will see it.
 *
 * The executor runs them because the executor owns paging -- a drill that exercised a
 * different code path from a real `Distress` would be testing the wrong thing.
 *
 * The result lands in a file that the daemon reads when it publishes `10910`. **One
 * direction only**: the daemon reads what the executor wrote, and never the reverse. So an
 * executor that is down leaves the daemon publishing a stale or absent drill, which demotes
 * the watch state -- the correct failure, arrived at by the structure rather than by
 * anybody remembering to handle it.
 */

export interface DrillState {
  last: Drill | null;
  /** Unix seconds. Persisted so a restart does not reroll the schedule and page everybody. */
  nextAt: number;
}

export function readDrillState(path: string): DrillState | null {
  if (!existsSync(path)) return null;
  try {
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
    /*
     * Shaped like a drill file, or not one. Another file at this path -- the hearing file, given the
     * same path by a slip -- has no `nextAt`, and `due()` compared the clock with `undefined`, which is
     * never true: no scheduled drill fired again, and nothing said so.
     */
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
    const state = raw as Partial<DrillState>;
    if (typeof state.nextAt !== "number" || !Number.isFinite(state.nextAt)) return null;
    if (state.last != null && (typeof state.last !== "object" || Array.isArray(state.last))) return null;
    return { last: state.last ?? null, nextAt: state.nextAt };
  } catch {
    // A corrupt file reads as "no drill has ever run", which is the safe direction: it
    // demotes the watch state rather than letting an unreadable pass stand.
    return null;
  }
}

/**
 * Written `0640`: readable by the file's group, which is how the daemon reads it once the executor runs
 * as a user of its own (`ops/systemd/README.md`, 4b -- a directory in the daemon user's group). Nothing in
 * it is private: the daemon publishes the last drill in `10910`. At `0600` the daemon could not read a
 * file the executor's user made, and the watch stopped advertising its drill without a word [review: box
 * safety]. Set on every write, since `mode` applies only to a file being created and a umask narrows it.
 *
 * **Through `writeStateFile`**, never a plain write: this wrote the path itself, and a write follows a
 * link, so a daemon's user who could write the drill directory could point `drill.json` at the
 * executor's key and have the next drill overwrite it. And only in a directory this user owns and
 * nobody else can write. Throws; each caller says so and goes on.
 */
export function writeDrillState(path: string, state: DrillState): void {
  writeStateFile(path, JSON.stringify(state, null, 2) + "\n", 0o640);
}

export interface RunDrillOptions {
  roster: OnCallEntry[];
  /** How long to wait for a human. Shorter than a real ladder: nobody is in danger. */
  ackWindowMs: number;
  now: () => number;
  /** Resolves with whoever acknowledged this drill inside the window. */
  collectAcks: (drillId: string, windowMs: number) => Promise<{ by: Author; atMs: number }[]>;
  page: typeof pageAll;
}

/**
 * Fires one drill and reports what happened.
 *
 * Pages exactly the way a real `Distress` does, with a message that opens
 * `[NAVCOM TEST -- NOT AN EMERGENCY]`. The distinction has to be in the words somebody reads
 * at 3am, not in a field the page does not carry.
 */
export async function runDrill(id: string, opts: RunDrillOptions): Promise<Drill> {
  const at = opts.now();
  const wakeable = opts.roster.filter((e) => e.declaration.channel !== "console-open");

  const startedMs = Date.now();
  // The prefix is built here rather than taken from the caller, so a drill cannot be sent
  // without it. A drill indistinguishable from a real Distress produces alarm fatigue,
  // which destroys the one mechanism where failure means somebody is hurt.
  const results = await opts.page(
    wakeable,
    TEST_PREFIX + " drill " + id.slice(0, 8) + " -- reply to acknowledge",
    undefined,
    "",
    "drill",
  );
  const paged = results.filter((r) => r.dispatched).map((r) => r.callsign);

  // Nobody to wait for. Recording it immediately as a failure is the honest answer, and a
  // watch with no roster should find that out weekly rather than on the night it matters.
  if (paged.length === 0) return evaluateDrill(at, [], [], null);

  const acks = await opts.collectAcks(id, opts.ackWindowMs);
  const first = acks.length > 0 ? Math.min(...acks.map((a) => a.atMs)) - startedMs : null;
  return evaluateDrill(at, paged, acks.map((a) => a.by), first);
}

/** Whether a drill is due, and when the one after it should be. */
export function due(state: DrillState | null, now: number, windowDays: number): boolean {
  if (!state) return false;
  return now >= state.nextAt;
}

export function schedule(last: Drill | null, now: number, windowDays: number): DrillState {
  return { last, nextAt: nextDrillAt(last?.at ?? null, now, windowDays) };
}
