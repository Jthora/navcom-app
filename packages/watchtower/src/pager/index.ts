#!/usr/bin/env node
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import type { Event } from "nostr-tools/core";
import { parse } from "smol-toml";
import { KIND_DISTRESS } from "@navcom/core";
import { isValidHexPubkey } from "../shared/validate.js";
import { nodePool } from "../shared/nostr-node.js";
import { RelayListener } from "../shared/relay-listener.js";
import { relayList } from "../shared/relay-urls.js";
import { probeRelays } from "../shared/subscription-check.js";
import { emptyState, forgetOld, markPaged, shouldPage, REPAGE_AFTER_SECONDS } from "./decide.js";

/** How long a starting pager waits for a first relay before saying it is not watching. */
const BOOT_GRACE_SECONDS = 15;

/**
 * A pager that holds no key.
 *
 * A `20911` is addressed to a Watchtower, so **anyone watching the relays can see that a
 * Distress arrived without being able to read a byte of it.** That means the *wake somebody
 * up* half of escalation can run on a cheap always-on machine anywhere, operated by anyone,
 * learning nothing about any operator, any position, or any question they asked.
 *
 * ## What it cannot do, structurally
 *
 * There is **no key anywhere in this file or its config.** Not an optional field, not a
 * commented-out one. That is the whole design:
 *
 * - It cannot read a Distress. It knows one arrived and who signed it, both of which are on
 *   the wire in the clear for anybody already watching
 * - It cannot answer one. Answering requires signing as the Watchtower, and it has nothing
 *   to sign with — so it can never become the thing that closes a `Distress` [invariant 2]
 * - It cannot tell the operator anything. Invariant 2 requires that they be told, and that
 *   reporting stays with the keyed executor
 *
 * **It is a supplement, never a replacement.** Run several. Duplicate pages are a nuisance;
 * a missed page is not.
 *
 * ## What it is for
 *
 * Redundancy without trust. The keyed executor is the thing that must not fail, and it runs
 * on one box that somebody has to keep alive. This runs anywhere — a friend's Raspberry Pi,
 * a $4 VPS, a spare laptop — and the person running it has to be trusted with nothing,
 * because it learns nothing.
 *
 * Normative source: docs/spec/escalation.spec.md
 */

interface PagerConfig {
  watchtower: string;
  relays: string[];
  command: string[];
  repageAfterSeconds: number;
}

function load(path: string): PagerConfig {
  if (!existsSync(path)) {
    throw new Error(`Pager config not found at ${path}. Copy pager.example.toml to start.`);
  }
  const raw = parse(readFileSync(path, "utf8")) as {
    watchtower?: { pubkey?: string };
    relays?: { urls?: string[] };
    page?: { command?: string[]; repage_after_seconds?: number };
  };

  const pubkey = raw.watchtower?.pubkey;
  if (!pubkey || !isValidHexPubkey(pubkey)) {
    throw new Error(
      `Config [watchtower] pubkey must be 64 lowercase hex characters (${path}). ` +
        `This is the only thing this process needs to know, and it is public.`,
    );
  }

  const urls = relayList(raw.relays?.urls, path);

  const command = raw.page?.command;
  if (!Array.isArray(command) || command.length === 0 || command.some((a) => typeof a !== "string")) {
    // A pager with no way to wake anybody is a process that watches a relay and does
    // nothing. Refused at startup rather than discovered during an emergency.
    throw new Error(
      `Config [page] command must be an argv array (${path}). A pager that cannot wake ` +
        `anybody is not a pager.`,
    );
  }

  return {
    watchtower: pubkey,
    relays: urls,
    command,
    repageAfterSeconds: raw.page?.repage_after_seconds ?? REPAGE_AFTER_SECONDS,
  };
}

/** Per-argument substitution. Never a shell string, so nothing on the wire can become one. */
const fill = (argv: string[], vars: Record<string, string>): string[] =>
  argv.map((a) => a.replace(/\{\{(\w+)\}\}/g, (whole, k: string) => vars[k] ?? whole));

/**
 * The subscription this pager makes on every relay: every `Distress` addressed to the watch. `--check`
 * asks each relay for exactly this, so it cannot pass a relay that refuses the one the running pager
 * depends on.
 */
function pagerSubscription(watchtower: string): { kinds: number[]; "#p": string[] } {
  return { kinds: [KIND_DISTRESS], "#p": [watchtower] };
}

/**
 * Whether this pager would hear a Distress, and where -- and nothing paged.
 *
 *   navcom-pager --check /etc/navcom/pager.toml
 *
 * Asks each relay for the subscription this pager makes, exactly as it makes it. A relay can serve
 * the watch to anybody and refuse this one REQ (an inbox that wants NIP-42 AUTH) or hold it
 * unanswered, and the pager may run on another machine with other relays, so only its own check can
 * see them. Exits non-zero when no relay answers: a pager that hears nowhere pages nobody.
 */
