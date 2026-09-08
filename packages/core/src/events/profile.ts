/**
 * Who can find a card, and what its holder says they do.
 *
 * ## Two of the three tiers are real, and the third would be a lie
 *
 * The obvious design is *public / internal / private*, where internal means "only people who
 * registered can see this". **NavCom cannot offer that, and must not appear to.**
 *
 * There is no account, no server and no gatekeeper anywhere in this system — that is the
 * whole design, not an unfinished part of it. A card is an event on public relays, and a
 * relay serves what it likes to whoever asks. Anyone can connect to the same relays with any
 * client and read every card on them. A setting labelled "internal" would change nothing
 * about who can read a card; it would only change what an operator *believes* about who can.
 *
 * That is invariant 4's shape pointed at visibility instead of the watch: an operator must
 * never believe a protection is in place when none is. So the tiers here are exactly the two
 * that are true, plus a third that is designed and deliberately not built:
 *
 * - `board`   — on the region's board. Anyone browsing that metro finds you
 * - `address` — published, on no board. Only somebody you give your address to will find you
 * - *sealed*  — encrypted to people you have accepted. **Not built.** See below
 *
 * ## `address` is real, and the mechanism was already here
 *
 * Kind 10911 is replaceable, keyed by pubkey and kind — the `d` tag is not part of its
 * identity, it is a **query filter**, and `buildCard`'s own comment says so: tagged by region
 * "so a client can ask one relay for one metro". The board subscribes `#d: [region]`.
 *
 * So a card published without that tag cannot match any board's filter, while staying
 * readable by anyone who fetches it by its author key. Delisting is the absence of a tag,
 * not a flag anybody has to honour — which is the only kind of privacy claim worth making
 * here, because it does not depend on another client behaving.
 *
 * The region still travels in `content`, so somebody who has your address still learns your
 * metro. `address` means *not on a board*. It does not mean secret, and nothing in the app
 * may describe it that way.
 *
 * ## Why `sealed` is not here
 *
 * A genuinely private card is an encrypted one, addressed to a holder set — the machinery
 * `transport.ts` already has for signals. It is real work and it interacts with the group
 * envelope, and half-built crypto is worse than none. It is named here so that the gap is
 * visible rather than forgotten, and so nobody adds a third radio button that does nothing.
 */

/** How findable a card is. Two values, because two of them are true. */
export type Visibility = 'board' | 'address';

export const VISIBILITIES: readonly Visibility[] = ['board', 'address'] as const;

/** The default. Publishing a card at all is the deliberate act; being findable is the point. */
export const DEFAULT_VISIBILITY: Visibility = 'board';

export interface VisibilityChoice {
  value: Visibility;
  /** The label a person reads. Short, and about the board rather than about privacy. */
  label: string;
  /**
   * Who can find it, said as an audience rather than a category.
   *
   * Naming the audience is the whole reason these read the way they do. "Internal" or
   * "restricted" are categories, and a category can be believed to mean more than it does;
   * a sentence about who can see something cannot.
   */
  audience: string;
}

export const VISIBILITY_CHOICES: readonly VisibilityChoice[] = [
  {
    value: 'board',
    label: 'On the board',
    audience: 'Anyone browsing your area can find you.'
  },
  {
    value: 'address',
    label: 'Address only',
    audience: 'Only somebody you give your address to. Your card is still published — this keeps it off boards, it does not make it secret.'
  }
] as const;

/**
 * What an operator says they do.
 *
 * ## This vocabulary is a placeholder and needs a person
 *
 * Extending a taxonomy here needs somebody with local knowledge, and this is one — the terms
 * below are a working set so the mechanism can be built, tested and used, not a considered
 * answer. Expect them to be replaced wholesale by somebody who has done the work. The schema,
 * the cap, the refusal and the rendering are all real; the words are not final.
 *
 * ## Every term describes an activity, never a qualification
 *
 * This is the rule that matters and it is not stylistic. A card is **self-asserted** —
 * nobody checks it, exactly as nobody has checked most of the directory. A tag reading
 * `medic` would be an unverified competence claim, and somebody picking a "medic" off a
 * roster at 2am is the Medic's kill trigger: confident wrong guidance, which this project
 * holds to be worse than none.
 *
 * So `firstaid` means *carries a kit*, not *is trained*. Vouching for competence is what
 * `endorsement.ts` is for — a credential is checkable and a tag is not, and the two must
 * never be made to look alike.
 */
export const DOES: readonly { id: string; label: string; means: string }[] = [
  { id: 'patrol', label: 'Patrol', means: 'Walks or drives an area.' },
  { id: 'supplies', label: 'Supplies', means: 'Carries and hands out water, socks, food.' },
  { id: 'firstaid', label: 'Carries a kit', means: 'Has first aid on them. Not a claim of training.' },
  { id: 'transport', label: 'Transport', means: 'Gives rides, moves goods.' },
  { id: 'comms', label: 'Comms', means: 'Radio, relays, coordination.' },
  { id: 'search', label: 'Search', means: 'Helps look for somebody missing.' },
  { id: 'observe', label: 'Legal observer', means: 'Witnesses and records.' },
  { id: 'welfare', label: 'Welfare checks', means: 'Checks on people who asked to be checked on.' },
  { id: 'crew', label: 'A crew', means: 'This card is a group rather than one person.' }
] as const;

const DOES_IDS = new Set(DOES.map((d) => d.id));

/** Whether this build knows this term. Unknown terms are dropped, never rendered raw. */
export const isDoes = (id: string): boolean => DOES_IDS.has(id);

export const does = (id: string): (typeof DOES)[number] | undefined => DOES.find((d) => d.id === id);

/**
 * The most terms one card may carry.
 *
 * Small on purpose. A card claiming nine things says nothing, and a list of every term is
 * how a self-asserted vocabulary turns into a keyword-stuffing surface. Three is enough to
 * describe somebody and few enough that choosing is an act.
 */
export const DOES_MAX = 3;

/** Activity terms as `t` tags — the ordinary Nostr shape, ignored by readers that do not care. */
export function doesTags(ids: readonly string[]): string[][] {
  const out: string[][] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (out.length >= DOES_MAX) break;
    const t = id.trim().toLowerCase();
    if (!DOES_IDS.has(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(['t', t]);
  }
  return out;
}

/**
 * Activity terms read back, in published order.
 *
 * Never throws. An unrecognised term is dropped rather than shown — a reader that renders a
 * word it does not understand is how a closed vocabulary quietly becomes an open one.
 */
export function readDoes(tags: readonly (readonly string[])[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    if (out.length >= DOES_MAX) break;
    if (tag[0] !== 't' || typeof tag[1] !== 'string') continue;
    const t = tag[1].trim().toLowerCase();
    if (!DOES_IDS.has(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** How a card was published, read back off the event that carries it. */
export function readVisibility(tags: readonly (readonly string[])[]): Visibility {
  return tags.some((t) => t[0] === 'd') ? 'board' : 'address';
}
