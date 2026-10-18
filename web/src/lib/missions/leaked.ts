/**
 * The one general sentence about a publisher key whose secret leaked [decided 2026-10-18,
 * decision 2], for Status: said to every phone, before anybody asks, beside the rows in a device's
 * own mission history that say it about what that device sent [YoursScreen].
 *
 * General, because a phone that has been wiped, or that sealed a claim it no longer holds, has no
 * row to say it on. Worked out from the registry, so a future exposure says itself the same way.
 * Never a banner and never a notification: nothing sent can be recalled, and there is nothing to do.
 *
 * Kept apart from the mission screens so Status carries none of them.
 */
import { MISSION_PUBLISHERS, registryTime, type MissionPublisher, type MissionPublishers, type PublisherKey } from '@navcom/core';

/** The day NavCom began sealing claims to posters (076aa75c): nothing was sealed to anyone before it. */
const SEALING_SINCE = '2026-10-06';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const day = (iso: string) => {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${Number(m[2])} ${MONTHS[Number(m[1]) - 1]}` : iso;
};

/**
 * When sealed sending to `entry` moves off an exposed key `k`: the start of its first later key
 * whose secret did not leak, once a release gives that key one — the switch [core: trust.ts,
 * `sealTargetOf`]. Null until then.
 */
function switchOf(entry: MissionPublisher, k: PublisherKey): string | null {
  const starts = entry.keys
    .filter((n) => n.generation > k.generation && n.exposed === undefined && !n.frozen && Number.isFinite(registryTime(n.notBefore)))
    .map((n) => n.notBefore!)
    .sort((a, b) => registryTime(a) - registryTime(b));
  return starts[0] ?? null;
}

/**
 * One sentence per publisher key whose secret leaked.
 *
 * **Bounded by the switch once a release names it** [decision 2's wording: "from 6 October until
 * <the switch>"]: from then sealed messages go to the publisher's new key, which the old secret
 * cannot open, and a sentence with no end would say that everything sealed to it since 6 October
 * can be, the new key's messages included. The release that names the switch is this same code with
 * the new key given its start, so the sentence follows from the registry and needs no edit then.
 */
export function leakedSentences(registry: MissionPublishers = MISSION_PUBLISHERS): string[] {
  return registry.flatMap((entry) =>
    entry.keys
      .filter((k) => k.exposed !== undefined)
      .map((k) => {
        const since = k.exposed! > SEALING_SINCE ? k.exposed! : SEALING_SINCE;
        const until = switchOf(entry, k);
        const span = until ? `from ${day(since)} until ${day(until.slice(0, 10))}` : `from ${day(since)}`;
        const now = until ? `Nothing is sealed to that key now, and from ${day(until.slice(0, 10))} sealed messages go to its new key.` : 'Nothing is sealed to that key now.';
        return (
          `Sealed claims and reports sent to ${entry.name} ${span} can be opened by whoever holds its old key’s leaked secret, ` +
          `and shown to come from the card that sent them. ${now}`
        );
      })
  );
}
