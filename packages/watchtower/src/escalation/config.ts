import { readFileSync, existsSync } from "node:fs";
import { parse } from "smol-toml";
import type { OnCall } from "@navcom/core";

/**
 * The executor's own configuration.
 *
 * **Read by a different process from the daemon's**, and that is the point. The executor
 * must not depend on the daemon for anything -- not for its trigger, not for its roster,
 * not for its config -- because a dependency is a way for a hung daemon to take escalation
 * down with it, which is exactly what `escalation.spec.md` forbids.
 *
 *   [identity]
 *   privkey_path = "/var/lib/navcom/watchtower.key"
 *
 *   [relays]
 *   urls = ["wss://relay.example"]
 *
 *   [escalation]
 *   paging_window_seconds = 300
 *   contact_window_seconds = 300
 *
 *   [[escalation.oncall]]
 *   callsign = "Wren"
 *   channel  = "sms"
 *   command  = ["signal-cli", "send", "-m", "{{message}}", "+15550100"]
 */
export interface OnCallEntry {
  /** The declaration published in `10910` and used by the ladder. */
  declaration: OnCall;
  /**
   * How this person is actually woken.
   *
   * argv, not a shell string: a message built from a distress payload must never be able to
   * become a command. `{{message}}` and `{{callsign}}` are substituted per-argument.
   */
  command: string[];
}

export interface EscalationConfig {
  identity: { privkeyPath: string };
  relays: { urls: string[] };
  escalation: {
    pagingWindowSeconds: number;
    contactWindowSeconds: number;
    /** Days the next drill is randomised within. Spec default is weekly. */
    drillWindowDays: number;
    /** How long a drill waits for a human. Shorter than a ladder -- nobody is in danger. */
    drillAckWindowSeconds: number;
    /** Where results are written for the daemon to read when it publishes `10910`. */
    drillStatePath: string;
    /**
     * The most pages this watch will dispatch inside one window.
     *
     * Not tuning — a bound on how many times a stranger with the watch's address can wake a
     * real person. Past it the ladder still runs and the operator is still told, and what
     * they are told is that nobody could be paged.
     */
    maxPagesPerWindow: number;
    pageBudgetWindowSeconds: number;
    /** How long a finished ladder is kept before it is dropped. */
    ladderRetentionSeconds: number;
    oncall: OnCallEntry[];
  };
  /**
   * Where the executor records what actually happened to each Distress -- paged,
   * acknowledged by whom, or exhausted.
   *
   * Its own file and its own chain, deliberately. The daemon's accountability log cannot
   * record this: it does not run the ladder and does not know the outcome, and a stale
   * claim written regardless (the daemon used to write "escalation-not-attempted" for
   * every Distress, forever, once the ladder existed) is exactly the confident wrong
   * answer this system exists to prevent. Two processes appending to one chain is a
   * correctness problem of its own; a second file sidesteps it rather than solving it.
   *
   * Not yet surfaced through the daemon's `log-review` response -- an operator reviewing
   * their own record today sees the daemon's log only. Merging the two is real, separate,
   * future work.
   */
  log: { path: string; retentionDays: number };
}

const DEFAULTS = {
  pagingWindowSeconds: 300, contactWindowSeconds: 300, drillWindowDays: 7,
  drillAckWindowSeconds: 600, drillStatePath: "/var/lib/navcom/drill.json",
  /*
   * Twenty pages an hour. A squad having twenty separate emergencies in an hour has a
   * situation no rate limit is relevant to; a flood passes this in under a second.
   */
  maxPagesPerWindow: 20, pageBudgetWindowSeconds: 3_600,
  /* An hour after it finishes, so a late duplicate still finds it. */
  ladderRetentionSeconds: 3_600,
  logPath: "/var/lib/navcom/escalation-log.jsonl", logRetentionDays: 90,
};
const CHANNELS = ["sms", "voice", "push", "console-open"] as const;
const PUBKEY = /^[0-9a-f]{64}$/i;
const RELAY_URL = /^wss?:\/\/.+/;

/**
 * A config-declared roster is the NODE saying who is reachable, not those people saying it.
 *
 * The same self-report the rest of `10910` carries, marked the same way: author kind
 * `node`, no signature. When operators sign their own declarations only the author changes.
 * Given no expiry to honour, a config entry is treated as standing -- the node operator
 * removing a line is what retires it.
 */
const STANDING = 4_102_444_800; // 2100-01-01

function positiveNumber(raw: unknown, field: string, fallback: number, path: string): number {
  if (raw === undefined) return fallback;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    throw new Error(`Config [escalation] ${field} must be a positive number, got ${JSON.stringify(raw)} (${path})`);
  }
  return raw;
}

