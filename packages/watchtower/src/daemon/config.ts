import { readFileSync, existsSync } from "node:fs";
import { parse } from "smol-toml";

/**
 * Daemon configuration, per the brief's exact TOML shape:
 *
 *   [identity]
 *   privkey_path = "/var/lib/navcom/watchtower.key"
 *
 *   [relays]
 *   urls = ["wss://relay.example", "wss://relay2.example"]
 *
 *   [watch]
 *   routine_interval_default = 3600
 *   overdue_grace           = 1800
 *   hard_expiry             = 14400
 *
 * "Every timing value must be changeable without a code change" -- so
 * every field below has a config key; none are hardcoded constants
 * inside the daemon's logic.
 *
 * heartbeat_interval_seconds is NOT in the brief's sample block. It's
 * required to make check 06 ("kill the daemon, client renders dark")
 * actually work: kind 10910 is a REPLACEABLE event, so a relay that
 * still holds the daemon's last-published copy would keep serving it to
 * a freshly-connecting client even after the daemon has died -- absence
 * alone can't be what "dark" means in a live test against a real relay.
 * The daemon instead republishes 10910 on this interval as a heartbeat,
 * and the CLI's dark-detection (see client/dark.ts) treats a
 * `created_at` older than a staleness multiple of this interval as dark,
 * not just a missing event. Documented here as a deliberate fill of an
 * underspecified area, not a silent guess.
 */
export interface DaemonConfig {
  identity: {
    privkeyPath: string;
  };
  relays: {
    urls: string[];
  };
  watch: {
    routineIntervalDefault: number;
    overdueGrace: number;
    hardExpiry: number;
    heartbeatIntervalSeconds: number;
    sweepIntervalSeconds: number;
    queryTimeoutSeconds: number;
  };
  authorization: {
    allowedPubkeys: string[];
  };
  log: {
    /** Where the accountability log lives. Retained, unlike the board. */
    path: string;
    /** Entries older than this are dropped on rotation. Spec default is 90 days. */
    retentionDays: number;
    /**
     * Where the escalation executor writes its drill results.
     *
     * Read, never written, by the daemon. The two processes share one file and nothing
     * else, which is what keeps a hung executor from being able to hang the watch.
     */
    drillStatePath: string;
    /**
     * Where the escalation executor keeps its own accountability log, if it has one.
     *
     * Read-only, same rule as `drillStatePath`: this daemon never writes here and never
     * depends on the executor being alive to read it. `null` when not configured -- most
     * deployments today don't set `EscalationConfig.log.path` to anything the daemon also
     * knows about, and `log-review` degrades to answering from this watch's own log alone,
     * same as before this field existed.
     */
    escalationLogPath: string | null;
  };
}

const DEFAULTS = {
  routineIntervalDefault: 3600,
  overdueGrace: 1800,
  hardExpiry: 14400,
  heartbeatIntervalSeconds: 60,
  sweepIntervalSeconds: 15,
  // 8s, not the CLI's own 10s RESPONSE_TIMEOUT_MS -- leaves margin for
  // the encrypt+publish round trip that still has to happen AFTER
  // answerQuery() resolves. Session one's hardcoded answer returns
  // instantly, so nothing has exercised this yet; the moment answerQuery()
  // becomes a real call to a Mecha Jono bridge (a network call that can
  // hang), this is what keeps a stuck call from leaving the operator
  // waiting past their own client's timeout with the daemon still "working
  // on it" indefinitely.
  queryTimeoutSeconds: 8,
  // The spec's default. The board is Live and expires; the log is the opposite, and this
  // is the only number that says how long "retained" means.
  logRetentionDays: 90,
  logPath: "/var/lib/navcom/accountability.jsonl",
  drillStatePath: "/var/lib/navcom/drill.json",
};

interface RawToml {
  identity?: { privkey_path?: string };
  relays?: { urls?: string[] };
  watch?: {
    routine_interval_default?: number;
    overdue_grace?: number;
    hard_expiry?: number;
    heartbeat_interval_seconds?: number;
    sweep_interval_seconds?: number;
    query_timeout_seconds?: number;
  };
  authorization?: {
    allowed_pubkeys?: string[];
  };
  log?: {
    path?: string;
    retention_days?: number;
    drill_state_path?: string;
    escalation_log_path?: string;
  };
}

const HEX64_PUBKEY = /^[0-9a-f]{64}$/;

