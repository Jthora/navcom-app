import { execFile } from "node:child_process";
import type { PageKind } from "@navcom/core";
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
  // A `drill` page: a test from `--check` must read as one on the device as well as in the words.
  return pageAll(roster, `${TEST_PREFIX} ${note}`, timeoutMs, "", "drill");
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
   *
   * **Only a first page carries it.** It is what a page offers a one-tap acknowledgement for, and only
   * a ladder can be acknowledged; whatever is passed here for any other kind is dropped.
   */
  distressId = "",
  /**
   * What kind of page this is, as `{{kind}}`: `first` (a ladder's), `repeat` (the person who
   * acknowledged, paged again about an operator still sending through a hold), or `drill` (a drill,
   * or `--check`'s test). The person woken must be able to tell the three apart, and on a phone the
   * words come from the service worker, which reads this (`escalation.spec.md`, *A page says what
   * kind it is*).
   */
  kind: PageKind = "first",
  /**
   * For a `repeat` page, the attempt it is about, as `{{attempt}}` -- its own placeholder, never
   * `{{distress}}`, because that attempt has no ladder to acknowledge. Its one use is the page's one
   * action, asking the watch to wake the others (`wake-others`). Dropped for any other kind.
   */
  attempt = "",
): Promise<PageResult[]> {
  const wakeable = roster.filter((e) => e.declaration.channel !== "console-open");

  const settled = await Promise.allSettled(
    wakeable.map((entry) =>
      run(
        fill(entry.command, {
          message,
          callsign: entry.declaration.author.callsign ?? "",
          kind,
          distress: kind === "first" ? distressId : "",
          attempt: kind === "repeat" ? attempt : "",
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

/**
 * What an on-call entry that pages through `navcom-push` cannot yet say, from its command template.
 *
 * Old templates keep working: a page with no kind reads as a page about a new `Distress` on the
 * device, which is the direction to be wrong in. But a repeat page then looks exactly like a first
 * one, and a drill like a real emergency -- so startup and `--check` say what is missing, per entry.
 */
export function pushTemplateGaps(entry: OnCallEntry): string[] {
  const argv = entry.command;
  if (!argv.some((a) => /(navcom-push|push\/index)(\.js)?$/.test(a))) return [];
  const has = (placeholder: string) => argv.some((a) => a.includes(`{{${placeholder}}}`));
  const gaps: string[] = [];
  if (!has("kind")) {
    gaps.push(
      'no "--kind", "{{kind}}" -- every page reaches this phone looking like a new Distress, a repeat and a drill included',
    );
  }
  if (!has("distress")) {
    gaps.push('no "--distress", "{{distress}}" -- a first page cannot offer a one-tap acknowledgement');
  }
  if (!has("attempt")) {
    gaps.push('no "--attempt", "{{attempt}}" -- a repeat page cannot offer to wake the others');
  }
  return gaps;
}