async function check(config: PagerConfig): Promise<never> {
  console.log("[pager] --check: asking each relay for the subscription this pager makes. Nothing is paged");
  const pool = nodePool();
  let answering = 0;
  try {
    const reach = await probeRelays(
      pool,
      config.relays,
      { ...pagerSubscription(config.watchtower), limit: 0 },
      { timeoutMs: 8_000, connectMs: 5_000, noun: "the subscription" },
    );
    for (const r of reach) {
      if (!r.reached) console.error(`[pager]   ${r.url}: UNREACHABLE -- ${r.error ?? "no reason given"}`);
      else if (r.hears) {
        answering++;
        console.log(`[pager]   ${r.url}: answers it -- a Distress sent there pages from here`);
      } else {
        console.error(
          `[pager]   ${r.url}: DOES NOT HEAR -- ${r.deaf ?? "did not answer the subscription"}. A Distress sent only ` +
            "there pages nobody from here",
        );
      }
    }
  } finally {
    pool.destroy();
  }
  console.log(`[pager] hears on ${answering}/${config.relays.length} relay(s)`);
  if (answering === 0) {
    console.error(
      "[pager] THIS PAGER HEARS ON NO RELAY IN THIS CONFIG, so it would page nobody. Pick a relay that serves it " +
        "without NIP-42 AUTH, or fix the one that is not answering",
    );
    process.exit(1);
  }
  process.exit(0);
}

function main(): void {
  // Skips flags, or `--check` itself becomes the config path.
  const path = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "/etc/navcom/pager.toml";
  const config = load(path);
  if (process.argv.includes("--check")) {
    check(config).catch((err: unknown) => {
      console.error(`[pager] --check failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
    return;
  }
  const state = emptyState();
  // Through the factory: on Node 20 there is no global WebSocket, and a bare SimplePool printed
  // that it was watching while it could not open a single socket [F07]. Ping, so a connection a
  // router reboot killed without a word is noticed rather than trusted for ever [F06].
  const pool = nodePool({ enablePing: true });

  // "Starting", not "watching". This said it was watching before it had connected to anything,
  // and went on saying nothing when every relay dropped [F06]. It says it is watching when a
  // relay is actually listening, and says loudly when none is.
  console.log(`[pager] starting: will watch for Distress addressed to ${config.watchtower}`);
  console.log(`[pager] relays: ${config.relays.join(", ")}`);
  console.log(`[pager] holds no key. It can see that a Distress arrived and nothing inside it.`);

  let watching = false;
  /** Whether NOT WATCHING is the last thing said, so it is said once per fall rather than per relay. */
  let saidNot = false;
  const notWatching = (why: string) => {
    saidNot = true;
    console.error(
      `[pager] NOT WATCHING -- ${why}. A Distress raised now pages nobody from here until one ` +
        "answers; retrying.",
    );
  };
  const listener = new RelayListener({
    pool,
    urls: config.relays,
    filter: pagerSubscription(config.watchtower),
    label: "pager",
    missing: "a Distress sent only there pages nobody from here",
    onchange: (listening, total) => {
      if (listening > 0 && !watching) {
        watching = true;
        saidNot = false;
        console.log(`[pager] watching on ${listening}/${total} relay(s)`);
      } else if (listening === 0 && watching) {
        watching = false;
        // "Listening", not "reachable": a relay that is up and refusing, or hung, is not listening
        // either, and its own line above says which [review: relay paths].
        notWatching("no relay is listening");
      }
    },
    onevent: (event: Event) => {
      const now = Math.floor(Date.now() / 1000);
      if (!shouldPage(state, { id: event.id, author: event.pubkey, at: event.created_at }, now, config.repageAfterSeconds)) {
        return;
      }

      // Deliberately terse, and deliberately without the operator's callsign -- this process
      // cannot decrypt the payload, so it does not have one, and inventing a label from a
      // pubkey would suggest it knows more than it does.
      const message =
        `NAVCOM DISTRESS. An operator has raised a Distress and is waiting for a human. ` +
        `Open the terminal and acknowledge it.`;

      /*
       * Bounded before it is formatted.
       *
       * `created_at` is wire data. Past about 8.64e12 seconds `toISOString()` throws a
       * RangeError inside `onevent`, nostr-tools swallows it as a message-processing warning,
       * and the page is dropped with no `[pager]` line at all — while the operator had already
       * been marked as paged, suppressing their real retries for the next five minutes.
       */
      const stampedAt = Number.isFinite(event.created_at) && Math.abs(event.created_at) < 8.64e12
        ? new Date(event.created_at * 1000).toISOString()
        : "unknown";
      const argv = fill(config.command, { message, at: stampedAt });
      const [cmd, ...args] = argv;
      execFile(cmd!, args, { timeout: 30_000 }, (err) => {
        const stamp = new Date().toISOString();
        // Counted only when it went. A failure must leave the next retry free to try again.
        if (!err) markPaged(state, event.pubkey, Math.floor(Date.now() / 1000));
        // Both outcomes are printed. A pager whose command silently fails is worse than no
        // pager, because somebody is counting on it.
        console.log(
          err
            ? `[pager] ${stamp} PAGE FAILED for ${event.pubkey.slice(0, 8)}: ${err.message}`
            : `[pager] ${stamp} paged for ${event.pubkey.slice(0, 8)}`,
        );
      });
    },
  });
  listener.start();

  // A pager that boots into an outage never fell from watching, so it said nothing at all
  // [review: relay paths]. Said once, after every relay has had its first try.
  setTimeout(() => {
    if (!watching && !saidNot) notWatching("no relay has answered since this started");
  }, BOOT_GRACE_SECONDS * 1000).unref();

  setInterval(() => forgetOld(state, Math.floor(Date.now() / 1000)), 600_000);
}

try {
  main();
} catch (err) {
  console.error(`[pager] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
