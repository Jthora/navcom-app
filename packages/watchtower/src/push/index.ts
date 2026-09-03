#!/usr/bin/env node
import { readFileSync } from "node:fs";
import webpush from "web-push";

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
 *     command = ["navcom-push", "--to", "/etc/navcom/oncall/wren.json", "{{message}}"]
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
 * Almost nothing: a flag saying whether this is a drill, and the id of the `20911` this is
 * about. The service worker holds the wording. The sender cannot read the `Distress` either,
 * so there is no detail to pass on — and a notification rendering text from the wire would put
 * a stranger's words on a locked screen.
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

  navcom-push --to <subscription.json> [--drill] [--distress <id>] [message]
      Sends a page. The subscription file is what the on-call operator handed over
      from the terminal's "On call" screen.

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

async function send(argv: string[]): Promise<void> {
  const to = argv[argv.indexOf("--to") + 1];
  if (!to) throw new Error("--to <subscription.json> is required.");

  const priv = process.env.NAVCOM_PUSH_PRIVATE;
  const pub = process.env.NAVCOM_PUSH_PUBLIC;
  if (!priv || !pub) throw new Error("NAVCOM_PUSH_PRIVATE and NAVCOM_PUSH_PUBLIC must be set. Run `navcom-push --keys`.");

  webpush.setVapidDetails(process.env.NAVCOM_PUSH_CONTACT ?? "mailto:navcom@example.org", pub, priv);

  const drill = argv.includes("--drill");
  /*
   * Accepted but not required. A ladder paging a channel that predates this simply does not
   * pass one, and that operator acknowledges from the console -- the ack path degrades, the
   * page does not.
   */
  const distress = argv[argv.indexOf("--distress") + 1];
  const hasDistress = argv.includes("--distress") && typeof distress === "string" && !distress.startsWith("--");
  await webpush.sendNotification(readSubscription(readFileSync(to, "utf8")), JSON.stringify(hasDistress ? { drill, distress } : { drill }), {
    // A page nobody reads for four hours is not a page. Long enough to survive a phone that
    // is briefly off, short enough that it is never a surprise from yesterday.
    TTL: 3600,
    urgency: "high"
  });
  console.log(`[push] delivered to the push service for ${to}`);
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
