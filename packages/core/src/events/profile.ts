/**
 * Who can find a card, and what its holder says they do.
 *
 * ## Three tiers, named by reach rather than by permission
 *
 * The obvious design is *public / internal / private*, and an earlier version of this file
 * argued that "internal" was a lie NavCom must not tell. That was half right and the wrong
 * half was load-bearing.
 *
 * What is a lie is **enforcement**. There is no account, no server and no gatekeeper: a card
 * is an event on public relays, a relay serves what it likes to whoever asks, and nothing here
 * can stop anyone reading one. A setting that claimed to gate *reading* would change only what
 * an operator believes, which is invariant 4 pointed at visibility.
 *
 * What is true is **reach**, and reach is what people usually mean. No operator data appears
 * in any prerendered page — cards are relay traffic fetched at runtime, so `/terminal/who/`
 * ships as *"No address"* and the board ships empty. Being on a board therefore already means:
 * in the app, in your metro, in no static file, in no search index. That is the "internal"
 * people are asking for, and it has been built the whole time under a different name.
 *
 * So the gap was never internal. It was **public** — appearing somewhere a visitor who never
 * opens the app can find you:
 *
 * - `public`  — on the board *and* on navcom.app itself, where anyone can see you
 * - `board`   — the app only. Anyone browsing that metro, nobody searching the web
 * - `address` — published, on no board. Only somebody you give your address to
 * - *sealed*  — encrypted to people you have accepted. **Not built.** See below
 *
 * ## And the quietest tier is the default: no card at all
 *
 * An operator with no card sees every board and appears on none, because there is nothing to
 * appear. That is not a setting and needs none — publishing is the deliberate act, and the app
 * is identical without it. It is also the answer for somebody who will not join a network that
 * can see them.
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

/** How findable a card is. Three values, ordered widest reach first. */
export type Visibility = 'public' | 'board' | 'address';

export const VISIBILITIES: readonly Visibility[] = ['public', 'board', 'address'] as const;

/**
 * The label marking a card as public, and why it is a single letter.
 *
 * A relay only indexes **single-letter** tags (NIP-01), so `['visibility', 'public']` would be
 * unqueryable and the public roster would have to download every card on the relay — including
 * every card whose author chose *not* to be on it — and filter locally. Asking a relay for
 * everyone's internal card in order to build a public page is the wrong shape regardless of
 * whether the data is technically readable.
 *
 * `l` is NIP-32's label tag, namespaced so it cannot collide with another app's labels.
 */
export const PUBLIC_LABEL = 'navcom:public';

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
    value: 'public',
    label: 'Anyone, anywhere',
    audience: 'You appear on navcom.app itself, so somebody who never opens the app can find you.'
  },
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
  // Public is a superset of the board: choosing it does not take you off your metro's board,
  // it adds a second place you appear. Checked first for that reason.
  if (tags.some((t) => t[0] === 'l' && t[1] === PUBLIC_LABEL)) return 'public';
  return tags.some((t) => t[0] === 'd') ? 'board' : 'address';
}

/** The tags a visibility choice adds beyond the region. */
export function visibilityTags(v: Visibility): string[][] {
  return v === 'public' ? [['l', PUBLIC_LABEL]] : [];
}
