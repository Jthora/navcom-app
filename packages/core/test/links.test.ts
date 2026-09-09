/**
 * Where else an operator can be found, and the outage this shape exists to prevent.
 *
 * The first block is the whole reason links ride in tags. `CARD_FIELDS` is enforced
 * refuse-not-trim, so a card carrying a field an older client does not know reads as
 * **null** on that client — the operator does not appear with fewer details, they do not
 * appear at all. A service worker means "everyone has the new build" is not a date anybody
 * picks, so that outage would be silent, indefinite, and invisible to the operator who
 * caused it by adding their TikTok.
 *
 * Everything after it is the ordinary work: rank, refusal, and the fact that a bad link
 * costs its own row and never the card.
 */

import { describe, expect, it } from 'vitest';
import { generateSecretKey } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools/core';
import {
  buildCard,
  canEmbed,
  canFeature,
  embedUrl,
  CARD_FIELDS,
  HANDLE_MAX,
  layout,
  LINKS_MAX,
  linkTags,
  platform,
  PLATFORMS,
  readCard,
  readLinks,
  type Card,
  type CardLink
} from '../src/index.js';

const contact = generateSecretKey();
const T = 1_755_300_000;

const card: Card = { callsign: 'Raven', region: 'st-louis', doing: 'Water and socks, Thursdays.' };

/** What a relay delivers: JSON, parsed. Signature memoisation does not survive it. */
const overRelay = (event: Event): Event => JSON.parse(JSON.stringify(event)) as Event;

const link = (p: string, h: string, proof?: string): CardLink =>
  proof ? { platform: p, handle: h, proof } : { platform: p, handle: h };

/**
 * The reader as it existed before links: content keys checked against the allowlist,
 * tags never looked at.
 *
 * Reimplemented here rather than imported, because the point of the assertion is what a
 * *deployed older build* does — and that build cannot be imported. If this ever disagrees
 * with `readCard`'s content handling, the disagreement is the finding.
 */
