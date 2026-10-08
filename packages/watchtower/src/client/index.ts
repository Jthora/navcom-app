#!/usr/bin/env node
import { Command } from "commander";
import type { SimplePool } from "nostr-tools/pool";
import { nodePool } from "../shared/nostr-node.js";
import { loadOrCreateKeypair } from "../shared/identity.js";
import { loadClientConfig, type ClientConfig } from "./config.js";
import { sendSignal, sendDistressUntilAcknowledged, waitForResponse } from "./signal.js";
import { watchtowerAt, type WatchtowerAddress } from "@navcom/core";

/**
 * Where signals go, and who can read them.
 *
 * One place, so no command can seal to the address when it meant the holders. A box has no
 * `holders` and is its own holder; a squad lists one pubkey per phone.
 */
const watchtowerAddress = (config: ClientConfig): WatchtowerAddress =>
  watchtowerAt(config.watchtower.pubkey, config.watchtower.holders);
import { verifyInclusion, type LogReviewPayload } from "@navcom/core";
import { checkDark } from "./dark.js";
import type { OnStationPayload, QueryPayload, ResponsePayload , AssistPayload } from "../shared/payloads.js";
import { int } from "./parsers.js";

const RESPONSE_TIMEOUT_MS = 10_000;
const DEFAULT_STALE_AFTER_SECONDS = 150; // ~2.5x the daemon's default 60s heartbeat
const SPEC_DEFAULT_ROUTINE_INTERVAL_SECONDS = 3600; // matches the brief's own [watch] default

function configPath(opts: { config?: string }): string {
  return opts.config || process.env.WATCHTOWER_CLIENT_CONFIG || "./client.toml";
}

function printResponse(payload: ResponsePayload, elapsedMs: number): void {
  const verified = payload.provenance !== null;
  const badge = payload.type === "answer" && !verified ? " [UNVERIFIED]" : "";
  const who = payload.responder.callsign ?? payload.responder.pubkey ?? "unknown";
  console.log(`<- ${payload.type} from ${who} (${payload.responder.kind})${badge} (${elapsedMs}ms)`);
  if (payload.text) console.log(payload.text);
}

async function withClient<T>(
  configFlag: { config?: string },
  fn: (ctx: {
    pool: SimplePool;
    config: ClientConfig;
    secretKey: Uint8Array;
    pubkey: string;
  }) => Promise<T>,
): Promise<T> {
  const config = loadClientConfig(configPath(configFlag));
  const { secretKey, pubkey } = loadOrCreateKeypair(config.identity.privkeyPath);
  /*
   * No pool-level reconnect [F04]. It was on so a command mid-wait could survive a relay drop,
   * but nostr-tools' first reconnect waits ten seconds -- the whole of the response window --
   * and on reconnect it rewrote the response subscription's `since` to one past the newest
   * `created_at` any relay had sent, verified or not, in a filter shared by every relay. A
   * `Distress` retried until acknowledged already heals its own listener per relay (core's
   * transport); a one-shot command that times out says so.
   */
  const pool = nodePool();
  try {
    return await fn({ pool, config, secretKey, pubkey });
  } finally {
    pool.destroy();
  }
}

const program = new Command();
program
  .name("watchtower-cli")
  .description("NavCom Watchtower CLI client")
  .option("-c, --config <path>", "path to client.toml");

