/**
 * Where else RLSH people already are — and where the ones that are gone went.
 *
 * ## Why this is data and not prose
 *
 * The first version of this was a markdown page with a hand-typed "checked on" beside each
 * link. That is a page about link rot which rots, and it shipped with three defects nobody
 * could have caught by reading it: a live entry with no link at all whose obvious domain
 * guess resolves nowhere, two archive links left on plaintext `http://`, and a liveness
 * note that read as doubt when the actual evidence was strong.
 *
 * Typed here instead, so `community.test.ts` can assert the things prose cannot: that no
 * entry links a domain we know is dead or taken over, that every URL is `https`, and that
 * no check has been left to go stale in silence. The build fails rather than the page
 * quietly becoming the thing it warns about.
 *
 * ## What NavCom does here
 *
 * **Links, never mirrors.** Live properties get a link and nothing else — no copy, no
 * scrape, no re-host. Re-hosting a dead property's content is a different act that needs an
 * original maintainer's consent, and it is not attempted here.
 *
 * **Being listed is not a credential.** Absence is not a judgement. This says where things
 * are, not who counts as a real RLSH — the same refusal `positioning.md` makes.
 */

/**
 * How we know a site is alive, in descending strength.
 *
 * The distinction is load-bearing and was got wrong once. A bot-mitigation challenge is
 * **evidence a site is up and defended**, not evidence of uncertainty — reporting it as "we
 * could not confirm this" understates what is actually known, which is the same failure as
 * overstating it. This project has been on the receiving end of exactly that confusion
 * before: see the docblock in `version.test.ts`.
 */
export type Liveness =
  /** Fetched from here and real content came back. */
  | 'fetched'
  /** A bot-mitigation challenge answered instead of the page. The site is up; a script cannot read it. */
  | 'challenged'
  /** Taken from someone else's report and not checked from here. The weakest of the three. */
  | 'cited';

export interface LiveSite {
  name: string;
  url: string;
  what: string;
  how: Liveness;
  /** ISO date of the last check. Enforced against `STALE_AFTER_DAYS`. */
  checked: string;
}

export interface GoneSite {
  name: string;
  /**
   * The domain it used to live at. **Rendered as text, never as a link** — several of these
   * now resolve to squatters, and one of them is why this file exists.
   */
  was: string;
  what: string;
  /** Where the record actually survives. The Internet Archive holds it; we do not. */
  archive: string;
  checked: string;
}

/**
 * Domains that must never appear in an `href` on this site.
 *
 * Two kinds, and both are dangerous for the same reason. A **squatted** domain now serves
 * somebody else's content under a name people still trust. An **unresolved** one serves
 * nothing today and is available to anyone who wants that same trust tomorrow.
 *
 * Asserted against the built HTML, not just against this file — the point is what actually
 * ships, not what the data says.
 */
export const NEVER_LINK = [
  /** Redirects to a squatter (`therlsh.board-directory.net`), confirmed 2026-08-30. */
  'therlsh.forumotion.com',
  /** The squatter itself. */
  'therlsh.board-directory.net',
  /** Forum gone; the archive is the only honest destination. */
  'herocoalition.com',
  /**
   * No DNS record at all as of 2026-08-30. The organisation is alive at `.com`; this is the
   * domain a reader would guess, and guessing it lands on nothing — so it is worth naming.
   */
  'superheroesanonymous.org'
] as const;

