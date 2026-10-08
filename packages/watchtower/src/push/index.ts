#!/usr/bin/env node
import { readFileSync } from "node:fs";
import webpush from "web-push";
import { pageKindOf, type PageKind } from "@navcom/core";

/**
 * Waking somebody through Web Push.
 *
 * ## Why this is a command rather than a channel in the executor
 *
 * The executor already runs `command = [...]` as argv, never a shell string, and every
 * operator running a box already has some way to reach their people. Embedding a provider
 * there would put a third party in the escalation path. So this is a **binary the command
 * points at**, and the executor is unchanged:
 *
 *     command = ["navcom-push", "--to", "/etc/navcom/oncall/wren.json",
 *                "--kind", "{{kind}}", "--distress", "{{distress}}", "--attempt", "{{attempt}}"]
 *
 * The executor fills `{{kind}}` with what the page is -- `first`, `repeat` or `drill` -- and only the
 * placeholder that kind uses: `{{distress}}` on a first page, `{{attempt}}` on a repeat. An older
 * template without them still works, and every page it sends reads as a new `Distress` on the phone
 * (`navcom-escalation` says so at startup and in `--check`).
 *
 * ## Why Web Push at all, when a curl to a topic already works
 *
 * A page over an ntfy topic passes its text through somebody else's server in the clear.
 * A Web Push payload is **encrypted to keys only the subscribed browser holds**, so the push
 * service — Google's, Mozilla's or Apple's, and there is no avoiding one — relays a blob it
 * cannot read. On the one channel that carries an emergency, that is worth the dependency.
 *
 * It is also the only native-grade wake-up a web app has on both platforms without an app
 * store: Chrome on Android, and iOS 16.4+ once NavCom is on the Home Screen.
 *
 * ## What is sent
 *
 * Almost nothing: what kind of page it is, and the id it is about. The service worker holds the
 * wording. The sender cannot read the `Distress` either, so there is no detail to pass on — and a
 * notification rendering text from the wire would put a stranger's words on a locked screen.
 *
 *     { "kind": "first" | "repeat" | "drill", "drill": boolean, "distress"?: id, "attempt"?: id }
 *
 * - `kind` is what the service worker reads first, with `pageKindOf` in core: a first page, a repeat
 *   to the person who acknowledged, or a drill. The person woken must be able to tell them apart
 *   (`escalation.spec.md`, *A page says what kind it is*)
 * - `drill` is kept for service workers from before `kind`, which read only it
 * - `distress` only on a first page: the ladder's id, which the page offers a one-tap acknowledgement for
 * - `attempt` only on a repeat: the attempt it is about, under its own field and never as `distress`,
 *   because that attempt has no ladder to acknowledge. Its one use is asking the watch to wake the others
 *
 * **Anything missing or unknown is a first page.** A literal `{{kind}}` an older executor left
 * unfilled, a typo, nothing at all: each is read as a page about a new `Distress`, never as a repeat
 * and never as a drill. Of the wrong readings, a real page shown as a drill is the one somebody
 * sleeps through.
 *
 * **The id is the exception, and it is not text.** A `distress-ack` names a `distress_id`, and
 * the paged device cannot look one up afterwards: `20911` is ephemeral, so a relay forwards it
 * to whoever is subscribed at that instant and stores nothing. A phone that was asleep finds
 * the event gone. Carrying it here is the only path to a one-tap ack [2.5].
 *
 * It leaks nothing. The payload is encrypted to keys only this browser holds, so the push
 * service relays a blob; and an event id is public on the relay to anyone whose filter matches
 * anyway. It is never rendered — it is passed to the ack and nowhere else.
 *
 * ## Not verified end to end
 *
 * Key generation and argument handling are tested. **Delivery is not**, because it needs a
 * real browser subscription and a real push service, and neither exists in CI. Until
 * somebody registers a phone and watches a page arrive, treat this as untested — see
 * `docs/human-tasks.md`.
 */

const usage = `navcom-push — wake an on-call operator through Web Push.

  navcom-push --keys
      Generates a sender keypair. Run once. The public half goes to whoever is
      registering a device; the private half stays here and is a secret.

  navcom-push --to <subscription.json> [--kind first|repeat|drill]
              [--distress <id>] [--attempt <id>] [--ttl <seconds>] [message]
      Sends a page. The subscription file is what the on-call operator handed over
      from the terminal's "On call" screen. In an executor command template:

        "--kind", "{{kind}}", "--distress", "{{distress}}", "--attempt", "{{attempt}}"

      --kind      first (a new Distress), repeat (paged again about an operator you
                  acknowledged) or drill. Missing or unknown: first. --drill is the
                  same as --kind drill
      --distress  a first page's Distress id, offered as a one-tap acknowledgement
      --attempt   a repeat page's attempt id, for asking the watch to wake the others
      --ttl       how long the push service may hold it (default 3600; a repeat 1800)

Environment:
  NAVCOM_PUSH_PRIVATE   the private half of the sender key
  NAVCOM_PUSH_PUBLIC    the public half
  NAVCOM_PUSH_CONTACT   a mailto: or https: the push service can reach you at
`;

