#!/usr/bin/env node
import { DEFAULT_RELAYS } from "@navcom/core";
import { checkRelays, needsAttention, render } from "./conformance.js";

/**
 * The relay conformance suite, as something a person can run.
 *
 * The five claims were written, they work, and they passed against `relay.damus.io` and
 * `nos.lol` — and they were wired to no script and no page, which by this project's own
 * standard means they were not built. `panicWipe` sat buttonless for weeks the same way.
 * This is the button.
 *
 *   npm run conformance --prefix packages/watchtower
 *   npm run conformance --prefix packages/watchtower -- wss://my.relay
 *
 * Exits non-zero only when a claim actually **failed**. A relay that could not be reached
 * reports `unknown` and does not fail the run: this is a check on relay behaviour, not on
 * whether the machine running it has a network, and conflating the two would train everyone
 * to ignore a red result on a train.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const relays = args.length > 0 ? args : [...DEFAULT_RELAYS];

  console.log(`[conformance] ${relays.length} relay(s): ${relays.join(", ")}\n`);
  /*
   * The deletion probe is asked for by name, because it costs writes.
   *
   * Two consecutive runs with it on earned this machine `banned: too many rate-limit violations`
   * from `relay.damus.io`. A check nobody can run twice is worse than a measurement nobody has, and
   * the withdrawal copy needs the answer occasionally rather than every time.
   */
  const deletion = process.argv.includes("--deletion");
  const results = await checkRelays(relays, { deletion });
  for (const line of render(results)) console.log(line);

  const failed = results.some((r) => r.claims.some((c) => c.verdict === "fail"));
  const unreachable = results.filter((r) => r.claims.every((c) => c.verdict === "unknown"));
  if (unreachable.length > 0) {
    console.log(
      `\n[conformance] ${unreachable.length} relay(s) unreachable — reported unknown, not failed.`
    );
  }
  if (!deletion) {
    console.log(
      "\n[conformance] deletion requests not measured — add `-- --deletion` to ask, which writes two" +
        "\n               more events per relay. See `probeDeletion`."
    );
  }
  if (needsAttention(results)) console.log("\n[conformance] NEEDS A LOOK");
  process.exit(failed ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error("[conformance]", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