// Found in review: every [watch] field below used to flow through a bare
// `?? DEFAULTS.x` with no type or sign check. TOML happily parses
// `overdue_grace = "1800"` (a quoting typo) as a STRING, which satisfies
// `?? default` (a non-undefined value) and gets returned as-is despite
// DaemonConfig's type declaring `number` -- TypeScript's compile-time
// type is not a runtime guarantee for data that came from a parsed file.
// Downstream, `entry.expectedUntil + overdueGraceSeconds` with a string
// operand is JS string CONCATENATION, not addition, silently corrupting
// every overdue/hard-expiry comparison in Board.sweep() rather than
// failing loudly. A zero or negative interval is just as dangerous in
// the other direction: `setInterval(fn, 0)` fires in a tight loop,
// hammering the relay with heartbeat publishes.
function positiveNumber(raw: unknown, fieldName: string, fallback: number, configPath: string): number {
  if (raw === undefined) return fallback;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    throw new Error(
      `Config [watch] ${fieldName} must be a positive number, got ${JSON.stringify(raw)} (${configPath})`,
    );
  }
  return raw;
}

const RELAY_URL = /^wss?:\/\/.+/;

// ADDED (Stage 2, allowlist): empty/missing allowed_pubkeys means "any
// pubkey may sign on" -- the exact MVP policy documented in
// src/daemon/authorization.ts's own docstring, preserved as the default
// so an already-running pilot deployment isn't silently locked out the
// moment it upgrades to a version of this file that adds the concept.
// Enforcement only activates once an operator explicitly populates this
// list. Same fail-loud-on-malformed-config convention as positiveNumber()
// and the relay URL check above -- a typo'd pubkey should error at
// startup, not silently admit or reject the wrong set of people.
function parseAllowedPubkeys(raw: unknown, configPath: string): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new Error(
      `Config [authorization] allowed_pubkeys must be an array, got ${JSON.stringify(raw)} (${configPath})`,
    );
  }
  const badEntry = raw.find((p) => typeof p !== "string" || !HEX64_PUBKEY.test(p));
  if (badEntry !== undefined) {
    throw new Error(
      `Config [authorization] allowed_pubkeys contains an invalid entry (must be 64-char lowercase hex pubkey): ${JSON.stringify(badEntry)} (${configPath})`,
    );
  }
  return raw as string[];
}

export function loadDaemonConfig(path: string): DaemonConfig {
  if (!existsSync(path)) {
    throw new Error(
      `Daemon config not found at ${path}. Copy watchtower.example.toml to get started.`,
    );
  }
  const raw = parse(readFileSync(path, "utf8")) as RawToml;

  const privkeyPath = raw.identity?.privkey_path;
  if (!privkeyPath) {
    throw new Error(`Config missing required [identity] privkey_path (${path})`);
  }

  const urls = raw.relays?.urls;
  if (!urls || urls.length === 0) {
    throw new Error(`Config missing required [relays] urls (${path})`);
  }
  const badUrl = urls.find((u) => typeof u !== "string" || !RELAY_URL.test(u));
  if (badUrl !== undefined) {
    throw new Error(`Config [relays] urls contains an invalid entry (must start with ws:// or wss://): ${JSON.stringify(badUrl)} (${path})`);
  }

  return {
    identity: { privkeyPath },
    relays: { urls },
    watch: {
      routineIntervalDefault: positiveNumber(raw.watch?.routine_interval_default, "routine_interval_default", DEFAULTS.routineIntervalDefault, path),
      overdueGrace: positiveNumber(raw.watch?.overdue_grace, "overdue_grace", DEFAULTS.overdueGrace, path),
      hardExpiry: positiveNumber(raw.watch?.hard_expiry, "hard_expiry", DEFAULTS.hardExpiry, path),
      heartbeatIntervalSeconds: positiveNumber(raw.watch?.heartbeat_interval_seconds, "heartbeat_interval_seconds", DEFAULTS.heartbeatIntervalSeconds, path),
      sweepIntervalSeconds: positiveNumber(raw.watch?.sweep_interval_seconds, "sweep_interval_seconds", DEFAULTS.sweepIntervalSeconds, path),
      queryTimeoutSeconds: positiveNumber(raw.watch?.query_timeout_seconds, "query_timeout_seconds", DEFAULTS.queryTimeoutSeconds, path),
    },
    authorization: {
      allowedPubkeys: parseAllowedPubkeys(raw.authorization?.allowed_pubkeys, path),
    },
    log: {
      path: raw.log?.path ?? DEFAULTS.logPath,
      // Same fail-loud rule as every other timing value: a quoted number in TOML is a
      // string, and a string retention would make every age comparison nonsense.
      retentionDays: positiveNumber(raw.log?.retention_days, "retention_days", DEFAULTS.logRetentionDays, path),
      drillStatePath: raw.log?.drill_state_path ?? DEFAULTS.drillStatePath,
      escalationLogPath: raw.log?.escalation_log_path ?? null,
    },
  };
}
