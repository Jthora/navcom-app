#!/usr/bin/env node
import { existsSync } from "node:fs";
import { loadEscalationConfig, type EscalationConfig } from "./config.js";
import type { Keypair } from "../shared/identity.js";
import { EscalationExecutor, ageWindowSeconds, executorSubscription } from "./executor.js";
import { pushTemplateGaps, testPage } from "./pager.js";
import { readDrillState } from "./drills.js";
import { buildReview, render } from "./review.js";
import { AccountabilityLog } from "../shared/accountability.js";
import { nodePool } from "../shared/nostr-node.js";
import { probeRelays } from "../shared/subscription-check.js";
import { readHearing } from "../shared/hearing.js";
import {
  boxKeysOnRoster,
  checkKeyFile,
  daemonAdminNote,
  earlierExecutorKeys,
  loadExecutorKey,
  loadWatchKey,
  NO_EXECUTOR_KEY,
  readersHere,
  readReplaced,
  relaysTakeBoth,
  replacedLines,
  watchCode,
  watchStateSeen,
  whyNotMake,
  writeReplaced,
  type ExecutorKey,
} from "./keys.js";

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
 *
 * Before the roster, it asks each relay for the subscription this executor makes, and fails when
 * none answers: a roster that pages perfectly pages nobody if no `Distress` reaches the executor.
 */
async function check(path: string): Promise<never> {
  const config = load(path);
  const roster = config.escalation.oncall.filter((e) => e.declaration.channel !== "console-open");

  // Who can end a Distress comes before who can be woken: a box whose key the agent can read pages
  // perfectly and can still tell an operator a person has them.
  const keysOk = await checkExecutorKey(config);
  for (const line of templateLines(config, "[check]")) console.warn(line);
  // Where a Distress reaches this executor at all, before who it would wake. Without the watch key
  // there is no subscription to ask for, and the key check above has already failed.
  let hearsOk = false;
  try {
    hearsOk = await checkHearing(config, loadWatchKey(config.identity.privkeyPath).pubkey);
  } catch {
    hearsOk = false;
  }

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
  process.exit(keysOk && hearsOk ? 0 : 1);
}

/**
 * Asks each relay for the subscription this executor makes, exactly as it makes it, and says which
 * answer it; then reads where the running executor says it hears. Returns whether some relay answers.
 *
 * A relay can take this box's writes and serve its watch state to anybody while refusing the
 * executor's `#p` REQ -- an inbox that wants NIP-42 AUTH -- or taking it and never answering. A
 * `Distress` sent only there pages nobody from here, and a daemon reading the hearing file withholds
 * the watch state there. `--check` asked no relay for it.
 *
 * The running executor's own file is reported and never fails the check: `--check` is often run
 * before the executor has started.
 */
async function checkHearing(config: EscalationConfig, watch: string): Promise<boolean> {
  console.log("[check] asking each relay for the subscription this executor makes, as it makes it");
  const pool = nodePool();
  let answering = 0;
  try {
    const reach = await probeRelays(
      pool,
      config.relays.urls,
      // The running executor's own filter, asking for nothing stored.
      { ...executorSubscription(watch), limit: 0 },
      { timeoutMs: 8_000, connectMs: 5_000, noun: "the subscription" },
    );
    for (const r of reach) {
      if (!r.reached) console.error(`[check]   ${r.url}: UNREACHABLE -- ${r.error ?? "no reason given"}`);
      else if (r.hears) {
        answering++;
        console.log(`[check]   ${r.url}: answers it -- a Distress sent there reaches this executor`);
      } else {
        console.error(
          `[check]   ${r.url}: DOES NOT HEAR -- ${r.deaf ?? "did not answer the subscription"}. A Distress sent only ` +
            "there pages nobody from this executor, and a daemon reading its hearing file withholds the watch state there",
        );
      }
    }
  } finally {
    pool.destroy();
  }
  if (answering === 0) {
    console.error(
      "[check] THIS EXECUTOR HEARS ON NO RELAY IN THIS CONFIG, so a Distress pages nobody from here. Pick a relay " +
        "that serves it without NIP-42 AUTH, or fix the one that is not answering",
    );
  }

  const path = config.escalation.hearingStatePath;
  if (path) {
    const read = readHearing(path, { watch, now: Math.floor(Date.now() / 1000) });
    if (read.ok) {
      const heard = read.relays.filter((r) => r.hears).length;
      console.log(
        `[check] the running executor's hearing file (${path}, ${read.ageSeconds}s old) says it hears on ` +
          `${heard}/${read.relays.length} relay(s)`,
      );
      for (const r of read.relays) {
        if (!r.hears) console.warn(`[check]   ${r.url}: the running executor does not hear there -- ${r.why ?? "no reason given"}`);
      }
    } else {
      console.warn(`[check] the running executor's hearing file: ${read.why} -- a daemon reading it treats this executor as hearing nowhere`);
    }
  }
  console.log("");
  return answering > 0;
}