program
  .command("on-station")
  .description("Sign on to the watch")
  .requiredOption("--area <area>", "coarse area -- district, never an address")
  .requiredOption("--duration <seconds>", "expected duration in seconds", int)
  .option("--routine <seconds>", `routine check-in interval in seconds (omit for the spec default, ${SPEC_DEFAULT_ROUTINE_INTERVAL_SECONDS}s; 0 to disable)`)
  .option("--share-position", "include a position in this signal", false)
  .option("--lat <lat>", "latitude (requires --share-position)", parseFloat)
  .option("--lon <lon>", "longitude (requires --share-position)", parseFloat)
  .option("--precision <meters>", "position precision in meters", parseFloat, 1000)
  .option("--callsign <callsign>", "override the callsign from client.toml")
  .action(async (opts) => {
    // Found in review: --duration accepted any integer including
    // zero/negative, silently sending `expected_until` in the past --
    // the entry would be immediately overdue on the very next sweep.
    // Failing fast locally beats a confusing "why is my just-signed-on
    // entry already overdue" surprise minutes later.
    if (opts.duration <= 0) {
      throw new Error(`--duration must be positive, got ${opts.duration}`);
    }
    // Found in review: --share-position without BOTH --lat and --lon
    // used to silently fall through to `position: null` while still
    // sending `share_position: true` -- the operator asked to share
    // their position, got no error, and nothing was actually shared.
    if (opts.sharePosition && (opts.lat === undefined || opts.lon === undefined)) {
      throw new Error("--share-position requires both --lat and --lon");
    }
    if (opts.lat !== undefined && (opts.lat < -90 || opts.lat > 90)) {
      throw new Error(`--lat must be between -90 and 90, got ${opts.lat}`);
    }
    if (opts.lon !== undefined && (opts.lon < -180 || opts.lon > 180)) {
      throw new Error(`--lon must be between -180 and 180, got ${opts.lon}`);
    }

    await withClient(program.opts(), async ({ pool, config, secretKey, pubkey }) => {
      const callsign = opts.callsign ?? config.operator.callsign;
      // Omitted --routine must NOT become the wire's `null` (which means
      // "disable check-ins") -- that's only what `--routine 0` means.
      // Omitted uses the spec's own documented default instead.
      const routineInterval =
        opts.routine === undefined
          ? SPEC_DEFAULT_ROUTINE_INTERVAL_SECONDS
          : opts.routine === "0"
            ? null
            : parseInt(opts.routine, 10);
      const payload: OnStationPayload = {
        ...(callsign ? { callsign } : {}),
        area: opts.area,
        expected_duration: opts.duration,
        routine_interval: routineInterval,
        share_position: !!opts.sharePosition,
        position: opts.sharePosition ? { lat: opts.lat, lon: opts.lon, precision_m: opts.precision } : null,
      };
      const start = Date.now();
      const sent = await sendSignal(pool, config.relays.urls, secretKey, watchtowerAddress(config), "on-station", payload);
      console.log(`-> on-station area=${opts.area} duration=${opts.duration}s`);
      const response = await waitForResponse(
        pool, config.relays.urls, secretKey, pubkey, config.watchtower.pubkey, sent, RESPONSE_TIMEOUT_MS,
      );
      printResponse(response, Date.now() - start);
    });
  });

program
  .command("routine")
  .description("Send a routine check-in")
  .action(async () => {
    await withClient(program.opts(), async ({ pool, config, secretKey, pubkey }) => {
      const start = Date.now();
      const sent = await sendSignal(pool, config.relays.urls, secretKey, watchtowerAddress(config), "routine", {});
      console.log("-> routine");
      const response = await waitForResponse(
        pool, config.relays.urls, secretKey, pubkey, config.watchtower.pubkey, sent, RESPONSE_TIMEOUT_MS,
      );
      printResponse(response, Date.now() - start);
    });
  });

program
  .command("query")
  .description("Ask the Watchtower a question")
  .requiredOption("--text <text>", "the question")
  .option("--area <area>", "coarse area for context")
  .action(async (opts) => {
    await withClient(program.opts(), async ({ pool, config, secretKey, pubkey }) => {
      const payload: QueryPayload = { text: opts.text, ...(opts.area ? { area: opts.area } : {}) };
      const start = Date.now();
      const sent = await sendSignal(pool, config.relays.urls, secretKey, watchtowerAddress(config), "query", payload);
      console.log(`-> query "${opts.text}"`);
      const response = await waitForResponse(
        pool, config.relays.urls, secretKey, pubkey, config.watchtower.pubkey, sent, RESPONSE_TIMEOUT_MS,
      );
      printResponse(response, Date.now() - start);
    });
  });

