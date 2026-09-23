#!/usr/bin/env node
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { SimplePool } from "nostr-tools/pool";
import type { Event } from "nostr-tools/core";
import { parse } from "smol-toml";
import { KIND_DISTRESS } from "@navcom/core";
import { isValidHexPubkey } from "../shared/validate.js";
import { emptyState, forgetOld, markPaged, shouldPage, REPAGE_AFTER_SECONDS } from "./decide.js";

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

  const urls = raw.relays?.urls;
  if (!urls?.length || urls.some((u) => typeof u !== "string" || !/^wss?:\/\//.test(u))) {
    throw new Error(`Config [relays] urls must list at least one ws:// or wss:// URL (${path})`);
  }

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

function main(): void {
  const path = process.argv[2] ?? "/etc/navcom/pager.toml";
  const config = load(path);
  const state = emptyState();
  const pool = new SimplePool();

  console.log(`[pager] watching for Distress addressed to ${config.watchtower}`);
  console.log(`[pager] relays: ${config.relays.join(", ")}`);
  console.log(`[pager] holds no key. It can see that a Distress arrived and nothing inside it.`);

  pool.subscribeMany(config.relays, { kinds: [KIND_DISTRESS], "#p": [config.watchtower] }, {
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

  setInterval(() => forgetOld(state, Math.floor(Date.now() / 1000)), 600_000);
}

try {
  main();
} catch (err) {
  console.error(`[pager] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
