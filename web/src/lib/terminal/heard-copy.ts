/**
 * What the receipt and the `Distress` screen say about where the watch is heard [relay-lists §7].
 *
 * Wording only, with no runes and no reads, so every sentence can be checked on its own. §7's table
 * is normative: *Heard on 2 of 3 relays*, *Heard on 1 relay only: if it fails, nothing would hear a
 * Distress*, *Not heard on any of 3 relays. If the watch moved, ask whoever gave you its address*.
 * The two cases the table does not name, a watch with one relay and a watch whose every relay is
 * one nothing is sent to, are worded the same way and are the owner's to confirm.
 *
 * **No relay answering is unknown, not none** [invariant 7]. A phone offline, or every relay
 * failing, has not learned that the watch is heard nowhere; it could not ask. So a count of `null`
 * says that, and never "if the watch moved", which would send somebody after the wrong fix.
 *
 * **A count of relays is not a count of people.** A relay the watch is heard on is one where the
 * watch listens for a `Distress`; it says nothing about whether anybody is awake. So none of the
 * count's words name a person, and a test holds that.
 */

import type { Tone } from './panel';

/** §7's sentence: said verbatim in the receipt's `Why`, and kept with a sign-on. `on` null: unknown. */
export function heardLine(on: number | null, of: number): string {
  if (of <= 0) return 'Not heard on any relay: none this watch names may carry a Distress';
  if (on === null) return 'Unknown: no relay answered, so this phone could not ask where the watch is heard';
  if (on >= 2) return `Heard on ${on} of ${of} relays`;
  if (on === 1) return 'Heard on 1 relay only: if it fails, nothing would hear a Distress';
  if (of === 1) return 'Not heard on its only relay. If the watch moved, ask whoever gave you its address';
  return `Not heard on any of ${of} relays. If the watch moved, ask whoever gave you its address`;
}

/**
 * The same count as a readout, under the slot key *Heard on*: five words at most, because a
 * readout that has become a sentence is marked and a browser test fails it.
 */
export function heardReadout(on: number | null, of: number): { value: string; tone: Tone; sub: string | null } {
  if (of <= 0) return { value: 'Nowhere', tone: 'warn', sub: 'no relay it names may carry one' };
  if (on === null) return { value: 'Unknown', tone: 'cold', sub: 'no relay answered this phone' };
  if (on >= 2) return { value: `${on} of ${of} relays`, tone: 'neutral', sub: null };
  if (on === 1) return { value: '1 relay only', tone: 'warn', sub: 'if it fails, nothing would hear a Distress' };
  return { value: 'Nowhere', tone: 'warn', sub: of === 1 ? 'not on its one relay' : `not on any of ${of} relays` };
}

/** What counts, said once beside the count. */
export const HEARD_RULE =
  'A relay counts when a Distress from this phone would go there, it answered this phone, the watch’s state there is under five minutes old, and it did not refuse this phone’s last signal.';

/** §7: *a count of relays is not a count of people*, and the receipt says so in those words. */
export const NOT_PEOPLE =
  'This counts relays, not people. A relay the watch is heard on is one where the watch listens for a Distress. It says nothing about whether anybody is awake.';

/** An age a person reads at a glance: seconds under two minutes, minutes under two hours, then hours. */
export function ago(seconds: number): string {
  const s = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  if (s < 120) return `${s}s`;
  if (s < 120 * 60) return `${Math.round(s / 60)} min`;
  return `${Math.round(s / 3600)} h`;
}

/**
 * What one relay showed, as the receipt's `Why` words it.
 *
 * - `heard`: its newest watch state is live, and counts unless it refused this phone's last signal
 * - `stale`: its newest state is more than five minutes old
 * - `dark`: its newest state is the watch's own word that it is Dark
 * - `superseded`: live there, and the watch has published Dark since, on some relay
 * - `ahead`: dated further ahead of this phone's clock than delivery explains
 * - `corrupt`: what it serves for the watch cannot be read
 * - `none`: it answered, and holds no state from this watch
 * - `unanswered`: it has not answered this phone
 */
export type HeardState = 'heard' | 'stale' | 'dark' | 'superseded' | 'ahead' | 'corrupt' | 'none' | 'unanswered';

/** A relay by its host, which is what a person can recognise. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

/** Control and direction-override characters: nothing a reason needs, all of them ways to mislead. */
// eslint-disable-next-line no-control-regex
const UNPRINTABLE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;
const REASON_MAX = 160;

/** A relay's own words, as one clipped line of plain text with no closing stop of its own. */
function reasonText(reason: string): string {
  const text = String(reason ?? '').replace(UNPRINTABLE, ' ').replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
  return text.length > REASON_MAX ? `${text.slice(0, REASON_MAX - 1)}…` : text || 'no reason given';
}

/** One relay's line in the receipt's `Why`: where it came from, what it showed, and any refusal. */
export function relayLine(r: { url: string; state: HeardState; ageSeconds: number | null; refused: string | null }): string {
  const age = ago(r.ageSeconds ?? 0);
  const state = {
    heard: `The watch was last heard there ${age} ago.`,
    stale: `The watch was last heard there ${age} ago, more than five minutes, so it does not count.`,
    dark: 'The watch’s newest word there is that it is Dark.',
    superseded: 'The watch has said since, on another relay, that it is Dark.',
    ahead: 'Its last watch state there is dated ahead of this phone’s clock, so it does not count.',
    corrupt: 'What it serves for the watch cannot be read, so it does not count.',
    none: 'It answered, and holds no state from this watch.',
    unanswered: 'It has not answered this phone.'
  }[r.state];
  const refusal = r.refused === null ? '' : ` It refused this phone’s last signal: ${reasonText(r.refused)}.`;
  // "Handed over" is the only origin until phase 4 adds "listed by the watch on <date>".
  return `${hostOf(r.url)} — handed over. ${state}${refusal}`;
}

/** A relay the watch names that nothing is sent to, and core's reason. */
export function withheldLine(w: { url: string; reason: string }): string {
  return `${hostOf(w.url)} — not counted, and nothing is sent there: ${reasonText(w.reason)}.`;
}
