/**
 * Where else an operator can be found, if they choose to say.
 *
 * An operator who works under a persona usually already has an audience somewhere — a
 * channel, a feed, a page people follow. This is the one place a card may point at it, and
 * the whole design is about making that pointing cost nothing the operator did not agree to.
 *
 * ## Why this rides in tags rather than in the card's content
 *
 * `CARD_FIELDS` is an allowlist enforced **refuse-not-trim**: `readCard` returns null for a
 * card carrying any field it does not know. That is right for content — the field somebody
 * will eventually try to add there is a coordinate — and it is a trap for anything new.
 *
 * Adding `links` to that allowlist would mean every client running an older build reads a
 * card with links and gets **null**. Not a card without links. No card. The operator would
 * silently vanish from their region's board for everyone who had not updated, and this ships
 * as a PWA behind a service worker, so "everyone has updated" is not a date anybody picks.
 *
 * `readCard` never looks at `event.tags`. So links go in tags, old clients ignore them
 * exactly as they should, and no migration, kind bump or dual-publish is needed.
 *
 * ## The tag shape is NIP-39, not ours
 *
 * `["i", "<platform>:<handle>", "<proof>"]` — external identities in profiles. Draft and
 * optional, which suits a thing we may want to change. Borrowed rather than invented so that
 * a card is legible to a Nostr client that has never heard of NavCom, and so that the proof
 * field exists before we have anything to put in it.
 *
 * ## Rank is position, not a field
 *
 * The first link is the primary, the next two are secondary, the rest are listed. Encoding
 * rank as order means it cannot disagree with itself, needs no vocabulary, and degrades to
 * "some identity claims in some order" for any reader that does not care.
 *
 * ## A bad link drops. It never takes the card with it.
 *
 * The opposite of how content fields are handled, deliberately. An unknown *field* means the
 * card was written by something with a different idea of what a card is. An unknown
 * *platform* just means this reader is older than that platform's registry entry, and
 * refusing the whole card over it would rebuild the vanishing-operator failure this file
 * exists to avoid.
 */

import { withinLimit } from '../limits.js';

/**
 * What a reader could do with a handle on this platform, at most.
 *
 * Measured rather than assumed — every value here was set by probing the live endpoint for
 * `X-Frame-Options`, `frame-ancestors` and an unauthenticated response, not by reading the
 * platform's documentation about itself.
 *
 * - `embed` — a profile-level embed exists and needs no key. It can fill a feature slot
 * - `data`  — no embed, but the API is open and CORS-clean, so we draw it ourselves
 * - `link`  — the platform refuses framing and refuses unauthenticated reads. A link, forever
 */
export type Shows = 'embed' | 'data' | 'link';

/**
 * Where the handle lands inside the URL, which decides how strictly it must be checked.
 *
 * Found by a test rather than by reasoning: `tumblr` splices the handle into the
 * **authority** as a subdomain, so a handle of `evil.com/` builds
 * `https://evil.com/.tumblr.com` -- a different origin, reached from a link on somebody's
 * profile. Everything `HANDLE_CHARS` admits is harmless in a path and some of it is not
 * harmless in a host, so the two positions get different rules.
 *
 * - `path`      -- spliced after the host. Cannot change the origin
 * - `subdomain` -- becomes a DNS label. Must be a DNS label and nothing else
 * - `origin`    -- *is* the host, which is the entire job. Checked as a hostname
 * - `instance`  -- `host/user`, the fediverse shape. The host half is a real host
 */
export type HandlePosition = 'path' | 'subdomain' | 'origin' | 'instance';

export interface Platform {
  /** The token used in the tag. Lowercase, stable, never renamed once published. */
  id: string;
  /** What a person calls it. */
  label: string;
  shows: Shows;
  /** Defaults to `path`, the only position where any admitted handle is safe. */
  at?: HandlePosition;
  /** The page a handle opens to. */
  url: (handle: string) => string;
}

/**
 * Every platform a card may name.
 *
 * Closed on purpose, like every other vocabulary here. A platform with no entry has no URL,
 * and a link that cannot be opened is not a link — so an unrecognised one is dropped rather
 * than displayed as a dead token.
 *
 * `shows` is what decides whether a platform may hold the feature slot, and it is a property
 * of the platform rather than an operator preference: somebody who makes Reddit their
 * primary would otherwise be promised a panel that can never be filled.
 */
