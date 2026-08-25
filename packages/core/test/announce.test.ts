import { describe, expect, it } from 'vitest';
import {
  buildAnnouncement,
  newSecretKey,
  publicKeyOf,
  readAnnouncement,
  type Announcement
} from '../src/index.js';

/**
 * The pointer.
 *
 * Two things are worth testing hard here and they are not the happy path.
 *
 * The first is **what it refuses**, because this is the only NavCom event that may cross a
 * relay operated by another project. Anything it accepts is something that can be put on
 * somebody else's box, so the cap is the boundary rather than a courtesy.
 *
 * The second is that **a valid signature never becomes evidence the claim is true.** The node
 * key proves origin and nothing else: if it leaks, somebody can announce a CID NavCom never
 * built, and the only thing standing between a consumer and that is fetching the bytes and
 * hashing them. A test suite that quietly treated a verified event as a verified *fact* would be
 * teaching the wrong lesson to whoever reads it next.
 */

const NODE = newSecretKey();
const OTHER = newSecretKey();
const CID = 'bafybeigpcpp4xcwpt7by6nzklntkjnrprfowzuvng36x7kgw26nzcjipji';

function announcement(over: Partial<Announcement> = {}): Announcement {
  return {
    artifact: 'navcom:directory',
    cid: CID,
    car: 'https://navcom.app/_ipfs/navcom-directory.car',
    census: { records: 479, regions: 68 },
    commit: '644604ca0667275cbb54b8b25f99ff7ea650d42b',
    ...over
  };
}

const roundTrip = (a: Announcement, secret = NODE) =>
  readAnnouncement(buildAnnouncement(secret, a, 1_700_000_000));

describe('what it carries', () => {
  it('reads back what was published, with the publisher attached', () => {
    const read = roundTrip(announcement());
    expect(read?.cid).toBe(CID);
    expect(read?.census).toEqual({ records: 479, regions: 68 });
    expect(read?.by).toBe(publicKeyOf(NODE));
  });

  it('is addressable on the artifact, so a later one replaces this one', () => {
    // No history worth keeping, and a relay should not be asked to prune one.
    const event = buildAnnouncement(NODE, announcement(), 1_700_000_000);
    expect(event.tags).toContainEqual(['d', 'navcom:directory']);
  });

  it('stays small — a pointer, never a payload', () => {
    /*
     * The property that makes it safe to put on somebody else's relay. If this ever grows past a
     * kilobyte, something is being transported through it that should be behind a CID instead,
     * and the relay operator is paying for it.
     */
    const event = buildAnnouncement(NODE, announcement(), 1_700_000_000);
    expect(JSON.stringify(event).length).toBeLessThan(1024);
  });

  it('names nobody', () => {
    // The whole reason this kind may cross a private relay. No callsign, no operator pubkey, no
    // region an operator is in — only what is already public on the site.
    const event = buildAnnouncement(NODE, announcement(), 1_700_000_000);
    const wire = JSON.stringify(event).toLowerCase();
    for (const forbidden of ['callsign', 'verified_by', 'operator', 'presence', 'wren']) {
      expect(wire, `"${forbidden}" reached the wire`).not.toContain(forbidden);
    }
  });
});

describe('what it refuses', () => {
  it('refuses a plaintext fetch URL', () => {
    /*
     * A pointer that can send a holder to `http://` is one anybody in the path can rewrite —
     * which defeats naming a hash in the first place, because the holder would fetch attacker
     * bytes and only the CID check would catch it. Refused at the boundary instead.
     */
    expect(() => buildAnnouncement(NODE, announcement({ car: 'http://navcom.app/x.car' }), 1)).toThrow(/https/i);
  });

  it('refuses something that is not a content identifier', () => {
    expect(() => buildAnnouncement(NODE, announcement({ cid: 'latest' }), 1)).toThrow(/identifier/i);
    expect(() => buildAnnouncement(NODE, announcement({ cid: '../../etc/passwd' }), 1)).toThrow(/identifier/i);
  });

  it('refuses an artifact name that could be anything', () => {
    expect(() => buildAnnouncement(NODE, announcement({ artifact: 'directory' }), 1)).toThrow(/artifact/i);
    expect(() => buildAnnouncement(NODE, announcement({ artifact: 'navcom:Wren' }), 1)).toThrow(/artifact/i);
  });

  it('refuses a census that is prose rather than counts', () => {
    // The one field that invites free text. A census is numbers about an artifact; anything else
    // is somebody using an announcement as a message, on a relay that agreed to carry pointers.
    expect(() => buildAnnouncement(NODE, announcement({ census: { note: 'see below' } as never }), 1)).toThrow(/count/i);
    expect(() => buildAnnouncement(NODE, announcement({ census: { records: -1 } }), 1)).toThrow(/count/i);
  });
});

