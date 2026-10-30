/**
 * Who a `Distress` reaches, in five words or fewer, read the same on Status and at sign-on: two
 * renderings of one fact is how the two drift apart, and they had.
 *
 * Said before anybody relies on it [invariant 9], and never warmer than the truth [invariant 2].
 * **Your own person counts.** For an operator with no watch, the person they would call is the whole
 * safety net [contact.ts], and the Distress screen puts them first; this read *No addressee* to
 * exactly the operators that net is for. Nothing is paged on their behalf, and the readout says the
 * operator presses send.
 */
import type { Tone } from './panel';

export interface DistressReadInput {
  /** On-call operators who can be raised now. */
  reachable: number;
  /** A watch this page can send to. */
  configured: boolean;
  /** Whether that watch has a person on station. */
  station: boolean;
  /** The operator's own person, by the name they gave them, or null. */
  person: string | null;
}

export function distressRead(o: DistressReadInput): { value: string; tone: Tone; sub: string | null } {
  if (o.reachable > 0) return { value: 'Pages on-call', tone: 'neutral', sub: o.person ? `and ${o.person}, by your own text` : null };
  // A person on station is who a Distress reaches; what nobody does is page anyone after them.
  if (o.configured && o.station) return { value: 'To the watch', tone: 'warn', sub: o.person ? `and ${o.person}, by your own text` : 'nobody else is paged' };
  if (o.person) return { value: 'Your person', tone: 'neutral', sub: `${o.person}: you press send` };
  return { value: 'No addressee', tone: 'warn', sub: 'pages nobody, and says so' };
}