/** A single DNS label. What a subdomain-shaped handle is allowed to be, and no more. */
const DNS_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

/** A hostname, or null. Rejects userinfo, ports and anything that is not a bare host. */
function hostnameOf(value: string): string | null {
  if (value.includes('@')) return null;
  let url: URL;
  try {
    url = new URL(`https://${value}`);
  } catch {
    return null;
  }
  if (url.hostname !== url.host) return null; // a port was smuggled in
  if (url.pathname !== '/' || url.search || url.hash) return null;
  /*
   * Every label checked, rather than "it contains a dot".
   *
   * `..` contains a dot and is not a host, and `https://../evil.com` parses with a hostname
   * of `..` -- which is how `../evil.com` walked through an earlier version of this and out
   * of the instance's origin. Found by the escape test, not by reading this function.
   */
  const labels = url.hostname.split('.');
  if (labels.length < 2 || !labels.every((l) => DNS_LABEL.test(l))) return null;
  return url.hostname;
}

/** The instance half of a `host/user` handle. Only ever called on a validated handle. */
const instanceOf = (h: string): string => h.split('/')[0]!;
/** The account half, without a leading `@`. Only ever called on a validated handle. */
const userOf = (h: string): string => (h.split('/')[1] ?? '').replace(/^@/, '');

export const PLATFORMS: readonly Platform[] = [
  // Profile-level embeds, no key. Verified 2026-09-08.
  { id: 'facebook', label: 'Facebook', shows: 'embed', url: (h) => `https://www.facebook.com/${h}` },
  { id: 'instagram', label: 'Instagram', shows: 'embed', url: (h) => `https://www.instagram.com/${h}/` },
  { id: 'tiktok', label: 'TikTok', shows: 'embed', url: (h) => `https://www.tiktok.com/@${h}` },
  { id: 'youtube', label: 'YouTube', shows: 'embed', url: (h) => `https://www.youtube.com/@${h}` },
  { id: 'twitch', label: 'Twitch', shows: 'embed', url: (h) => `https://www.twitch.tv/${h}` },
  { id: 'kick', label: 'Kick', shows: 'embed', url: (h) => `https://kick.com/${h}` },
  { id: 'odysee', label: 'Odysee', shows: 'embed', url: (h) => `https://odysee.com/@${h}` },
  { id: 'telegram', label: 'Telegram', shows: 'embed', url: (h) => `https://t.me/${h}` },
  { id: 'tumblr', label: 'Tumblr', shows: 'embed', at: 'subdomain', url: (h) => `https://${h}.tumblr.com` },
  { id: 'soundcloud', label: 'SoundCloud', shows: 'embed', url: (h) => `https://soundcloud.com/${h}` },
  { id: 'bandcamp', label: 'Bandcamp', shows: 'embed', at: 'subdomain', url: (h) => `https://${h}.bandcamp.com` },
  { id: 'vimeo', label: 'Vimeo', shows: 'embed', url: (h) => `https://vimeo.com/${h}` },
  { id: 'pinterest', label: 'Pinterest', shows: 'embed', url: (h) => `https://www.pinterest.com/${h}/` },

  // Open data. No embed, but we can draw it ourselves, which is better anyway.
  { id: 'bluesky', label: 'Bluesky', shows: 'data', url: (h) => `https://bsky.app/profile/${h}` },
  // `host/user` -- an account is only meaningful with the instance it lives on.
  { id: 'mastodon', label: 'Mastodon', shows: 'data', at: 'instance', url: (h) => `https://${instanceOf(h)}/@${userOf(h)}` },
  { id: 'peertube', label: 'PeerTube', shows: 'data', at: 'instance', url: (h) => `https://${instanceOf(h)}/a/${userOf(h)}` },
  { id: 'github', label: 'GitHub', shows: 'data', url: (h) => `https://github.com/${h}` },

  // Refuses framing and refuses unauthenticated reads. A link is all it will ever be.
  { id: 'x', label: 'X', shows: 'link', url: (h) => `https://x.com/${h}` },
  { id: 'reddit', label: 'Reddit', shows: 'link', url: (h) => `https://www.reddit.com/user/${h}` },
  { id: 'threads', label: 'Threads', shows: 'link', url: (h) => `https://www.threads.com/@${h}` },
  { id: 'snapchat', label: 'Snapchat', shows: 'link', url: (h) => `https://www.snapchat.com/add/${h}` },
  { id: 'discord', label: 'Discord', shows: 'link', url: (h) => `https://discord.gg/${h}` },
  { id: 'nextdoor', label: 'Nextdoor', shows: 'link', url: (h) => `https://nextdoor.com/profile/${h}` },
  { id: 'meetup', label: 'Meetup', shows: 'link', url: (h) => `https://www.meetup.com/${h}/` },
  { id: 'rumble', label: 'Rumble', shows: 'link', url: (h) => `https://rumble.com/c/${h}` },
  { id: 'flickr', label: 'Flickr', shows: 'link', url: (h) => `https://www.flickr.com/photos/${h}/` },
  { id: 'linktree', label: 'Linktree', shows: 'link', url: (h) => `https://linktr.ee/${h}` },
  { id: 'website', label: 'Website', shows: 'link', at: 'origin', url: (h) => `https://${h}` },

  /*
   * Support. Every one of these refuses framing — six for six, checked — so they are links
   * and always will be. They are here rather than omitted because where support can reach
   * somebody is the thing an operator most needs said, and `funding.md`'s rule is about
   * totals and leaderboards, not about naming a destination.
   *
   * No amounts, no totals, no supporter counts, anywhere, ever.
   */
  { id: 'patreon', label: 'Patreon', shows: 'link', url: (h) => `https://www.patreon.com/${h}` },
  { id: 'kofi', label: 'Ko-fi', shows: 'link', url: (h) => `https://ko-fi.com/${h}` },
  { id: 'buymeacoffee', label: 'Buy Me a Coffee', shows: 'link', url: (h) => `https://buymeacoffee.com/${h}` },
  { id: 'wishlist', label: 'Supply wishlist', shows: 'link', url: (h) => `https://www.amazon.com/hz/wishlist/ls/${h}` }
] as const;

