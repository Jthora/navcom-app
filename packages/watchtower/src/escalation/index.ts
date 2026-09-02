#!/usr/bin/env node
import { loadEscalationConfig } from "./config.js";
import { loadOrCreateKeypair } from "../shared/identity.js";
import { EscalationExecutor } from "./executor.js";
import { testPage } from "./pager.js";
import { readDrillState } from "./drills.js";
import { buildReview, render } from "./review.js";
import { AccountabilityLog } from "../shared/accountability.js";

/**
 * The escalation executor, as its own process.
 *
 * Run it separately from the daemon, and supervise it separately. If they share a
 * supervisor unit, a crash loop in one restarts the other, and "separate failure domains"
 * becomes a comment rather than a property.
 *
 *   navcom-escalation /etc/navcom/escalation.toml
 */

process.on("uncaughtException", (err: unknown) => {
  console.error(`[executor] uncaught exception: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exit(1);
});
process.on("unhandledRejection", (reason: unknown) => {
  console.error(`[executor] unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`);
  process.exit(1);
});

function configPath(): string {
  const positional = process.argv.slice(2).find((a) => !a.startsWith("--"));
  return positional || process.env.NAVCOM_ESCALATION_CONFIG || "./escalation.toml";
}

/**
 * Pages everyone on the roster with an obvious test message and reports what happened.
 *
 *   navcom-escalation --check /etc/navcom/escalation.toml
 *
 * Run it after editing the roster and before relying on it. A configured command that has
 * never been executed is a command that works right up until the night it matters, and
 * "dispatched" here still only means the command exited zero -- whether a human actually
 * woke up is a question only that human can answer.
 */
async function check(path: string): Promise<never> {
  const config = load(path);
  const roster = config.escalation.oncall.filter((e) => e.declaration.channel !== "console-open");

  if (roster.length === 0) {
    console.error("[check] Nobody is on-call, so there is nothing to test.");
    console.error("[check] A Distress today would page nobody and say so. See escalation.example.toml.");
    process.exit(1);
  }

  console.log(`[check] paging ${roster.map((e) => e.declaration.author.callsign).join(", ")} with a test message`);
  const results = await testPage(roster);

  let failed = 0;
  for (const r of results) {
    if (r.dispatched) {
      console.log(`[check]   ${r.callsign} via ${r.channel}: command exited zero`);
    } else {
      failed++;
      console.error(`[check]   ${r.callsign} via ${r.channel}: FAILED -- ${r.error}`);
    }
  }

  console.log("");
  if (failed > 0) {
    console.error(`[check] ${failed} of ${results.length} could not be paged. They are not on-call.`);
    process.exit(1);
  }
  console.log("[check] every command ran. Now confirm each person actually received it --");
  console.log("[check] a command exiting zero is not a person waking up.");
  process.exit(0);
}

/**
 * Loads the config, or explains what is wrong and stops.
 *
 * A typo in a roster entry is the likeliest failure anyone hits here, and a stack trace
 * answers a question nobody asked. The config module already writes messages meant to be
 * read; this is what lets them be read.
 */
function load(path: string) {
  try {
    return loadEscalationConfig(path);
  } catch (err: unknown) {
    console.error(`[executor] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

/**
 * Fires one drill now and reports it.
 *
 *   navcom-escalation --drill /etc/navcom/escalation.toml
 *
 * The scheduled ones are randomised inside a week, deliberately, so an operator setting up
 * a roster would otherwise wait days to find out whether it works. This is the same code
 * path a scheduled drill takes -- a "test mode" that exercised something else would be
 * testing something nobody depends on.
 */
async function drillNow(path: string): Promise<never> {
  const config = load(path);
  const { secretKey, pubkey } = loadOrCreateKeypair(config.identity.privkeyPath);
  const executor = new EscalationExecutor({
    config, secretKey, pubkey,
    drillStatePath: config.escalation.drillStatePath,
  });

  await executor.fireDrill();
  await executor.stop();

  const state = readDrillState(config.escalation.drillStatePath);
  console.log(JSON.stringify({ command: "drill", at: new Date().toISOString(), result: state?.last ?? null }, null, 2));
  process.exit(state?.last?.result === "pass" ? 0 : 1);
}

/**
 * The week, for whoever reads the logs.
 *
 *   navcom-escalation --review /etc/navcom/escalation.toml
 *
 * Written before anybody holds the role, deliberately. 10.b defers the reviewer's retrieval
 * path until "a reviewer is named", and nobody accepts a job whose tooling is ssh and a JSONL
 * file -- the two halves have been waiting on each other. "Minutes per week" is a claim the
 * software has to make true first.
 *
 * Exits non-zero when something needs a person, so it can be a weekly cron line that stays
 * quiet on a good week rather than something somebody has to remember to run.
 */
async function reviewNow(path: string, days: number): Promise<never> {
  const config = load(path);
  const drills = readDrillState(config.escalation.drillStatePath);
  const { log, check } = AccountabilityLog.open(config.log.path, config.log.retentionDays);

  const review = buildReview({
    now: Math.floor(Date.now() / 1000),
    days,
    lastDrill: drills?.last ?? null,
    nextDrillAt: drills?.nextAt ?? null,
    entries: log.all(),
    oncall: config.escalation.oncall.map((e) => e.declaration.author.callsign ?? "unnamed"),
    log: {
      entries: log.status().entries,
      startsAt: log.status().startsAt,
      intact: check.intact,
      reason: check.reason,
    },
  });
  log.close();

  for (const line of render(review)) console.log(line);
  process.exit(review.attention.length === 0 ? 0 : 1);
}

function main(): void {
  const path = configPath();
  if (process.argv.includes("--review")) {
    const flag = process.argv.find((a) => a.startsWith("--days="))?.split("=")[1];
    void reviewNow(path, Number(flag) || 7);
    return;
  }
  if (process.argv.includes("--check")) {
    void check(path);
    return;
  }
  if (process.argv.includes("--drill")) {
    void drillNow(path);
    return;
  }
  const config = load(path);
  const { secretKey, pubkey } = loadOrCreateKeypair(config.identity.privkeyPath);

  const roster = config.escalation.oncall;
  const wakeable = roster.filter((e) => e.declaration.channel !== "console-open");

  console.log(`[executor] Watchtower pubkey: ${pubkey}`);
  console.log(`[executor] relays: ${config.relays.urls.join(", ")}`);
  console.log(
    `[executor] windows: paging=${config.escalation.pagingWindowSeconds}s ` +
      `contact=${config.escalation.contactWindowSeconds}s`,
  );

  // By name, never as a total -- and the empty case is stated rather than left to inference.
  if (wakeable.length === 0) {
    console.warn("[executor] ####################################################");
    console.warn("[executor] NOBODY IS ON-CALL. A Distress will page nobody, reach");
    console.warn("[executor] EXHAUSTED immediately, and tell the operator so.");
    console.warn("[executor] That is the ladder working. It is not the ladder helping.");
    console.warn("[executor] ####################################################");
  } else {
    console.log(`[executor] on-call: ${wakeable.map((e) => `${e.declaration.author.callsign} (${e.declaration.channel})`).join(", ")}`);
  }

  /*
   * Who is able to ACKNOWLEDGE, which is a different question from who can be woken.
   *
   * An ack is matched by key. Somebody on-call by phone who does not run NavCom has no key
   * and cannot stop a ladder from their own device -- that is legitimate, and they
   * acknowledge by telling whoever is at the console.
   *
   * But if NOBODY has a key, no acknowledgement can ever be accepted: every ladder runs to
   * EXHAUSTED even when a person is on their way, and every drill fails forever, which
   * demotes the watch permanently. That is worth a paragraph at startup rather than a
   * discovery months later.
   */
  const canAck = roster.filter((e) => e.declaration.author.pubkey);
  if (roster.length > 0 && canAck.length === 0) {
    console.warn("[executor] ####################################################");
    console.warn("[executor] NOBODY ON-CALL HAS A PUBKEY. No acknowledgement can");
    console.warn("[executor] be accepted, so every ladder runs to EXHAUSTED even");
    console.warn("[executor] when somebody is on their way, and every drill FAILS.");
    console.warn("[executor] Add `pubkey = \"...\"` to an [[escalation.oncall]] entry.");
    console.warn("[executor] ####################################################");
  } else if (canAck.length > 0) {
    console.log(`[executor] can acknowledge: ${canAck.map((e) => e.declaration.author.callsign).join(", ")}`);
  }

  const executor = new EscalationExecutor({
    config, secretKey, pubkey,
    drillStatePath: config.escalation.drillStatePath,
  });
  executor.start();
  console.log(
    "[executor] drills every " + config.escalation.drillWindowDays + "d (randomised), " +
      "results -> " + config.escalation.drillStatePath,
  );
  console.log("[executor] listening for 20911. The agent is not in this path.");

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    // Live ladders are lost on restart, and that is stated rather than hidden: a client
    // retrying its Distress will start a fresh one within seconds, which is the behaviour
    // the indefinite-retry requirement exists to produce.
    const live = executor.ladders.all().filter((l) => l.state === "paging" || l.state === "contact");
    if (live.length > 0) {
      console.warn(`[executor] shutting down with ${live.length} ladder(s) still running`);
    }
    console.log(`[executor] received ${signal}, shutting down`);
    executor.stop().then(() => process.exit(0), () => process.exit(1));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main();