program
  .command("assist")
  .description("Request assistance")
  .option("--text <text>", "details")
  .option("--area <area>", "coarse area")
  .option("--now", "urgency: now (default is soon)")
  .action(async (opts) => {
    await withClient(program.opts(), async ({ pool, config, secretKey, pubkey }) => {
      const payload: AssistPayload = {
        urgency: opts.now ? "now" : "soon",
        ...(opts.text ? { text: opts.text } : {}),
        ...(opts.area ? { area: opts.area } : {})
      };
      const start = Date.now();
      const sent = await sendSignal(pool, config.relays.urls, secretKey, watchtowerAddress(config), "assist", payload);
      console.log("-> assist");
      const response = await waitForResponse(
        pool, config.relays.urls, secretKey, pubkey, config.watchtower.pubkey, sent, RESPONSE_TIMEOUT_MS,
      );
      printResponse(response, Date.now() - start);
    });
  });

program
  .command("distress")
  .description("Send a distress signal -- always a deliberate act. Retries until a human answers")
  .option("--text <text>", "details")
  .option("--area <area>", "coarse area, so a responder has somewhere to start")
  .action(async (opts) => {
    await withClient(program.opts(), async ({ pool, config, secretKey, pubkey }) => {
      const start = Date.now();

      // Retries indefinitely, and only Ctrl-C ends it. A single send that gave up after one
      // timeout was the spec MUST this command had been missing: relays do not store
      // ephemeral events, so one failed publish is a signal nobody ever receives.
      const controller = new AbortController();
      const stop = () => {
        console.log("\n-- stood down by the operator. Nothing is still trying.");
        controller.abort();
      };
      process.on("SIGINT", stop);

      console.log("-> DISTRESS (Ctrl-C to stand down)");
      try {
        const response = await sendDistressUntilAcknowledged(
          pool, config.relays.urls, secretKey, pubkey, watchtowerAddress(config),
          { position: null, area: opts.area ?? null, ...(opts.text ? { text: opts.text } : {}) },
          {
            signal: controller.signal,
            onPhase: (p) => {
              switch (p.phase) {
                case "sending": console.log(`   attempt ${p.attempt} sending`); break;
                case "sent": console.log(`   attempt ${p.attempt} left the client`); break;
                // No relay took it: refused, never reached, or not confirmed in time. The account says which.
                case "unreachable": console.log(`   attempt ${p.attempt} NO RELAY TOOK IT: ${p.error}`); break;
                case "also-sending": console.log(`   attempt ${p.attempt} also sending to ${p.relays.join(", ")}`); break;
                case "accounted":
                  console.log(
                    `   attempt ${p.attempt} taken by ${p.took.length} of ` +
                      `${p.took.length + p.refused.length + p.unconfirmed.length + p.unreached.length} relays` +
                      (p.heard ? `, the watch heard on ${p.heard.length}` : "") +
                      (p.unconfirmed.length ? `; ${p.unconfirmed.length} did not confirm and may have it` : "") +
                      (p.withheld.length ? `; not sent to ${p.withheld.map((r) => r.url).join(", ")}` : ""),
                  );
                  break;
                case "no-answer": console.log(`   attempt ${p.attempt} sent, no answer`); break;
                // Nothing was listening, so an answer may have come and gone [G3 phase 1].
                case "could-not-hear": console.log(`   attempt ${p.attempt} COULD NOT HEAR: no relay was listening for an answer`); break;
                case "listening-nowhere":
                  console.log(`   LISTENING ON NO RELAY: ${p.relays.map((r) => `${r.url} (${r.reason})`).join("; ")}`);
                  break;
                case "listening-again": console.log(`   listening again on ${p.relays.join(", ")}`); break;
                // An agent is never the sole responder to Distress [invariant 5].
                case "agent-holding":
                  console.log(`   attempt ${p.attempt} answered by an AGENT (${p.response.responder?.callsign ?? "?"}) -- still looking for a human`);
                  break;
                // The watch's own ladder. It printed nothing at all once these phases existed,
                // including "Couldn't reach anyone" -- a missing case in a switch with no default.
                case "watch-status":
                  console.log(`   attempt ${p.attempt} the watch: ${p.response.text ?? "(no detail)"}`);
                  break;
                case "watch-exhausted":
                  console.log(`   attempt ${p.attempt} NOBODY IS COMING, says the watch: ${p.response.text ?? "(no detail)"} -- still sending; Ctrl-C to stand down`);
                  break;
                case "nobody-answering":
                  console.log(
                    `   ${Math.round(p.elapsedMs / 60000)} min with no human -- assume nobody is coming; still sending` +
                      (p.couldNotHear ? ` (this client could not hear for ${p.couldNotHear.attempts} of ${p.couldNotHear.of} attempts)` : ""),
                  );
                  break;
                // A person answered an earlier Distress, not this one [#0]. Not closure.
                case "acknowledged-earlier":
                  console.log(
                    `   attempt ${p.attempt} ${p.response.responder?.callsign ?? "someone"} acknowledged an EARLIER Distress, ` +
                      `not this one: ${p.response.text ?? "(no detail)"} -- still sending; Ctrl-C to stand down`,
                  );
                  break;
                case "acknowledged": break;
                // A phase added later is printed rather than dropped: a missing case in this switch
                // once hid "Couldn't reach anyone" entirely.
                default: console.log(`   ${JSON.stringify(p)}`);
              }
            }
          },
        );
        printResponse(response, Date.now() - start);
      } finally {
        process.off("SIGINT", stop);
      }
    });
  });