function parseOnCall(raw: unknown, path: string): OnCallEntry[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new Error(`Config [[escalation.oncall]] must be a list of tables (${path})`);
  }

  return raw.map((entry, i) => {
    const e = entry as { callsign?: unknown; channel?: unknown; command?: unknown; pubkey?: unknown };
    const where = `[[escalation.oncall]] #${i + 1} (${path})`;

    if (typeof e.callsign !== "string" || e.callsign.trim() === "") {
      throw new Error(`${where}: callsign is required -- the board and the ladder both show it`);
    }
    if (typeof e.channel !== "string" || !CHANNELS.includes(e.channel as (typeof CHANNELS)[number])) {
      throw new Error(`${where}: channel must be one of ${CHANNELS.join(", ")}`);
    }
    // Registering a channel is a CONDITION of the on-call role [C40]. An entry that cannot
    // actually be woken is not on-call, and admitting it would let the ladder page a name
    // into nothing and then report having paged it.
    if (e.channel !== "console-open") {
      if (!Array.isArray(e.command) || e.command.length === 0 || !e.command.every((a) => typeof a === "string")) {
        throw new Error(
          `${where}: channel "${e.channel}" needs a command (argv array). ` +
            `An on-call entry with no way to wake anyone is not on-call.`,
        );
      }
    }

    /*
     * The key this person acknowledges with.
     *
     * Optional, and its absence is a real state: somebody can be on-call by phone without
     * running NavCom at all, and they acknowledge by saying so to whoever is at the console.
     *
     * But it was not merely optional -- it was **inexpressible**. The parser had no `pubkey`
     * field, so every entry a config file could produce carried none, and the executor
     * matches an ack by comparing `author.pubkey` to the event's. `undefined` matched
     * nobody. In any real deployment every acknowledgement was refused and every drill
     * failed, forever, while the tests passed against entries built by hand with a pubkey
     * the config could not create.
     */
    if (e.pubkey !== undefined && (typeof e.pubkey !== "string" || !PUBKEY.test(e.pubkey))) {
      throw new Error(
        `${where}: pubkey must be 64 hexadecimal characters. ` +
          `It is the key this person acknowledges with -- a wrong one refuses their ack at 3am.`,
      );
    }

    return {
      declaration: {
        author: {
          kind: "node",
          callsign: e.callsign,
          ...(e.pubkey ? { pubkey: (e.pubkey as string).toLowerCase() } : {}),
        },
        channel: e.channel as OnCall["channel"],
        expires: STANDING,
      },
      command: (e.command as string[] | undefined) ?? [],
    };
  });
}

export function loadEscalationConfig(path: string): EscalationConfig {
  if (!existsSync(path)) {
    throw new Error(`Escalation config not found at ${path}.`);
  }
  const raw = parse(readFileSync(path, "utf8")) as {
    identity?: { privkey_path?: string };
    relays?: { urls?: string[] };
    escalation?: {
      paging_window_seconds?: number;
      contact_window_seconds?: number;
      drill_window_days?: number;
      drill_ack_window_seconds?: number;
      drill_state_path?: string;
      max_pages_per_window?: number;
      page_budget_window_seconds?: number;
      ladder_retention_seconds?: number;
      oncall?: unknown;
    };
    log?: { path?: string; retention_days?: number };
  };

  const privkeyPath = raw.identity?.privkey_path;
  if (!privkeyPath) throw new Error(`Config missing required [identity] privkey_path (${path})`);

  const urls = raw.relays?.urls;
  if (!urls || urls.length === 0) throw new Error(`Config missing required [relays] urls (${path})`);
  const badUrl = urls.find((u) => typeof u !== "string" || !RELAY_URL.test(u));
  if (badUrl !== undefined) {
    throw new Error(`Config [relays] urls contains an invalid entry: ${JSON.stringify(badUrl)} (${path})`);
  }

  return {
    identity: { privkeyPath },
    relays: { urls },
    escalation: {
      pagingWindowSeconds: positiveNumber(raw.escalation?.paging_window_seconds, "paging_window_seconds", DEFAULTS.pagingWindowSeconds, path),
      contactWindowSeconds: positiveNumber(raw.escalation?.contact_window_seconds, "contact_window_seconds", DEFAULTS.contactWindowSeconds, path),
      drillWindowDays: positiveNumber(raw.escalation?.drill_window_days, "drill_window_days", DEFAULTS.drillWindowDays, path),
      drillAckWindowSeconds: positiveNumber(raw.escalation?.drill_ack_window_seconds, "drill_ack_window_seconds", DEFAULTS.drillAckWindowSeconds, path),
      drillStatePath: raw.escalation?.drill_state_path ?? DEFAULTS.drillStatePath,
      maxPagesPerWindow: positiveNumber(raw.escalation?.max_pages_per_window, "max_pages_per_window", DEFAULTS.maxPagesPerWindow, path),
      pageBudgetWindowSeconds: positiveNumber(raw.escalation?.page_budget_window_seconds, "page_budget_window_seconds", DEFAULTS.pageBudgetWindowSeconds, path),
      ladderRetentionSeconds: positiveNumber(raw.escalation?.ladder_retention_seconds, "ladder_retention_seconds", DEFAULTS.ladderRetentionSeconds, path),
      oncall: parseOnCall(raw.escalation?.oncall, path),
    },
    log: {
      path: raw.log?.path ?? DEFAULTS.logPath,
      retentionDays: positiveNumber(raw.log?.retention_days, "retention_days", DEFAULTS.logRetentionDays, path),
    },
  };
}
