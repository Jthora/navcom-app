import { readFileSync } from "node:fs";
import { normalizeURL } from "nostr-tools/utils";
import { sanitizeForLog } from "./validate.js";
import { writeStateFile } from "./state-file.js";

/**
 * Where the escalation executor hears, written down for the daemon (`watch-state.spec.md`, *On a
 * box, "listening" means the daemon and the escalation executor both*).
 *
 * ## Why it exists
 *
 * The daemon withheld the watch state from a relay *it* could not hear on [#38], and knew nothing
 * of the executor's subscription, which is a different process and is kept that way. A relay that
 * answered the daemon and refused the executor -- an inbox that wants NIP-42 AUTH for one REQ and
 * not the other, or one that holds it unanswered -- carried a fresh watch while a `Distress` sent
 * only there paged nobody. So the executor writes which of its relays its subscription is answered
 * on, every {@link HEARING_WRITE_SECONDS} seconds and on any change, and the daemon publishes only
 * where both hear.
 *
 * ## One way
 *
 * The executor writes it and the daemon reads it, as with the drill file, so nothing the daemon
 * does can reach the executor. This module is shared and imports neither process: the writer is
 * called only from `src/escalation`, the reader from `src/daemon` (both held by `separation.test.ts`).
 *
 * ## Failing toward Dark
 *
 * A file that is missing, unreadable, in a shape this version does not read, about another watch
 * key, or dated more than {@link HEARING_MAX_AGE_SECONDS} seconds from the reader's clock either
 * way is believed to say the executor hears nowhere. Each has its own sentence, because each has its
 * own fix.
 */

export const HEARING_VERSION = 1;

/** How often the executor writes the file with nothing changed, so its age says it is alive. */
export const HEARING_WRITE_SECONDS = 30;

/**
 * The oldest file believed: three writes. An executor that has stopped, or can no longer write
 * there, leaves a file that ages past this, and the daemon then reads it as hearing nowhere.
 */
export const HEARING_MAX_AGE_SECONDS = 90;

/** The longest `why` the file carries, as every relay reason in the logs is clipped. */
const WHY_MAX = 160;

export interface HearingRelay {
  /** As the executor's config spells it. */
  url: string;
  /** The relay's current subscription has answered -- a real EOSE, or an event -- and is still open. */
  hears: boolean;
  /** Only when it does not hear: the listener's reason, the one its own log line gave. */
  why?: string;
}

export interface HearingFile {
  v: typeof HEARING_VERSION;
  /** Unix seconds it was written. */
  at: number;
  /** The watch key the executor subscribes `#p` for: a daemon on another key reads it as nowhere. */
  watch: string;
  relays: HearingRelay[];
}

/** A relay as the pool keys it, so `wss://x/` and `wss://x` are one relay in both configs. */
export function relayKey(url: string): string {
  try {
    return normalizeURL(url);
  } catch {
    return url.trim().toLowerCase();
  }
}

/**
 * Writes the file, or throws: the caller logs it and goes on, because a write that fails must never
 * stop the executor.
 *
 * **Through `writeStateFile`**: a new temporary file beside it, made so that nothing already at that
 * name -- a link the daemon's user planted, say -- is followed, then a rename. A half-written file
 * read as malformed means "hears nowhere", and the watch would flicker Dark on a box that was fine;
 * a write that followed a link replaced whatever it named with the executor's privileges. And only
 * in a directory this user owns and nobody else can write.
 *
 * **`0640`**, set on every write as the drill file is: the daemon reads it through the file's group
 * once the executor runs as a user of its own (`ops/systemd/README.md`, 4b). Nothing in it is
 * private -- relays and whether they answer.
 */
export function writeHearing(path: string, file: HearingFile): void {
  const body: HearingFile = {
    v: HEARING_VERSION,
    at: file.at,
    watch: file.watch,
    relays: file.relays.map((r) =>
      r.hears ? { url: r.url, hears: true } : { url: r.url, hears: false, why: sanitizeForLog(r.why ?? "no reason given", WHY_MAX) },
    ),
  };
  writeStateFile(path, JSON.stringify(body) + "\n", 0o640);
}