/**
 * The keys, for `--check`: the watch key present and the daemon's, the executor's own present, readable by
 * nobody but this user, and taken by every relay with the watch key's copy, and neither key on the roster.
 * Returns whether it passed. A box with no executor key configured is said and is not a failure: a box set
 * up before the key existed keeps working exactly as it did, and `--check` says what that costs.
 *
 * Makes neither key. A check that creates what it checks would pass a box that never ran.
 */
async function checkExecutorKey(config: EscalationConfig): Promise<boolean> {
  // The watch key first: one made here would be a new watch, nobody's phone would know it, and every
  // relay check below would pass for it.
  let watch: Keypair;
  try {
    watch = loadWatchKey(config.identity.privkeyPath);
  } catch (err: unknown) {
    console.error(`[check] WATCH KEY: ${err instanceof Error ? err.message : String(err)}`);
    console.error("");
    return false;
  }
  console.log(`[check] watch key: ${watch.pubkey}`);
  let ok = true;

  const pool = nodePool();
  try {
    // The only way to see from here that it is the daemon's key: the daemon publishes its state with it.
    const seen = await watchStateSeen(pool, config.relays.urls, watch.pubkey).catch(() => false);
    if (seen) console.log("[check]   a relay holds a watch state signed by it -- the daemon is publishing with this key");
    else {
      console.warn(
        "[check]   no relay holds a watch state signed by this key. If the daemon is running, privkey_path is not " +
          "its key, and this executor would hear no Distress meant for this watch. Compare it with the pubkey the daemon prints at start",
      );
    }

    const path = config.identity.executorKeyPath;
    if (!path) {
      ok = rosterKeysOk(config, [watch.pubkey]) && ok;
      for (const line of NO_EXECUTOR_KEY) console.warn(`[check] ${line}`);
      console.warn("");
      return ok;
    }
    let key: ExecutorKey;
    try {
      // Not made here, for the same reason as the watch key, and because a key made by whoever ran --check
      // is born readable by them.
      if (!existsSync(path)) throw new Error(`there is nothing at ${path}. The executor makes it on its first start, as the user it runs as`);
      key = loadExecutorKey(path);
    } catch (err: unknown) {
      console.error(`[check] EXECUTOR KEY: ${err instanceof Error ? err.message : String(err)}`);
      console.error("");
      return false;
    }
    ok = rosterKeysOk(config, [watch.pubkey, key.pubkey]) && ok;
    console.log(`[check] executor key: ${key.pubkey}`);
    const problems = checkKeyFile(path, config.identity.daemonUser);
    if (key.pubkey === watch.pubkey) problems.push("it is the watch key -- a phone reads it as no executor key at all");
    for (const p of problems) {
      ok = false;
      console.error(`[check]   REFUSED: ${p}`);
    }
    if (problems.length === 0) {
      // What the file shows, and no more: root, and sudo, can read it regardless.
      console.log(`[check]   only this user can read it; the daemon's user (${config.identity.daemonUser}) is not root and does not own it`);
      const note = daemonAdminNote(config.identity.daemonUser);
      if (note) console.warn(`[check]   ${note}`);
    }
    const replaced = readReplaced(path);
    if (replaced) {
      ok = false;
      for (const line of replacedLines(path, key.pubkey, replaced)) console.error(`[check]   REFUSED: ${line}`);
    }

    console.log("[check] asking each relay to take one test response signed by each key, as the executor sends them");
    let relaysOk = true;
    for (const r of await relaysTakeBoth(pool, config.relays.urls, watch, key)) {
      if (r.watch === null && r.executor === null) console.log(`[check]   ${r.url}: takes both keys`);
      else if (r.watch === null) {
        relaysOk = false;
        console.error(
          `[check]   ${r.url}: REFUSED -- takes the watch key and refuses the executor's (${r.executor}). A phone given the ` +
            "executor key hears only the watch key's copies from here, and no Distress ends on them. Drop this relay",
        );
      } else if (r.executor === null) {
        relaysOk = false;
        console.error(
          `[check]   ${r.url}: REFUSED -- takes the executor's key and refuses the watch key's copy (${r.watch}). A phone ` +
            "handed this watch before it named the executor key hears nothing from here. Drop this relay",
        );
      } else console.warn(`[check]   ${r.url}: took neither (${r.executor}) -- unreachable from here, or refusing this box`);
    }
    ok = ok && relaysOk;
    // The code a phone is handed, once the key is fit to hand over.
    if (problems.length === 0 && relaysOk) {
      console.log(`[check] watch code, carrying the executor's key -- hand it to operators: ${watchCode(watch, config.relays.urls, key.pubkey)}`);
    }
  } finally {
    pool.destroy();
  }
  console.log("");
  return ok;
}

