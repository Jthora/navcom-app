import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// Plain .mjs, deliberately: this is the file node runs during a build, and testing the thing
// that actually runs is the point.
import { census, encode, packDirectory, walk } from '../../../scripts/car.mjs';

/**
 * The directory's content identifier.
 *
 * A CID is a claim of the form *"these bytes hash to this"*, and the only way that claim is
 * worth anything is if the identifier is **reproducible by somebody who does not have my
 * copy**. So the tests that matter here are not "does the encoder run" — they are:
 *
 * - the same bytes always produce the same identifier
 * - different bytes never produce the same identifier
 * - and the identifier is what an *independent* implementation would compute
 *
 * The third is the one this session earned the hard way. Five of five EIN nodes found an
 * integration that reported success without ever meeting a real counterparty, and the counter
 * in every case was a second implementation that was never told what to expect. So the leaf
 * CID below is computed from `node:crypto` and a base32 encoder written here, not from the
 * library under test. If those two disagree, one of them is wrong and it matters which.
 */

const file = (name: string, body: string) => ({
  name,
  stream: () => new Blob([new TextEncoder().encode(body)]).stream()
});

/** RFC 4648 base32, lowercase, unpadded — the multibase `b` alphabet. */
function base32(bytes: Uint8Array): string {
  const A = 'abcdefghijklmnopqrstuvwxyz234567';
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += A[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += A[(value << (5 - bits)) & 31];
  return out;
}

/**
 * A CIDv1 for a raw block, built by hand.
 *
 * `<multibase 'b'><version 0x01><codec 0x55 raw><multihash 0x12 sha2-256><length 0x20><digest>`
 * — every field a single byte at these values, so no varint encoder is needed and nothing is
 * borrowed from the library this is checking.
 */
function rawCid(body: string): string {
  const digest = createHash('sha256').update(new TextEncoder().encode(body)).digest();
  return 'b' + base32(new Uint8Array([0x01, 0x55, 0x12, 0x20, ...digest]));
}

describe('the identifier is reproducible', () => {
  it('is the same for the same bytes, every time', async () => {
    // Not a tautology: the encoder buffers, streams and re-reads, and any of those could
    // introduce order or timing dependence. Two people packing the same commit have to get
    // the same answer or content addressing buys nothing.
    const entries = () => [file('a.txt', 'one'), file('b.txt', 'two')];
    const first = await encode(entries());
    const second = await encode(entries());
    expect(first.cid.toString()).toBe(second.cid.toString());
  });

  it('changes when a single byte changes', async () => {
    const before = await encode([file('a.txt', 'intake closes 21:00')]);
    const after = await encode([file('a.txt', 'intake closes 22:00')]);
    expect(after.cid.toString()).not.toBe(before.cid.toString());
  });

  it('changes when a file is added, so a snapshot cannot silently gain a place', async () => {
    const one = await encode([file('a.txt', 'one')]);
    const two = await encode([file('a.txt', 'one'), file('b.txt', 'two')]);
    expect(two.cid.toString()).not.toBe(one.cid.toString());
  });

  it('does not depend on the order entries were handed over', async () => {
    /*
     * Written to assert the opposite, on the assumption that a UnixFS directory's identifier
     * follows insertion order and that `walk()` sorting was therefore load-bearing. It failed,
     * because the encoder sorts its own entries — so the identifier is stable across filesystem
     * enumeration order for free, which is a stronger property than sorting the walk could buy.
     *
     * Kept, and inverted, rather than deleted. The claim was wrong in a comment before it was
     * wrong in a test, and this is the thing that will notice if a future encoder stops sorting.
     */
    const ab = await encode([file('a.txt', 'one'), file('b.txt', 'two')]);
    const ba = await encode([file('b.txt', 'two'), file('a.txt', 'one')]);
    expect(ba.cid.toString()).toBe(ab.cid.toString());
  });

  it('walks in sorted order, so the file list beside the identifier is stable', () => {
    const files = walk();
    expect(files).toEqual([...files].sort());
    expect(files.length).toBeGreaterThan(0);
  });
});

describe('checked against an implementation that is not the library', () => {
  it('computes the leaf identifier the way the spec says, not just the way ipfs-car does', async () => {
    /*
     * The whole point of the file. `sha256` from node, base32 written above, the CIDv1 raw
     * prefix assembled by hand — and if that disagrees with what the encoder emitted, the
     * identifier NavCom publishes is not the one anybody else would compute for the same
     * bytes, which would make it worse than publishing nothing.
     */
    const body = 'hello world';
    const blocks: { cid: { toString(): string } }[] = [];

    // Driven through the encoder directly, because the leaf is the first block a directory
    // encoder emits and `encode` deliberately returns only the root.
    const { createDirectoryEncoderStream } = await import('ipfs-car');
    await createDirectoryEncoderStream([
      { name: 'a.txt', stream: () => new Blob([new TextEncoder().encode(body)]).stream() }
    ])
      .pipeThrough(
        new TransformStream({
          transform(block: { cid: { toString(): string } }, controller) {
            blocks.push(block);
            controller.enqueue(block);
          }
        })
      )
      .pipeTo(new WritableStream({ write() {} }));

    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0]!.cid.toString()).toBe(rawCid(body));
  });

  it('and the hand-rolled encoder is not trivially right', () => {
    // A base32 implementation that returned a constant would pass the test above. This is the
    // known vector for the same content, from the IPFS documentation.
    expect(rawCid('hello world')).toBe(
      'bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e'
    );
  });
});