export type HearingRead =
  | {
      ok: true;
      at: number;
      /** The reader's clock less `at`: negative for a file dated ahead, within the tolerance. */
      ageSeconds: number;
      /** Every relay entry, `why` sanitized again: another process wrote it. */
      relays: HearingRelay[];
      /** {@link relayKey}s the executor hears on. */
      hears: Set<string>;
      /** {@link relayKey}s it does not hear on, with why. */
      deaf: Map<string, string>;
      /** Every {@link relayKey} the file names. */
      listed: Set<string>;
    }
  | {
      ok: false;
      kind: "missing" | "unreadable" | "malformed" | "other-watch" | "old" | "ahead";
      /** Said after "as far as this daemon can tell: ". */
      why: string;
    };

function malformed(path: string, detail: string): HearingRead {
  return { ok: false, kind: "malformed", why: `the hearing file at ${path} is not one this version reads (${detail})` };
}

/**
 * Reads the file the way the daemon must believe it: anything but a fresh file about this watch
 * means the executor hears nowhere, said with the reason.
 */
export function readHearing(path: string, opts: { watch: string; now: number }): HearingRead {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    // ENOTDIR: a part of the path is a file, so there is nothing at it either.
    if (code === "ENOENT" || code === "ENOTDIR") {
      return {
        ok: false,
        kind: "missing",
        why:
          `there is no hearing file at ${path}. Is navcom-escalation running, with [escalation] ` +
          "hearing_state_path set to this path?",
      };
    }
    const said = code ?? sanitizeForLog(err instanceof Error ? err.message : String(err), WHY_MAX);
    return {
      ok: false,
      kind: "unreadable",
      why:
        `the hearing file at ${path} exists and cannot be read (${said}). Usually its group, after the ` +
        "executor moved to its own user (ops/systemd/README.md, 4b)",
    };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return malformed(path, "it is not JSON");
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return malformed(path, "it is not an object");
  const file = raw as Record<string, unknown>;
  if (file.v !== HEARING_VERSION) {
    return malformed(path, `version ${sanitizeForLog(JSON.stringify(file.v) ?? "none", 16)}, and this reads ${HEARING_VERSION}`);
  }
  if (typeof file.at !== "number" || !Number.isFinite(file.at)) return malformed(path, "no time it was written");
  if (typeof file.watch !== "string" || !/^[0-9a-f]{64}$/i.test(file.watch)) return malformed(path, "no watch key");
  if (!Array.isArray(file.relays)) return malformed(path, "no list of relays");
  const relays: HearingRelay[] = [];
  for (const entry of file.relays as unknown[]) {
    const r = entry as Record<string, unknown> | null;
    if (!r || typeof r !== "object" || typeof r.url !== "string" || typeof r.hears !== "boolean") {
      return malformed(path, "a relay entry without a url and whether it hears");
    }
    if (r.why !== undefined && typeof r.why !== "string") return malformed(path, "a reason that is not text");
    const url = sanitizeForLog(r.url, 512);
    relays.push(r.hears ? { url, hears: true } : { url, hears: false, why: sanitizeForLog((r.why as string | undefined) ?? "no reason given", WHY_MAX) });
  }

  const theirs = file.watch.toLowerCase();
  const ours = opts.watch.toLowerCase();
  if (theirs !== ours) {
    return {
      ok: false,
      kind: "other-watch",
      why:
        `the hearing file at ${path} is for watch ${theirs.slice(0, 8)}, not this one (${ours.slice(0, 8)}): ` +
        "the executor's privkey_path is not this daemon's key",
    };
  }

  const age = Math.floor(opts.now - file.at);
  if (age > HEARING_MAX_AGE_SECONDS) {
    return {
      ok: false,
      kind: "old",
      why:
        `the hearing file at ${path} is ${age}s old, and one older than ${HEARING_MAX_AGE_SECONDS}s is not believed. ` +
        `The executor writes it every ${HEARING_WRITE_SECONDS}s: it has stopped, or cannot write there, and its own log says which`,
    };
  }
  if (age < -HEARING_MAX_AGE_SECONDS) {
    return { ok: false, kind: "ahead", why: `the hearing file at ${path} is dated ${-age}s ahead of this machine's clock` };
  }

  const hears = new Set<string>();
  const deaf = new Map<string, string>();
  const listed = new Set<string>();
  for (const r of relays) {
    const key = relayKey(r.url);
    listed.add(key);
    if (r.hears) hears.add(key);
  }
  // Two spellings of one relay: it hears if either entry does.
  for (const r of relays) {
    const key = relayKey(r.url);
    if (!r.hears && !hears.has(key) && !deaf.has(key)) deaf.set(key, r.why ?? "no reason given");
  }
  return { ok: true, at: file.at, ageSeconds: age, relays, hears, deaf, listed };
}