function readCardAsOldClientWould(event: Event): Card | null {
  let raw: unknown;
  try {
    raw = JSON.parse(event.content);
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  for (const key of Object.keys(c)) {
    if (!(CARD_FIELDS as readonly string[]).includes(key)) return null;
  }
  return c as unknown as Card;
}

describe('the outage this avoids', () => {
  it('a card with links is still readable by a client that has never heard of links', () => {
    const linked = overRelay(
      buildCard(contact, card, T, { links: [link('tiktok', 'raven'), link('bluesky', 'raven.bsky.social')] })
    );

    const old = readCardAsOldClientWould(linked);
    expect(old, 'an older build would drop this operator from the board entirely').not.toBeNull();
    expect(old!.callsign).toBe('Raven');
    expect(old!.region).toBe('st-louis');
  });

  it('puts nothing new in content — which is the mechanism, not a side effect', () => {
    const linked = buildCard(contact, card, T, { links: [link('youtube', 'raven')] });
    const keys = Object.keys(JSON.parse(linked.content) as Record<string, unknown>);
    for (const key of keys) expect(CARD_FIELDS as readonly string[]).toContain(key);
  });

  it('puts them in tags, in the NIP-39 shape', () => {
    const linked = buildCard(contact, card, T, { links: [link('github', 'raven', 'abc123')] });
    expect(linked.tags).toContainEqual(['i', 'github:raven', 'abc123']);
    // The region tag is still first and still the thing a board subscribes by.
    expect(linked.tags[0]).toEqual(['d', 'st-louis']);
  });

  it('carries an empty proof rather than omitting it, so the tag shape stays fixed', () => {
    const [tag] = linkTags([link('tiktok', 'raven')]);
    expect(tag).toEqual(['i', 'tiktok:raven', '']);
  });
});

describe('reading links back', () => {
  it('round-trips through a relay in the order they were published', () => {
    const event = overRelay(
      buildCard(contact, card, T, { links: [
        link('tiktok', 'raven'),
        link('instagram', 'raven.stl'),
        link('bluesky', 'raven.bsky.social')
      ] })
    );
    const read = readCard(event);
    expect(read).not.toBeNull();
    expect(read!.links.map((l) => l.platform)).toEqual(['tiktok', 'instagram', 'bluesky']);
    expect(read!.links[0]!.handle).toBe('raven');
  });

  it('gives a card with no links an empty list, not undefined', () => {
    const read = readCard(overRelay(buildCard(contact, card, T)));
    expect(read!.links).toEqual([]);
  });

  it('reads a card published before links existed', () => {
    // No fourth argument at all -- exactly what the previous build called.
    const read = readCard(overRelay(buildCard(contact, card, T)));
    expect(read).not.toBeNull();
    expect(read!.links).toEqual([]);
  });

  it('strips a leading @ so both spellings of a handle agree', () => {
    const read = readCard(overRelay(buildCard(contact, card, T, { links: [link('tiktok', '@raven')] })));
    expect(read!.links[0]!.handle).toBe('raven');
  });
});

describe('a bad link costs its own row and never the card', () => {
  const cases: [string, CardLink][] = [
    ['a platform this build has never heard of', link('myspace', 'raven')],
    ['a handle that is empty', link('tiktok', '   ')],
    ['a handle longer than a handle', link('tiktok', 'r'.repeat(HANDLE_MAX + 1))],
    ['a handle with a space in it', link('tiktok', 'raven stl')],
    ['a handle carrying a colon, which would read back as another platform', link('tiktok', 'x:y')],
    ['a handle trying to add a query', link('tiktok', 'raven?next=evil')],
    ['a handle trying to add a fragment', link('tiktok', 'raven#evil')]
  ];

  for (const [what, bad] of cases) {
    it(`drops ${what}, and still publishes the card`, () => {
      const read = readCard(overRelay(buildCard(contact, card, T, { links: [bad, link('bluesky', 'raven.bsky.social')] })));
      expect(read, 'the card must survive a bad link').not.toBeNull();
      expect(read!.card.callsign).toBe('Raven');
      expect(read!.links.map((l) => l.platform)).toEqual(['bluesky']);
    });
  }

  it('ignores a malformed i tag a relay invented', () => {
    const event = overRelay(buildCard(contact, card, T, { links: [link('tiktok', 'raven')] }));
    const tampered = { ...event, tags: [...event.tags, ['i'], ['i', 'nocolon'], ['i', ':empty', '']] };
    // Read the tags directly: the signature no longer holds, and that is a different test.
    expect(readLinks(tampered.tags).map((l) => l.platform)).toEqual(['tiktok']);
  });

  it('keeps the first of a repeated platform, so rank cannot be gamed by repetition', () => {
    const read = readLinks([
      ['i', 'tiktok:first', ''],
      ['i', 'tiktok:second', '']
    ]);
    expect(read).toEqual([{ platform: 'tiktok', handle: 'first' }]);
  });

  it('stops at the cap rather than carrying an unbounded list onto somebody else’s board', () => {
    const many = PLATFORMS.slice(0, LINKS_MAX + 4).map((p) => link(p.id, 'raven'));
    expect(many.length).toBeGreaterThan(LINKS_MAX);
    const read = readCard(overRelay(buildCard(contact, card, T, { links: many })));
    expect(read!.links).toHaveLength(LINKS_MAX);
  });
});

describe('rank is position, and capability overrides it', () => {
  it('features the first link, puts the next two beside it, lists the rest', () => {
    const out = layout([
      link('tiktok', 'a'),
      link('instagram', 'b'),
      link('youtube', 'c'),
      link('bluesky', 'd')
    ]);
    expect(out.feature!.platform).toBe('tiktok');
    expect(out.beside.map((l) => l.platform)).toEqual(['instagram', 'youtube']);
    expect(out.listed.map((l) => l.platform)).toEqual(['bluesky']);
  });

  it('never features a platform that can only ever be a link', () => {
    // Somebody leads with Reddit. Reddit refuses framing and refuses unauthenticated reads,
    // so featuring it would promise a panel that can never be filled.
    const out = layout([link('reddit', 'a'), link('tiktok', 'b')]);
    expect(out.feature!.platform).toBe('tiktok');
    expect(out.listed.map((l) => l.platform)).toContain('reddit');
  });

  it('features nothing rather than something broken when no link can be shown', () => {
    const out = layout([link('reddit', 'a'), link('x', 'b'), link('kofi', 'c')]);
    expect(out.feature).toBeNull();
    expect(out.beside).toEqual([]);
    expect(out.listed).toHaveLength(3);
  });

  it('an operator with no links has a complete card, not an empty one', () => {
    expect(layout([])).toEqual({ feature: null, beside: [], listed: [] });
  });
});

/** A handle of the shape this platform actually takes. */
const exampleHandle = (p: { id: string; at?: string }): string =>
  p.at === 'instance' ? 'example.social/raven' : p.at === 'origin' ? 'raven.example' : 'raven';

describe('fediverse handles, which carry their instance', () => {
  it('accepts host/user and normalises the host', () => {
    const read = readLinks([['i', 'mastodon:Example.Social/@Raven_STL', '']]);
    expect(read).toEqual([{ platform: 'mastodon', handle: 'example.social/Raven_STL' }]);
  });

  it('accepts an underscore in the account name, which a DNS label would not', () => {
    expect(readLinks([['i', 'mastodon:example.social/raven_stl', '']])).toHaveLength(1);
  });

  it('refuses a bare username with no instance, which would build a broken URL', () => {
    expect(readLinks([['i', 'mastodon:raven', '']])).toEqual([]);
  });

  it('refuses a host carrying a port or userinfo', () => {
    expect(readLinks([['i', 'mastodon:evil.com:8080/raven', '']])).toEqual([]);
    expect(readLinks([['i', 'mastodon:good.social@evil.com/raven', '']])).toEqual([]);
  });

  it('refuses more than two parts, so a path cannot be appended', () => {
    expect(readLinks([['i', 'peertube:example.tv/raven/extra', '']])).toEqual([]);
  });

  it('builds the account URL on the instance the operator named', () => {
    const [l] = readLinks([['i', 'mastodon:example.social/raven', '']]);
    expect(platform('mastodon')!.url(l!.handle)).toBe('https://example.social/@raven');
  });
});

describe('what can be framed', () => {
  it('builds a frame URL on the platform’s own origin, for every platform that has one', () => {
    for (const p of PLATFORMS) {
      if (!p.embed) continue;
      const handle = p.at === 'instance' ? 'example.social/raven' : p.at === 'origin' ? 'raven.example' : 'raven';
      const u = new URL(embedUrl({ platform: p.id, handle }, 'navcom.app')!);
      expect(u.protocol, `${p.id} frames over something other than https`).toBe('https:');
      expect(u.hostname.length).toBeGreaterThan(0);
    }
  });

  it('answers null for a platform with no keyless frame, rather than a broken URL', () => {
    // The ordinary answer. Most platforms refuse framing outright.
    expect(embedUrl({ platform: 'reddit', handle: 'raven' }, 'navcom.app')).toBeNull();
    expect(embedUrl({ platform: 'x', handle: 'raven' }, 'navcom.app')).toBeNull();
    expect(embedUrl({ platform: 'kofi', handle: 'raven' }, 'navcom.app')).toBeNull();
    expect(canEmbed('reddit')).toBe(false);
    expect(canEmbed('myspace')).toBe(false);
  });

  it('reaches TikTok’s creator view as a frame, not as a script in our page', () => {
    /*
     * The documented route is a <blockquote> upgraded by embed.js, which executes in our
     * document. `tiktok.com/embed/@handle` renders the same creator view inside the frame --
     * verified by rendering both, not by reading about it.
     */
    const u = embedUrl({ platform: 'tiktok', handle: 'raven' }, 'navcom.app')!;
    expect(u).toBe('https://www.tiktok.com/embed/@raven');
    expect(u).not.toMatch(/embed\.js|blockquote/);
  });

  it('tells Twitch which host is framing it, because Twitch checks', () => {
    // A preview deploy on another hostname shows Twitch's refusal rather than a player.
    expect(embedUrl({ platform: 'twitch', handle: 'raven' }, 'navcom.app')).toContain('parent=navcom.app');
    expect(embedUrl({ platform: 'twitch', handle: 'raven' }, 'preview.vercel.app')).toContain('parent=preview.vercel.app');
  });

  it('never frames a platform it would not feature', () => {
    // `shows: 'link'` means it refuses framing; offering a frame URL would promise a panel
    // that renders a refusal.
    for (const p of PLATFORMS) {
      if (p.shows === 'link') expect(canEmbed(p.id), `${p.id} is link-only but offers a frame`).toBe(false);
    }
  });

  it('cannot be pointed at another origin by a handle that passed validation', () => {
    const nasty = ['../evil.com', 'a/../../b', '@evil.com', '//evil.com', 'evil.com/'];
    for (const p of PLATFORMS) {
      if (!p.embed || p.id === 'website') continue;
      const clean = new URL(embedUrl({ platform: p.id, handle: p.at === 'instance' ? 'example.social/raven' : 'raven' }, 'navcom.app')!).hostname;
      for (const h of nasty) {
        const tags = linkTags([{ platform: p.id, handle: h }]);
        if (tags.length === 0) continue;
        const got = readLinks(tags)[0]!;
        expect(new URL(embedUrl(got, 'navcom.app')!).hostname, `${p.id} + ${h} escaped`).toBe(clean);
      }
    }
  });
});

describe('the platform registry', () => {
  it('has no duplicate ids, because an id is published and cannot be reassigned', () => {
    const ids = PLATFORMS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has an id that survives its own tag encoding', () => {
    for (const p of PLATFORMS) {
      expect(p.id, `${p.id} would split wrongly in an i tag`).not.toContain(':');
      expect(p.id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('builds an https URL on the platform’s own origin for every entry', () => {
    for (const p of PLATFORMS) {
      const url = new URL(p.url(exampleHandle(p)));
      expect(url.protocol, `${p.id} must not build a non-https URL`).toBe('https:');
      expect(url.hostname.length).toBeGreaterThan(0);
    }
  });

  it('cannot be made to point at another origin by a handle that passed validation', () => {
    // Everything `handleOf` admits, spliced into every builder. None may change the host.
    const nasty = [
      '../evil.com',
      'a/../../b',
      '@evil.com',
      '//evil.com',
      'evil.com/',
      'raven.evil.com',
      'evil.com:8080/x'
    ];
    for (const p of PLATFORMS) {
      const clean = new URL(p.url(exampleHandle(p))).hostname;
      for (const h of nasty) {
        const tags = linkTags([link(p.id, h)]);
        if (tags.length === 0) continue; // refused outright, which is also fine
        const got = readLinks(tags)[0]!;
        const host = new URL(p.url(got.handle)).hostname;
        // `website` is the one entry whose whole job is to name another host.
        if (p.id === 'website') continue;
        expect(host, `${p.id} + ${h} escaped to ${host}`).toBe(clean);
      }
    }
  });

  it('agrees with canFeature about what may hold a feature slot', () => {
    for (const p of PLATFORMS) expect(canFeature(p.id)).toBe(p.shows !== 'link');
    expect(canFeature('myspace')).toBe(false);
  });

  it('resolves a known platform and refuses an unknown one', () => {
    expect(platform('tiktok')?.label).toBe('TikTok');
    expect(platform('myspace')).toBeUndefined();
  });

  it('has somewhere for support to arrive, and nowhere for an amount', () => {
    // funding.md: a destination is fine, a total is not. Nothing here carries a number.
    const support = PLATFORMS.filter((p) => ['patreon', 'kofi', 'buymeacoffee', 'wishlist'].includes(p.id));
    expect(support.length).toBe(4);
    for (const p of support) expect(p.shows).toBe('link');
    expect(JSON.stringify(PLATFORMS)).not.toMatch(/amount|total|supporters|raised/i);
  });
});
