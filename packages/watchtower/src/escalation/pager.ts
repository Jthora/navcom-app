import { execFile } from "node:child_process";
import type { OnCallEntry } from "./config.js";

/**
 * Waking people up.
 *
 * No SMS or push provider is embedded here on purpose. Every operator running a box already
 * has some way to reach their people -- a gateway, a bot, a script -- and hard-coding one
 * would put a third party in the escalation path, which is the one path that must not
 * depend on anybody's uptime but the node operator's own.
 *
 * So a channel names WHAT was registered and the command says HOW it is delivered. The wire
 * format keeps the spec's channel vocabulary; the node keeps the mechanism.
 */

/**
 * The prefix on any page that is not a real emergency.
 *
 * A drill MUST be distinguishable from a real `Distress` **by the recipient** [C29]. Somebody
 * woken at 3am has seconds and no context, so the distinction cannot live in a field the
 * page does not carry, or in a schedule they were never told. It goes first, in capitals,
 * in the text they actually read.
 */
export const TEST_PREFIX = "[NAVCOM TEST -- NOT AN EMERGENCY]";

export interface PageResult {
  callsign: string;
  channel: string;
  /** Whether the command exited zero. **Not** whether a human woke up. */
  dispatched: boolean;
  error?: string;
}

/** Per-argument substitution. Never a shell string, so a payload cannot become a command. */
function fill(argv: string[], vars: Record<string, string>): string[] {
  return argv.map((arg) =>
    arg.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => vars[key] ?? whole),
  );
}

function run(argv: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const [cmd, ...args] = argv;
    execFile(cmd!, args, { timeout: timeoutMs }, (err) => (err ? reject(err) : resolve()));
  });
}

/**
 * Pages everyone at once.
 *
 * **Parallel, not serial** -- in an emergency you want everyone, and walking a roster in
 * order spends the only resource that matters. One channel failing must never stop the
 * others being tried, which is why this settles rather than races.
 *
 * A successful dispatch means a command exited zero. It does **not** mean anyone woke up,
 * and nothing in this file may ever be treated as an acknowledgement: only an explicit
 * `distress-ack` from a human stops the ladder.
 */
/**
 * Pages the roster with an unmistakable test message.
 *
 * This is what makes "registering a channel is a condition of the on-call role" checkable
 * rather than declared. A command that has never been run is a command that works until the
 * night it matters -- and the only way to find out is to run it, which is also exactly what
 * a drill is.
 */
export function testPage(
  roster: OnCallEntry[],
  note = "checking this channel works",
  timeoutMs = 30_000,
): Promise<PageResult[]> {
  return pageAll(roster, `${TEST_PREFIX} ${note}`, timeoutMs);
}

export async function pageAll(
  roster: OnCallEntry[],
  message: string,
  timeoutMs = 30_000,
  /**
   * The `20911` this page is about, for a channel that can carry it.
   *
   * **Why it has to travel with the page.** A `distress-ack` names a `distress_id`, and the
   * paged person's device cannot look one up: `20911` is ephemeral [20000-29999], so a relay
   * forwards it to whoever is subscribed at that moment and stores nothing. A phone that was
   * asleep and wakes on the page finds the event gone. The id being public does not help --
   * there is nothing left to read it from.
   *
   * So the only path is the page itself. Substituted as `{{distress}}` in an operator's own
   * command template, which is how every other value reaches a channel here -- no provider is
   * embedded in this file and none should be.
   *
   * A channel that cannot carry it simply does not use the placeholder, and that operator
   * acknowledges from the console as before. Nothing about the ladder depends on it.
   */
  distressId = "",
): Promise<PageResult[]> {
  const wakeable = roster.filter((e) => e.declaration.channel !== "console-open");

  const settled = await Promise.allSettled(
    wakeable.map((entry) =>
      run(
        fill(entry.command, {
          message,
          callsign: entry.declaration.author.callsign ?? "",
          distress: distressId,
        }),
        timeoutMs,
      ),
    ),
  );

  return settled.map((outcome, i) => {
    const entry = wakeable[i]!;
    const base = {
      callsign: entry.declaration.author.callsign ?? "unnamed",
      channel: entry.declaration.channel,
    };
    return outcome.status === "fulfilled"
      ? { ...base, dispatched: true }
      : { ...base, dispatched: false, error: String(outcome.reason) };
  });
}