const BY_ID = new Map(PLATFORMS.map((p) => [p.id, p]));

/** The platform, or undefined for one this build has never heard of. */
export const platform = (id: string): Platform | undefined => BY_ID.get(id);

/** Whether this platform can hold a feature slot, or can only ever be listed. */
export const canFeature = (id: string): boolean => {
  const p = BY_ID.get(id);
  return p !== undefined && p.shows !== 'link';
};

/**
 * A handle's length.
 *
 * It lands on other people's screens, so it is bounded for the same reason a callsign is.
 * Generous over every real handle on every platform above; a Mastodon address carries an
 * instance and is the longest shape here.
 */
export const HANDLE_MAX = 96;

/**
 * The most links one card may carry.
 *
 * A feature slot, two beside it, and a list under them is the shape this is for. Twelve
 * leaves room for somebody who really is everywhere, and stops a card being a scroll on
 * somebody else's board.
 */
export const LINKS_MAX = 12;

export interface CardLink {
  /** A `PLATFORMS` id. */
  platform: string;
  handle: string;
  /**
   * A NIP-39 proof, where the platform can produce one.
   *
   * Empty for most of them, and that is the honest state rather than a gap: verifying a
   * proof means fetching it, and the platforms that refuse unauthenticated reads refuse
   * this too. A link with no proof is a **claim**, and it is rendered as one — the same
   * shape as a directory record that says nobody has checked this.
   */
  proof?: string;
}

/**
 * The characters a handle may contain.
 *
 * An allowlist rather than a list of things to reject, for the same reason every other
 * vocabulary here is closed: a denylist is a guess about what somebody will send, and this
 * string gets interpolated into a URL that a person will tap.
 *
 * Wide enough for every platform above -- `-`, `.` and `_` are ordinary in handles, `/` and
 * `@` carry the instance in a Mastodon or PeerTube address, and a `website` handle is a
 * bare domain. Narrow enough that `:`, `?`, `#` and whitespace cannot
 * appear, so a handle can neither read back as a different platform nor add a query, a
 * fragment or an authority to the URL it is spliced into.
 */
const HANDLE_CHARS = /^[A-Za-z0-9._~@/-]+$/;

/**
 * An account name on an instance.
 *
 * Looser than a DNS label because it is not one -- a Mastodon username may carry `_`, which
 * a hostname may not, and rejecting `raven_stl` would turn a correct handle into a dropped
 * link with nothing said about why.
 */