/** Whether any on-call entry uses the watch's own key or the executor's, said either way it fails. */
function rosterKeysOk(config: EscalationConfig, boxKeys: string[], prefix = "[check]"): boolean {
  const named = boxKeysOnRoster(config.escalation.oncall, boxKeys);
  for (const who of named) {
    console.error(
      `${prefix}   REFUSED: ${who} is on call with the watch's own key. The daemon and the agent beside it hold that key, so ` +
        "the executor refuses an acknowledgement or a wake signed with it. Give them a key of their own",
    );
  }
  return named.length === 0;
}

/** Each navcom-push entry whose template cannot yet say what kind of page it carries. */
function templateLines(config: EscalationConfig, prefix: string): string[] {
  const lines: string[] = [];
  for (const entry of config.escalation.oncall) {
    for (const gap of pushTemplateGaps(entry)) {
      lines.push(`${prefix} ${entry.declaration.author.callsign} (${entry.declaration.channel}): ${gap}`);
    }
  }
  if (lines.length > 0) lines.push(`${prefix} the template that says all three is in escalation.example.toml`);
  return lines;
}

/**
 * The watch key, or a loud stop [review: box safety]. Never made here: the daemon makes it, and a new one
 * would be a watch no phone knows -- an executor that hears no Distress meant for this watch while it
 * looks healthy. Stopped instead, which a supervisor restarts and a journal shows.
 */
function watchKeyOrExit(config: EscalationConfig): Keypair {
  try {
    return loadWatchKey(config.identity.privkeyPath);
  } catch (err: unknown) {
    console.error("[executor] ####################################################");
    console.error(`[executor] NO WATCH KEY: ${err instanceof Error ? err.message : String(err)}`);
    console.error("[executor] Not starting. With a key no phone knows, this executor would hear no Distress");
    console.error("[executor] meant for this watch and page for none of them, while it looked healthy.");
    console.error("[executor] ####################################################");
    process.exit(1);
  }
}