/**
 * How long a check may go unrepeated before the build refuses it.
 *
 * Generous on purpose: this is a handful of links, re-checked by a person, and a threshold
 * tight enough to nag is a threshold somebody raises rather than acts on. Six months is
 * long enough to be no burden and short enough that a squatted domain cannot sit here for
 * years — which is the failure this whole file exists to prevent.
 *
 * ## Why this is a date and not a live check
 *
 * **You will want to replace this with a link checker that actually fetches each URL.**
 * Don't. Measured while building it, not guessed:
 *
 * - `web.archive.org` returns intermittent `503`s under any repeated access — three
 *   consecutive failures for one of these exact URLs, then a `200`, with nothing changed.
 * - `rlsh.net` and `wiki.rlsh.net` answer a scripted request with a Cloudflare challenge,
 *   so a checker reads `403` for two sites that are perfectly healthy.
 *
 * A test built on that is flaky, and `playwright.config.ts` states this project's position
 * on flake in the strongest terms it uses anywhere: *"A retry turns a flaky test into a
 * passing one and hides the flake."* A green suite that is green because it retried is
 * worse than no suite.
 *
 * What a date-based rule actually buys is the honest half: it cannot tell you a link broke
 * today, and it guarantees a **person** looks at all of them on a bounded cadence. Detecting
 * a takeover the day it happens is a different feature, needs infrastructure nobody here
 * runs, and is named as not-done in `community-continuity.md` rather than half-built.
 */
export const STALE_AFTER_DAYS = 180;

/**
 * Live — go to these. NavCom does not compete with any of them.
 *
 * `propagation.md` §3 already sets this stance for Herocore specifically: NavCom captures
 * the patrol and hands the record to where the community already gathers. It extends to
 * every row here.
 */
export const LIVE: LiveSite[] = [
  {
    name: 'Herocore',
    url: 'https://herocore.online',
    what: 'Forum, patrol logs, RLSH 101, a member map, and a 2026 demographics survey. Posts Wednesdays and Saturdays, and links out to Mastodon, Bluesky, Reddit and Facebook.',
    how: 'fetched',
    checked: '2026-08-30'
  },
  {
    name: 'RLSH.net',
    url: 'https://rlsh.net',
    what: 'Community hub. Wiki, an archive reaching back to reallifesuperheroes.org, curated links, and a Bluesky starter pack.',
    how: 'challenged',
    checked: '2026-08-30'
  },
  {
    name: 'RLSH Wiki',
    url: 'https://wiki.rlsh.net',
    what: "The community's central knowledge base. Its own maintainers prune links that start serving malware or redirecting elsewhere — the same job this page is doing.",
    how: 'challenged',
    checked: '2026-08-30'
  },
  {
    name: 'r/RealLifeSuperHeroes',
    url: 'https://www.reddit.com/r/RealLifeSuperHeroes/',
    what: 'Ongoing discussion.',
    how: 'fetched',
    checked: '2026-08-30'
  },
  {
    name: 'Superheroes Anonymous',
    url: 'https://www.superheroesanonymous.com',
    what: 'Founded 2007. Homeless outreach and community service.',
    how: 'fetched',
    checked: '2026-08-30'
  }
];

/**
 * Gone — the record survives, the domain does not.
 *
 * Neither row links its old domain. A squatted or unresolved domain is not a safe place to
 * send anyone, whatever it happens to serve this week.
 */
export const GONE: GoneSite[] = [
  {
    name: 'The RLSH forum',
    was: 'therlsh.forumotion.com',
    what: 'Now redirects to a squatted domain. The forum itself is gone; the last good copy predates the takeover.',
    archive: 'https://web.archive.org/web/20241214025038/https://therlsh.forumotion.com/',
    checked: '2026-08-30'
  },
  {
    name: 'Hero Coalition',
    was: 'herocoalition.com',
    what: "Community-cited as inactive since roughly 2014; the Internet Archive's last full crawl is 2018. Both are given rather than picking one.",
    archive: 'https://web.archive.org/web/20180808171726/http://herocoalition.com/',
    checked: '2026-08-30'
  }
];

/** How a liveness marker reads to somebody who is not holding this file. */
export const LIVENESS_WORDING: Record<Liveness, string> = {
  fetched: 'checked directly',
  challenged: 'up, behind a bot check',
  cited: 'reported, not checked here'
};

/** Whole days between an ISO date and now. Negative for a date in the future. */
export function daysSince(iso: string, now: Date = new Date()): number {
  const then = Date.parse(`${iso}T00:00:00Z`);
  return Math.floor((now.getTime() - then) / 86_400_000);
}