program
  .command("log-review")
  .description("Show what the watch has written about you, and check it")
  .option("--since <unix>", "only entries at or after this unix second")
  .option("--limit <n>", "how many at most")
  .action(async (opts) => {
    await withClient(program.opts(), async ({ pool, config, secretKey, pubkey }) => {
      const payload: LogReviewPayload = {
        ...(opts.since ? { since: Number(opts.since) } : {}),
        ...(opts.limit ? { limit: Number(opts.limit) } : {}),
      };
      const sent = await sendSignal(pool, config.relays.urls, secretKey, watchtowerAddress(config), "log-review", payload);
      const response = await waitForResponse(
        pool, config.relays.urls, secretKey, pubkey, config.watchtower.pubkey, sent, RESPONSE_TIMEOUT_MS,
      );

      if (!response.review) {
        console.log(response.text ?? "no review returned");
        return;
      }
      const { review } = response;

      // The CLI holds no root history, so it cannot do the check that matters. Saying so is
      // the point: a tick here would mean the watch had verified itself.
      console.log(`root ${review.root.root.slice(0, 16)}… over ${review.root.size} entries`);
      console.log("NOT CHECKED against a root seen published — this client keeps no history.");
      console.log("");

      for (const { entry, proof } of review.entries) {
        const proven = verifyInclusion(entry, proof, review.root);
        const when = new Date(entry.at * 1000).toISOString().replace("T", " ").slice(0, 16);
        console.log(`${proven ? " " : "!"} ${when}  ${entry.action.padEnd(15)} ${entry.outcome}`);
      }
      if (review.entries.length === 0) console.log("(nothing recorded about you)");
      if (review.more) console.log("\n… more not shown. Narrow with --since.");
    });
  });

program
  .command("stood-down")
  .description("Stand down from the watch -- your board entry is removed, not marked")
  .action(async () => {
    await withClient(program.opts(), async ({ pool, config, secretKey, pubkey }) => {
      const start = Date.now();
      const sent = await sendSignal(pool, config.relays.urls, secretKey, watchtowerAddress(config), "stood-down", {});
      console.log("-> stood-down");
      const response = await waitForResponse(
        pool, config.relays.urls, secretKey, pubkey, config.watchtower.pubkey, sent, RESPONSE_TIMEOUT_MS,
      );
      printResponse(response, Date.now() - start);
    });
  });

program
  .command("status")
  .description("Check whether the Watchtower is live or dark")
  .option("--stale-after <seconds>", "treat the watch state as dark if older than this", int, DEFAULT_STALE_AFTER_SECONDS)
  .action(async (opts) => {
    await withClient(program.opts(), async ({ pool, config }) => {
      const result = await checkDark(pool, config.relays.urls, config.watchtower.pubkey, opts.staleAfter);
      if (result.dark) {
        console.log(`DARK (${result.reason}${result.ageSeconds !== undefined ? `, age=${result.ageSeconds}s` : ""})`);
        return;
      }
      console.log(`LIVE (age=${result.ageSeconds}s)`);
      console.log(JSON.stringify(result.state, null, 2));
    });
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