/**
 * The executor's own key at startup: loaded, or made, and said -- or, where the config names none, what
 * running without it costs. Said at every start, not once: it is the box's standing state.
 *
 * **Made only by the long-running start, and only as a user of its own** (`mayMake`; {@link whyNotMake}):
 * never by `--drill`, and never where `daemon_user` is unset, unknown, root, or this process's own user.
 * A key born readable by the daemon's user looks clean after a `chown`, and nothing would record it had
 * been exposed. Where it is not made, the box runs without one and says why.
 *
 * **A key made where the log names an earlier one is a replacement**, and every phone handed the old one
 * can no longer end a `Distress`. It is still made -- the box must keep answering -- and said loudly at
 * every start, and `--check` fails, until a person removes the record beside it.
 *
 * A key that fails the file check still signs. Paging nobody is the worse failure, and a phone given this
 * key ends a Distress on nothing else, so dropping it would leave every phone that has it unable to close.
 * It is not offered for handing out until it passes.
 */
function executorKeyAtStart(config: EscalationConfig, watch: Keypair, mayMake: boolean): ExecutorKey | undefined {
  const path = config.identity.executorKeyPath;
  if (!path) {
    console.warn("[executor] ####################################################");
    for (const line of NO_EXECUTOR_KEY) console.warn(`[executor] ${line}`);
    console.warn("[executor] ####################################################");
    return undefined;
  }
  if (!existsSync(path)) {
    const why = mayMake
      ? whyNotMake(readersHere(config.identity.daemonUser))
      : "--drill never makes it; the executor's own start does, as the user it runs as";
    if (why) {
      console.error("[executor] ####################################################");
      console.error(`[executor] NO EXECUTOR KEY at ${path}, and not making one: ${why}.`);
      console.error("[executor] Running without it: every answer is signed with the watch key alone, as on a box");
      console.error("[executor] that names no executor key. The ladder runs, and pages, regardless.");
      console.error("[executor] ####################################################");
      return undefined;
    }
  }
  let key: ExecutorKey;
  try {
    key = loadExecutorKey(path);
  } catch (err: unknown) {
    /*
     * A key that cannot be read -- corrupt, truncated, a directory this user cannot enter -- must not
     * stop the ladder: paging nobody is the worse failure. Without it every response is signed with
     * the watch key alone, which a phone handed this key shows and never ends a Distress on.
     */
    console.error("[executor] ####################################################");
    console.error(`[executor] COULD NOT LOAD THE EXECUTOR'S KEY: ${err instanceof Error ? err.message : String(err)}`);
    console.error("[executor] Running without it. A phone handed that key shows every answer");
    console.error("[executor] from this box and ends no Distress on any of them until this is fixed.");
    console.error("[executor] The ladder runs, and pages, regardless.");
    console.error("[executor] ####################################################");
    return undefined;
  }
  if (key.pubkey === watch.pubkey) {
    console.error(`[executor] executor_key_path holds the watch key -- no executor key. ${NO_EXECUTOR_KEY[0]}`);
    return undefined;
  }
  if (key.created) {
    console.log(`[executor] made the executor's own key at ${path}, readable only by this user`);
    const earlier = earlierExecutorKeys(config.log.path, [watch.pubkey, key.pubkey]);
    if (earlier.length > 0) {
      try {
        writeReplaced(path, { at: Math.floor(Date.now() / 1000), replaces: earlier });
      } catch (err: unknown) {
        console.error(`[executor] could not record that this key replaces another: ${String(err)}`);
      }
    }
  }
  console.log(`[executor] executor key: ${key.pubkey}`);
  console.log("[executor] every response is signed with it, and copied under the watch key for phones not handed it");
  const replaced = readReplaced(path);
  if (replaced) {
    console.error("[executor] ####################################################");
    for (const line of replacedLines(path, key.pubkey, replaced)) console.error(`[executor] ${line}`);
    console.error("[executor] ####################################################");
  }
  const problems = checkKeyFile(path, config.identity.daemonUser);
  if (problems.length > 0) {
    console.error("[executor] ####################################################");
    console.error("[executor] THE EXECUTOR'S KEY IS NOT ITS OWN:");
    for (const p of problems) console.error(`[executor]   ${p}`);
    console.error("[executor] Whoever can read it can sign 'a person has it', and a phone handed");
    console.error("[executor] this key believes that over anything else. The ladder runs regardless.");
    console.error("[executor] Do not hand it to operators until this is fixed.");
    console.error("[executor] navcom-escalation --check keeps failing until it is.");
    console.error("[executor] ####################################################");
    return key;
  }
  const note = daemonAdminNote(config.identity.daemonUser);
  if (note) console.warn(`[executor] ${note}`);
  console.log(
    "[executor] a phone given this key ends a Distress only on an answer it signed. Hand operators this watch code, " +
      "which carries it -- the key is never typed into a phone:",
  );
  console.log(`[executor] watch code: ${watchCode(watch, config.relays.urls, key.pubkey)}`);
  return key;
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
  const watch = watchKeyOrExit(config);
  const { secretKey, pubkey } = watch;
  const executorKey = executorKeyAtStart(config, watch, false);
  const executor = new EscalationExecutor({
    config, secretKey, pubkey,
    ...(executorKey ? { executorKey } : {}),
    drillStatePath: config.escalation.drillStatePath,
  });

  await executor.drillOnce();

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
  const watch = watchKeyOrExit(config);
  const { secretKey, pubkey } = watch;

  const roster = config.escalation.oncall;
  const wakeable = roster.filter((e) => e.declaration.channel !== "console-open");

  console.log(`[executor] Watchtower pubkey: ${pubkey}`);
  console.log(`[executor] relays: ${config.relays.urls.join(", ")}`);
  console.log(
    `[executor] windows: paging=${config.escalation.pagingWindowSeconds}s ` +
      `contact=${config.escalation.contactWindowSeconds}s ack_holds=${config.escalation.ackHoldsSeconds}s`,
  );
  // Said, because shortening the paging window used to narrow which phones were heard as well.
  const ageWindow = ageWindowSeconds(config);
  if (ageWindow !== config.escalation.pagingWindowSeconds) {
    console.log(
      `[executor] a Distress stamped more than ${ageWindow}s from this machine's clock is ignored -- not ` +
        `${config.escalation.pagingWindowSeconds}s, the paging window: a phone reads this watch as up until its ` +
        `state is ${ageWindow}s old, so it must be heard that far off`,
    );
  }

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

  // Each navcom-push entry whose template cannot yet say what kind of page it carries, said each start.
  for (const line of templateLines(config, "[executor]")) console.warn(line);
  const executorKey = executorKeyAtStart(config, watch, true);
  // Neither of the box's own keys is a person's: an acknowledgement or a wake from either is refused.
  const boxOnRoster = boxKeysOnRoster(roster, [pubkey, ...(executorKey ? [executorKey.pubkey] : [])]);
  if (boxOnRoster.length > 0) {
    console.error("[executor] ####################################################");
    console.error(`[executor] ON CALL WITH THE WATCH'S OWN KEY: ${boxOnRoster.join(", ")}. The daemon and the`);
    console.error("[executor] agent beside it hold that key, so an acknowledgement or a wake signed with it");
    console.error("[executor] is refused. Give them a key of their own.");
    console.error("[executor] ####################################################");
  }

  const executor = new EscalationExecutor({
    config, secretKey, pubkey,
    ...(executorKey ? { executorKey } : {}),
    drillStatePath: config.escalation.drillStatePath,
    // The long-running start only: `--drill` never writes it.
    ...(config.escalation.hearingStatePath ? { hearingStatePath: config.escalation.hearingStatePath } : {}),
  });
  executor.start();
  console.log(
    "[executor] drills every " + config.escalation.drillWindowDays + "d (randomised), " +
      "results -> " + config.escalation.drillStatePath,
  );
  if (config.escalation.hearingStatePath) {
    console.log(
      `[executor] where it hears -> ${config.escalation.hearingStatePath}, every 30s and on any change. The daemon ` +
        "publishes the watch state only where both hear, once its [log] hearing_state_path names this file",
    );
  }
  // Not "listening": each relay says so itself once its subscription is answered, and says
  // when it is not [F05, F08]. Announcing it here was true only if every relay was.
  console.log(
    `[executor] subscribing for 20911 on ${new Set(config.relays.urls).size} relay(s); ` +
      "each says when it is listening. The agent is not in this path.",
  );

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