describe('what a relay serves is not trusted', () => {
  it('refuses an event whose d tag disagrees with its payload', () => {
    const event = buildAnnouncement(NODE, announcement(), 1_700_000_000);
    expect(readAnnouncement({ ...event, tags: [['d', 'navcom:something-else']] })).toBeNull();
  });

  it('refuses a payload that would not have been buildable', () => {
    const event = buildAnnouncement(NODE, announcement(), 1_700_000_000);
    const body = JSON.parse(event.content);
    body.car = 'http://elsewhere.example/x.car';
    expect(readAnnouncement({ ...event, content: JSON.stringify(body) })).toBeNull();
  });

  it('refuses a forged signature — checked the way a relay delivers one', () => {
    /*
     * Written first as `readAnnouncement({ ...event, sig: 'f'.repeat(128) })`, which **passed the
     * forgery**. `finalizeEvent` marks an event verified by setting a symbol on the object, and
     * object spread carries that symbol across — so `verifyEvent` returned a cached yes without
     * checking anything.
     *
     * Not a production bug: a relay delivers JSON, which parses into a fresh object with no
     * symbol, so the check runs. It is a *test* that looked like it was verifying a signature and
     * was verifying nothing — the same shape as every finding this project has catalogued, in the
     * one place that is supposed to catch them.
     *
     * So the tamper goes through JSON, which is what actually arrives.
     */
    const event = buildAnnouncement(NODE, announcement(), 1_700_000_000);
    const overWire = (e: unknown) => JSON.parse(JSON.stringify(e));

    expect(readAnnouncement(overWire({ ...event, sig: 'f'.repeat(128) }))).toBeNull();
    // And the untampered event still reads, so the round trip itself is not what rejected it.
    expect(readAnnouncement(overWire(event))).not.toBeNull();
  });

  it('refuses an event signed by one key and claiming another', () => {
    const event = buildAnnouncement(NODE, announcement(), 1_700_000_000);
    const overWire = JSON.parse(JSON.stringify({ ...event, pubkey: publicKeyOf(OTHER) }));
    expect(readAnnouncement(overWire)).toBeNull();
  });
});

describe('the signature proves origin, never truth', () => {
  it('verifies happily for a CID that describes nothing', () => {
    /*
     * Recorded as a test because it is the thing most likely to be misunderstood by whoever wires
     * this up next. A perfectly valid, correctly signed announcement can name a hash that no
     * bytes anywhere produce — the key attests that this pipeline said it, not that it is so.
     *
     * The consumer's protection is fetching and hashing. **A node that acts on a pointer without
     * verifying the content has misunderstood what a pointer is**, and no amount of signing fixes
     * that for them.
     */
    const fiction = 'bafybeiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const read = roundTrip(announcement({ cid: fiction }));
    expect(read).not.toBeNull();
    expect(read?.cid).toBe(fiction);
  });

  it('says who signed it, so a reader can decide whose pointers they take', () => {
    // There is no authority here to check against — only an identity to weigh, which is the same
    // thing the attestation kernel does everywhere else in this system.
    expect(roundTrip(announcement(), OTHER)?.by).toBe(publicKeyOf(OTHER));
    expect(publicKeyOf(OTHER)).not.toBe(publicKeyOf(NODE));
  });
});
