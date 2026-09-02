#!/usr/bin/env node
import { DEFAULT_RELAYS } from "@navcom/core";
import { checkRelays, needsAttention, render } from "./conformance.js";

/**
 * Can the relays this app ships with carry its traffic?
 *
 *   navcom-relay-check                       # the shipped defaults
 *   navcom-relay-check wss://my.relay        # or any relay you are considering
 *
 * Exits non-zero only when a claim **failed**, so it can be a cron line that stays quiet.
 * A relay that could not be reached exits zero and says so: an unreachable relay has not
 * failed a conformance claim, and waking somebody to rebuild a working box while their
 * network is down is worse than telling them nothing.
 *
 * ## Why this exists, and why now
 *
 * Build order 0.2 has said from the start that this has "never crossed a real relay". The
 * local-relay suite closed most of that and was explicit about what it left open: whether
 * `relay.damus.io` behaves. Every other test in this project proves the app is correct when a
 * relay is correct.
 *
 * `Distress` is ephemeral (kind 20911, range 20000-29999), and relays are not obliged to
 * forward ephemeral events. If one of ours declined to, `Distress` would never leave the
 * phone, invariant 2 would fail silently, and the whole suite would still be green.
 *
 * The answer, first run, 2026-09-02: both defaults pass all five claims. That is the good
 * outcome and it was genuinely unknown. It is worth re-asking, because a relay that forwards
 * ephemeral events today can stop tomorrow and nothing would announce it.
 */
async function main(): Promise<never> {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const urls = args.length > 0 ? args : [...DEFAULT_RELAYS];

  if (args.length === 0) console.log("[relay-check] the shipped defaults\n");
  const results = await checkRelays(urls);
  for (const line of render(results)) console.log(line);

  process.exit(needsAttention(results) ? 1 : 0);
}

void main();