function keys(): void {
  const pair = webpush.generateVAPIDKeys();
  // Printed as the environment the sender needs, so nobody has to work out the mapping.
  console.log(`# Keep the private half secret. Anyone holding it can page every device
# registered against the public half.
NAVCOM_PUSH_PUBLIC=${pair.publicKey}
NAVCOM_PUSH_PRIVATE=${pair.privateKey}
NAVCOM_PUSH_CONTACT=mailto:you@example.org

# Hand this to whoever is registering a device. It is public.
#
#   ${pair.publicKey}`);
}

/** Reads the blob the on-call operator handed over, and refuses anything that is not one. */
export function readSubscription(raw: string): webpush.PushSubscription {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("That subscription file is not JSON.");
  }
  const s = parsed as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof s.endpoint !== "string" || !/^https:\/\//.test(s.endpoint)) {
    throw new Error("A subscription needs an https endpoint.");
  }
  // Non-empty, not merely present. A browser whose `getKey` returned null produced empty
  // strings on the other side of this handover, and they passed a typeof check while being
  // exactly as useless as an absent key.
  if (typeof s.keys?.p256dh !== "string" || typeof s.keys?.auth !== "string" ||
      s.keys.p256dh.trim() === "" || s.keys.auth.trim() === "") {
    // A subscription missing its keys would send an unencrypted push, which some services
    // accept. Refused: the encryption is the reason this exists rather than a curl.
    throw new Error("A subscription needs both keys. Without them the page is not encrypted.");
  }
  return { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } };
}

/** What one page carries to the service worker. */
export interface PagePayload {
  kind: PageKind;
  /** For service workers from before `kind`, which read only this. */
  drill: boolean;
  /** A first page's Distress id. Never on any other kind. */
  distress?: string;
  /** A repeat page's attempt id. Never on any other kind. */
  attempt?: string;
}

const EVENT_ID = /^[0-9a-f]{64}$/;

/** The value after `flag`, or undefined when it is absent or is the next flag. */
function valueOf(argv: readonly string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  const value = i === -1 ? undefined : argv[i + 1];
  return typeof value === "string" && !value.startsWith("--") ? value : undefined;
}

/**
 * The payload and lifetime a page is sent with, from the arguments the executor's command filled.
 *
 * Fails toward alarm: an unknown `--kind` -- a literal `{{kind}}` an older executor left unfilled
 * included -- is a first page. An id goes only where its kind uses it, and only when it is an id, so
 * a template that filled the wrong placeholder can never turn a repeat into a one-tap acknowledgement.
 */
export function pagePayload(argv: readonly string[]): { payload: PagePayload; ttl: number } {
  // `--drill` is the older spelling of `--kind drill`, and an exact `--kind` wins over it.
  const kind = pageKindOf(valueOf(argv, "--kind"), argv.includes("--drill"));
  const id = (flag: string) => {
    const value = valueOf(argv, flag)?.trim().toLowerCase();
    return value && EVENT_ID.test(value) ? value : undefined;
  };
  /*
   * Accepted but not required. A ladder paging a channel that predates this simply does not
   * pass one, and that operator acknowledges from the console -- the ack path degrades, the
   * page does not.
   */
  const distress = kind === "first" ? id("--distress") : undefined;
  const attempt = kind === "repeat" ? id("--attempt") : undefined;
  /*
   * A page nobody reads for four hours is not a page. Long enough to survive a phone that is briefly
   * off, short enough that it is never a surprise from yesterday. A repeat is about a hold that lasts
   * half an hour, and arriving after it ended it would be stale. The executor remembers a held attempt
   * at least this long past its hold (`REPEAT_PAGE_TTL_SECONDS`), so a wake sent from a repeat delivered
   * late is told the hold ended rather than that it was never held.
   */
  const asked = Number(valueOf(argv, "--ttl"));
  const ttl = Number.isInteger(asked) && asked > 0 ? asked : kind === "repeat" ? 1800 : 3600;
  return {
    payload: { kind, drill: kind === "drill", ...(distress ? { distress } : {}), ...(attempt ? { attempt } : {}) },
    ttl,
  };
}

async function send(argv: string[]): Promise<void> {
  const to = valueOf(argv, "--to");
  if (!to) throw new Error("--to <subscription.json> is required.");

  const priv = process.env.NAVCOM_PUSH_PRIVATE;
  const pub = process.env.NAVCOM_PUSH_PUBLIC;
  if (!priv || !pub) throw new Error("NAVCOM_PUSH_PRIVATE and NAVCOM_PUSH_PUBLIC must be set. Run `navcom-push --keys`.");

  webpush.setVapidDetails(process.env.NAVCOM_PUSH_CONTACT ?? "mailto:navcom@example.org", pub, priv);

  const { payload, ttl } = pagePayload(argv);
  await webpush.sendNotification(readSubscription(readFileSync(to, "utf8")), JSON.stringify(payload), {
    TTL: ttl,
    urgency: "high"
  });
  console.log(`[push] ${payload.kind} page delivered to the push service for ${to}`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.length === 0) {
    console.log(usage);
    return;
  }
  if (argv.includes("--keys")) {
    keys();
    return;
  }
  await send(argv);
}

main().catch((err: unknown) => {
  // Both halves matter: the executor logs a non-zero exit, and a person reading the log
  // needs to know whether the push service rejected it or the file was wrong.
  console.error(`[push] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