describe('the archive', () => {
  it('names its root in the header, rather than importing as headless', async () => {
    /*
     * The failure the two-pass encode exists to prevent. A CAR whose header carries no root —
     * or a placeholder that was never rewritten — imports without error and pins nothing
     * useful, which is exactly the silent-success shape this project keeps finding.
     *
     * Checked by looking for the root's own bytes inside the header rather than by decoding
     * DAG-CBOR, because a second CBOR decoder here would be more code than the property is
     * worth and the substring check cannot pass by accident on a 36-byte identifier.
     */
    const { cid, bytes } = await encode([file('a.txt', 'one')]);
    const header = Buffer.from(bytes.subarray(0, 128)).toString('hex');
    const rootBytes = Buffer.from(cid.bytes as Uint8Array).toString('hex');
    expect(header).toContain(rootBytes);
  });

  it('is not empty, and grows with what it holds', async () => {
    const small = await encode([file('a.txt', 'one')]);
    const larger = await encode([file('a.txt', 'one'), file('b.txt', 'x'.repeat(4096))]);
    expect(small.bytes.length).toBeGreaterThan(0);
    expect(larger.bytes.length).toBeGreaterThan(small.bytes.length);
  });
});

describe('the sidecar describes what the identifier is of', () => {
  it('counts the same records the data checker counts', () => {
    // A CID with no census beside it tells a reader nothing about whether it is worth
    // fetching, and a census that disagrees with `npm run check:data` would be worse than
    // none — two numbers for one directory is how a receipt starts lying.
    const { regions, records } = census();
    expect(regions).toBeGreaterThan(0);
    expect(records).toBeGreaterThan(0);

    /*
     * Counted again from the files, not compared to a number typed in here.
     *
     * This asserted `records === 479`, which is a snapshot of one afternoon rather than the
     * agreement the comment above describes — it went red the first time the directory grew,
     * which is the one thing a directory is supposed to do. A literal cannot tell a census
     * that drifted from a directory that changed, and only the first of those is a bug.
     */
    const dir = fileURLToPath(new URL('../../../../data/regions/', import.meta.url));
    let expectedRegions = 0;
    let expectedRecords = 0;
    for (const slug of readdirSync(dir)) {
      const csv = join(dir, slug, 'resources.csv');
      if (!existsSync(csv)) continue;
      expectedRegions++;
      expectedRecords += readFileSync(csv, 'utf8').split(/\r?\n/).filter((l) => l.trim()).length - 1;
    }
    expect(records, 'the census and the files disagree about the directory').toBe(expectedRecords);
    expect(regions, 'the census and the files disagree about the regions').toBe(expectedRegions);
  });

  it(
    'packs every file under data/regions, not just the CSVs',
    async () => {
      // The region manifests carry country, timezone and languages — the context every row in
      // the folder inherits. A snapshot of the rows without them is a snapshot that cannot be
      // read correctly.
      //
      // Given an explicit timeout rather than the vitest default. This packs the whole real
      // directory through the real encoder — 338 files today — and that measured at ~3.3s on
      // its own, against a 5000ms default with almost no margin. That is not environmental
      // noise to blame on a busy machine: it is real work that grows as regions fill in, against
      // a generic timeout nobody had tuned for it. The number here is set well above what the
      // directory packs in today, not to the minimum that happens to pass.
      const { files } = await packDirectory();
      expect(files.some((f: string) => f.endsWith('region.json'))).toBe(true);
      expect(files.some((f: string) => f.endsWith('resources.csv'))).toBe(true);
    },
    20_000
  );
});
