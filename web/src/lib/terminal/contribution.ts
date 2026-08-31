/**
 * What you contributed, in a form you can hand to somebody.
 *
 * The patrol export answers *"what nights did I go out"*. This answers the larger question an
 * operator actually gets asked — by a grant committee, by a group deciding whether to work
 * with them, by somebody sneering that none of it is real — which is **what did you do**.
 *
 * ## Why this is not "export everything"
 *
 * External RLSH research calls a one-action full export non-negotiable, and applied here that
 * would be wrong. This device's accruing tier also holds `peers` and `endorsements`, and
 * [`data-tiers.md`](../../../../docs/product/data-tiers.md) is explicit about why those are
 * different: *"each names its signer, so a collection maps who has worked with whom. They are
 * encrypted at rest and require unlock to view."*
 *
 * A readable file containing them **is** an association graph — the artifact this whole design
 * exists to prevent, in a wrapper the operator was encouraged to publish. So the encrypted
 * backup stays the right shape for *everything*, and this carries the narrower thing that is
 * safe to hand over: **the work, never the network.**
 *
 * Three sources, and what they have in common is the point: a night you were out, a field you
 * corrected, a place you added. All of them are about **you and places**. None of them is
 * about a person [invariant 1], and none of them names another operator [C22].
 *
 * ## What is deliberately absent
 *
 * | | Why |
 * |---|---|
 * | Peers, endorsements | Association data. See above |
 * | Your emergency contact | Contact details only where an operator opted in for themselves [invariant 8] |
 * | Field notes | Wipeable, and the riskiest free text in the system — `notes.ts` |
 * | Keys of any kind | Nothing signable should ever be in something built to be pasted |
 * | Coordinates | The patrol export has never carried them and this does not start |
 * | Counts of people helped | *"No impact claims, no 'we helped X people', no inflated numbers"* — `propagation.md` |
 *
 * **Understatement is the aesthetic**, and that is a design requirement rather than a taste:
 * `propagation.md` argues restraint is what reads as credible, so the operator with
 * professional standards for their feed and the one who finds overstatement distasteful want
 * the same artifact.
 */

import type { Correction, Place } from '@navcom/core';
import { formatDuration, patrolLines, type ExportOptions, type Patrol } from './patrol';

/** A correction or place as this device holds it — `by` is the author's pubkey. */
type Authored<T> = T & { by: string };

export interface ContributionInput extends ExportOptions {
  /**
   * This operator's own pubkey.
   *
   * **The safety boundary of this whole module**, and the reason filtering happens in here
   * rather than at the call site. A device holds every correction and place it has heard over
   * a relay, most of them written by strangers — so an unfiltered export would publish other
   * people's work under this operator's name, which is both a lie and a disclosure about
   * somebody who agreed to nothing.
   *
   * Matched on the pubkey rather than the callsign because `verified_by` is a display name
   * anybody may choose, while `by` is taken from the event signature `readCorrection` and
   * `readPlace` already verified.
   */
  mine: string;
  patrols: Patrol[];
  corrections: Authored<Correction>[];
  places: Authored<Place>[];
  /** Corrections and places are already public under this callsign; the nights are not. */
  includeContributions?: boolean;
}

/** Oldest first, the way a record of work reads. */
const byDate = <T extends { last_verified: string }>(a: T, b: T) =>
  a.last_verified.localeCompare(b.last_verified);

export function exportContribution(opts: ContributionInput): string {
  const out: string[] = [];
  out.push(opts.callsign ? `Contribution — ${opts.callsign}` : 'Contribution');
  out.push('');

  const { lines, total } = patrolLines(opts.patrols, opts);
  out.push('Nights');
  if (opts.patrols.length === 0) out.push('  none recorded');
  else {
    out.push(...lines.map((l) => `  ${l}`));
    out.push('');
    out.push(
      `  ${opts.patrols.length} patrol${opts.patrols.length === 1 ? '' : 's'} · ${formatDuration(total)}`
    );
  }

  if (opts.includeContributions !== false) {
    const mineCorrections = opts.corrections.filter((c) => c.by === opts.mine).sort(byDate);
    const minePlaces = opts.places.filter((p) => p.by === opts.mine).sort(byDate);

    out.push('');
    out.push('Corrected');
    if (mineCorrections.length === 0) out.push('  nothing yet');
    else {
      for (const c of mineCorrections) {
        // The record, which fields, how it was learned, and when. Never the value itself:
        // a value is the directory's to publish, and this is a record of having done the
        // work rather than a second copy of the data.
        const fields = Object.keys(c.fields).join(', ');
        out.push(`  ${c.last_verified} · ${c.record} · ${fields} · ${c.method.replace(/_/g, ' ')}`);
      }
      out.push('');
      out.push(`  ${mineCorrections.length} correction${mineCorrections.length === 1 ? '' : 's'}`);
    }

    out.push('');
    out.push('Added');
    if (minePlaces.length === 0) out.push('  nothing yet');
    else {
      for (const p of minePlaces) {
        // Name and metro, never the street address. The address is the directory's to carry;
        // a list of doorways one operator stood at is a pattern about them.
        out.push(`  ${p.last_verified} · ${p.name} · ${p.region}`);
      }
      out.push('');
      out.push(`  ${minePlaces.length} place${minePlaces.length === 1 ? '' : 's'}`);
    }
  }

  out.push('');
  // Said in the artifact rather than only in the app, because the artifact is what a stranger
  // reads. It is the claim that makes the rest of it worth trusting.
  out.push('Nothing here is about anybody who was helped.');
  return out.join('\n');
}
