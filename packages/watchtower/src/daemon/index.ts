#!/usr/bin/env node
import { loadDaemonConfig } from "./config.js";
import { loadOrCreateKeypair } from "../shared/identity.js";
import { WatchtowerDaemon } from "./watchtower.js";
import { AccountabilityLog } from "../shared/accountability.js";

// Found in review: nothing guarded against a truly unexpected error
// outside the known try/catch paths inside WatchtowerDaemon. Node's own
// default behavior for an uncaught exception is to print to stderr and
// exit anyway, but relying on the default here means a crash trace could
// get lost depending on how the process is supervised/redirected, and
// carries no indication it came from this daemon specifically. For a
// safety-coordination system, silently losing watch coverage with zero
// trace of why is the worst-case failure mode -- these handlers make
// sure SOMETHING legible is logged before the process goes down, using
// the same [daemon] prefix convention as every other log line here.
process.on("uncaughtException", (err: unknown) => {
  console.error(`[daemon] uncaught exception: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
process.on("unhandledRejection", (reason: unknown) => {
  console.error(`[daemon] unhandled rejection: ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`);
  process.exit(1);
});

function configPath(): string {
  return process.argv[2] || process.env.WATCHTOWER_CONFIG || "./watchtower.toml";
}

async function main(): Promise<void> {
  const path = configPath();
  const config = loadDaemonConfig(path);
  const { secretKey, pubkey } = loadOrCreateKeypair(config.identity.privkeyPath);

  console.log(`[daemon] Watchtower pubkey: ${pubkey}`);
  console.log(`[daemon] relays: ${config.relays.urls.join(", ")}`);
  console.log(
    `[daemon] watch: routine_default=${config.watch.routineIntervalDefault}s ` +
      `overdue_grace=${config.watch.overdueGrace}s hard_expiry=${config.watch.hardExpiry}s`,
  );

  // The log is opened before the watch starts, and a failure to open it never stops the
  // watch. An accountability problem must not become an availability one -- that is the
  // trade a hostile watch would take every time.
  let log: AccountabilityLog | undefined;
  try {
    const opened = AccountabilityLog.open(config.log.path, config.log.retentionDays);
    log = opened.log;
    const dropped = log.rotate(Math.floor(Date.now() / 1000));
    const status = log.status();

    if (!opened.check.intact) {
      // Shouted, not swallowed. This is what the whole mechanism exists to surface, and
      // the break is now recorded permanently in the meta file.
      console.error("[log] ####################################################");
      console.error(`[log] CHAIN BROKEN at entry ${opened.check.brokenAt}: ${opened.check.reason}`);
      console.error("[log] The record has been edited since it was written, or lost entries.");
      console.error("[log] The break is recorded permanently. The watch continues.");
      console.error("[log] ####################################################");
    }
    console.log(
      `[log] ${config.log.path} — ${status.entries} entr${status.entries === 1 ? "y" : "ies"}, ` +
        `retention ${config.log.retentionDays}d` +
        (dropped > 0 ? `, rotated out ${dropped}` : "") +
        (status.breaks.length > 0 ? `, ${status.breaks.length} recorded break(s)` : ""),
    );
  } catch (err: unknown) {
    console.error(`[log] could not open ${config.log.path}: ${String(err)}`);
    console.error("[log] the watch will run UNRECORDED. Nothing will be reviewable.");
  }

  const daemon = new WatchtowerDaemon({ config, secretKey, pubkey, ...(log ? { log } : {}) });
  await daemon.start();
  console.log("[daemon] published watch state (automated). Listening for signals.");

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[daemon] received ${signal}, shutting down (board is memory-only; the log is already on disk)`);
    daemon
      .stop()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
  console.error(`[daemon] fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