const ACCOUNT_NAME = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * A handle, or null, checked against where its platform will splice it.
 *
 * Never throws -- this runs on whatever a relay chose to send.
 */
function handleOf(value: string, p: Platform): string | null {
  const h = value.trim().replace(/^@/, '');
  if (!withinLimit(h, HANDLE_MAX)) return null;
  if (!HANDLE_CHARS.test(h)) return null;

  switch (p.at) {
    case 'subdomain':
      // A label, not an address. `evil.com/` here would move the whole origin.
      return DNS_LABEL.test(h) ? h : null;
    case 'origin': {
      /*
       * The one entry whose job is to name another host, so escaping is not the risk --
       * the operator picked the destination. What is refused is a handle that *misleads*
       * about it: `@` makes userinfo, so `navcom.app@evil.com` reads as ours and is not.
       */
      // Normalised, for the same reason: `Example.COM` and `example.com` are one site.
      return hostnameOf(h);
    }
    case 'instance': {
      // Exactly `host/user`. Two parts, the first a real host, the second a plain name.
      const parts = h.split('/');
      if (parts.length !== 2) return null;
      const host = hostnameOf(parts[0]!);
      const user = parts[1]!.replace(/^@/, '');
      if (host === null || !ACCOUNT_NAME.test(user)) return null;
      // The normalised host, so two spellings of one instance are one handle.
      return `${host}/${user}`;
    }
    default:
      // Path position. Nothing HANDLE_CHARS admits can change the origin from here.
      return h;
  }
}

/**
 * Links as NIP-39 `i` tags, in rank order.
 *
 * Throws nothing. A link naming a platform this build does not know, or carrying a handle
 * that is not one, is **dropped** — the card is still worth publishing without it, and the
 * alternative is refusing to publish a card because one field of it was mistyped.
 */
export function linkTags(links: readonly CardLink[]): string[][] {
  const tags: string[][] = [];
  const seen = new Set<string>();
  for (const link of links) {
    if (tags.length >= LINKS_MAX) break;
    const p = BY_ID.get(link.platform);
    if (!p) continue;
    const handle = handleOf(link.handle, p);
    if (handle === null) continue;
    // One entry per platform. A second is a mistake, and keeping the first keeps rank stable.
    if (seen.has(link.platform)) continue;
    seen.add(link.platform);
    const proof = typeof link.proof === 'string' ? link.proof.trim().slice(0, HANDLE_MAX) : '';
    tags.push(['i', `${link.platform}:${handle}`, proof]);
  }
  return tags;
}

/**
 * Links read back out of an event's tags, in the order they were published.
 *
 * Never throws and never returns null: tags arrive from a relay serving whatever it likes,
 * and one malformed link must not cost an operator their place on a board.
 */
export function readLinks(tags: readonly (readonly string[])[]): CardLink[] {
  const links: CardLink[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    if (links.length >= LINKS_MAX) break;
    if (tag[0] !== 'i' || typeof tag[1] !== 'string') continue;
    const at = tag[1].indexOf(':');
    if (at <= 0) continue;
    const id = tag[1].slice(0, at);
    const p = BY_ID.get(id);
    if (!p || seen.has(id)) continue;
    const handle = handleOf(tag[1].slice(at + 1), p);
    if (handle === null) continue;
    seen.add(id);
    const proof = typeof tag[2] === 'string' ? tag[2].trim() : '';
    links.push(proof ? { platform: id, handle, proof } : { platform: id, handle });
  }
  return links;
}

/**
 * How a reader should lay a card's links out: one featured, two beside it, the rest listed.
 *
 * Rank is the operator's order, but a platform that cannot be shown is never featured no
 * matter where they put it — so somebody who leads with Reddit gets Reddit listed and their
 * next showable platform featured, instead of an empty panel.
 */
export interface LinkLayout {
  feature: CardLink | null;
  beside: CardLink[];
  listed: CardLink[];
}

export function layout(links: readonly CardLink[]): LinkLayout {
  const showable = links.filter((l) => canFeature(l.platform));
  const rest = links.filter((l) => !canFeature(l.platform));
  return {
    feature: showable[0] ?? null,
    beside: showable.slice(1, 3),
    listed: [...showable.slice(3), ...rest]
  };
}
