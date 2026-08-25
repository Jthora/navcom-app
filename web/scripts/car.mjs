/**
 * The directory, addressed by what it contains rather than by where it is hosted.
 *
 * ## Why the data, and not the site
 *
 * Almost nothing in NavCom belongs on IPFS. Presence expires, the board expires, corrections
 * and places are device-local and merged at read time, and C27 makes a queryable history the
 * failure mode rather than a feature. Permanence is hostile to most of what this project does.
 *
 * There is exactly one durable public artifact here: **the directory.** It is the thing that
 * took the work and the thing somebody reads at 11pm, and today it exists in one repository
 * on one platform, addressed by its location. A CID addresses it by its content, which buys
 * the property this project actually needs — *you do not have to trust whoever handed it to
 * you.* Not the gateway, not the mirror, not the peer with the USB stick. The hash is the
 * check.
 *
 * The built site is deliberately **not** packed. Its identifier would change every build for
 * reasons that have nothing to do with what is known — asset hashes move — so it would name a
 * build rather than a snapshot. And serving the terminal from a gateway is not the failover it
 * looks like: a gateway is a different origin, so the operator's accruing tier — patrol
 * record, standing, contact key — is not there. That is its own project, not a build step.
 *
 * ## What this does not do
 *
 * It does not pin anything and it never talks to a node. It computes a CAR and a CID from
 * bytes already in this repository, which is pure local work: content addressing is
 * deterministic, so the identifier is real whether or not anybody is holding a copy yet.
 * Somebody holding a copy is a separate act by whoever runs a node, and until they do, the
 * sidecar says so in as many words.
 */

import { createDirectoryEncoderStream, CAREncoderStream } from 'ipfs-car';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DATA = join(ROOT, 'data', 'regions');
const OUT = fileURLToPath(new URL('../build/_ipfs/', import.meta.url));

/**
 * Every file under `data/regions`, in a stable order.
 *
 * **Sorted, though not for the reason this comment first gave.** It claimed the identifier
 * depended on insertion order and that sorting was therefore what made the CID reproducible.
 * A test written to prove that failed: the encoder sorts its own entries, so the identifier is
 * already stable across filesystem enumeration order. The claim was wrong in prose before it
 * was wrong in a test, which is the direction this project keeps finding these.
 *
 * The sort stays because the *file list* published beside the identifier is part of the
 * sidecar, and a list that reordered itself per machine would make two identical snapshots
 * look different to a reader. Compared byte-wise on the POSIX form, so it depends on neither
 * the platform's separator nor a locale-aware collation — the same reasoning that keeps
 * `placeId` from folding scripts together.
 *
 * @param {string} dir
 * @returns {string[]} paths relative to `data/regions`, sorted
 */
export function walk(dir = DATA) {
  /** @type {string[]} */
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(full));
    else if (entry.isFile()) found.push(relative(DATA, full));
  }
  return found.map((p) => p.split(sep).join('/')).sort();
}

/** @param {string[]} files */
function entriesFor(files) {
  return files.map((name) => ({
    name,
    stream: () => /** @type {any} */ (Readable.toWeb(createReadStream(join(DATA, name))))
  }));
}

/**
 * Encodes a set of entries, returning the root and the archive bytes.
 *
 * The root is only known after the final block, so this runs the encoder twice: once to learn
 * it, once to write a header that names it. Deliberately chosen over rewriting the header in
 * place — at this size the second pass costs milliseconds, and patching bytes at an offset is
 * the kind of cleverness that works until a library changes its header length and then fails
 * silently, producing an archive that imports as headless.
 *
 * Takes entries rather than filenames so a test can drive it with content it controls. An
 * encoder that can only be exercised against `data/regions` is one whose sensitivity to a
 * single changed byte cannot be tested at all.
 *
 * @param {{ name: string, stream: () => any }[]} entries
 * @returns {Promise<{ cid: any, bytes: Uint8Array }>}
 */
export async function encode(entries) {
  /** @type {any} */
  let root;
  const learn = createDirectoryEncoderStream(entries).pipeThrough(
    new TransformStream({
      transform(block, controller) {
        // The last block a UnixFS directory encoder emits is its root.
        root = block.cid;
        controller.enqueue(block);
      }
    })
  );
  await learn.pipeTo(new WritableStream({ write() {} }));
  if (!root) throw new Error('the encoder produced no root — refusing to publish a CID nobody computed');

  /** @type {Uint8Array[]} */
  const chunks = [];
  await createDirectoryEncoderStream(entries)
    .pipeThrough(new CAREncoderStream([root]))
    .pipeTo(new WritableStream({ write(chunk) { chunks.push(chunk); } }));

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { bytes.set(c, at); at += c.length; }
  return { cid: root, bytes };
}

/**
 * Packs `data/regions` and returns what was packed.
 *
 * @param {string[]} [files] the files to include, for tests that need a known set
 */
export async function packDirectory(files = walk()) {
  const raw = files.reduce((n, f) => n + statSync(join(DATA, f)).size, 0);
  const { cid, bytes } = await encode(entriesFor(files));
  return { cid: cid.toString(), files, raw, car: bytes };
}

/**
 * What the identifier is *of*.
 *
 * A bare hash tells a reader nothing about whether it is worth fetching. Same reasoning as
 * the health receipt: an identifier that cannot describe itself is one nobody checks.
 */
export function census(files = walk()) {
  let records = 0;
  let regions = 0;
  for (const file of files) {
    if (!file.endsWith('resources.csv')) continue;
    regions++;
    const lines = readFileSync(join(DATA, file), 'utf8').split(/\r?\n/).filter((l) => l.trim());
    records += Math.max(0, lines.length - 1);
  }
  return { regions, records };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!existsSync(DATA)) {
    console.error('[car] no data/regions — nothing to pack.');
    process.exit(1);
  }

  const { cid, files, raw, car } = await packDirectory();
  const { regions, records } = census(files);

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'navcom-directory.car'), car);

  const sidecar = {
    cid,
    car: '/_ipfs/navcom-directory.car',
    of: 'data/regions — the published directory, and the only durable public artifact NavCom produces',
    files: files.length,
    raw_bytes: raw,
    car_bytes: car.length,
    regions,
    records,
    /*
     * One file, named so the verifier knows what to ask a gateway for and what to compare it
     * against. Checking a directory root by fetching its listing proves it resolved; fetching a
     * file out of it and comparing bytes proves the *content* survived the round trip, which is
     * the claim actually being made.
     */
    sample: files.find((f) => f === 'st-louis/resources.csv') ?? files.find((f) => f.endsWith('resources.csv')) ?? files[0],
    /*
     * Said plainly, because a CID looks like a guarantee and is not one. Content addressing
     * proves these bytes hash to this identifier. It proves nothing about who is holding
     * them, and nothing about when they were published — ordering in time needs a timestamp
     * authority, which this is not and does not pretend to be.
     */
    held_by: 'nobody, until a node imports and pins it',
    /*
     * The default arrangement, published in the artifact so a node operator does not have to
     * find a document to know what to run. NavCom holds no credential for anybody's node — the
     * archive is here over ordinary HTTPS and whoever wants it fetches it.
     */
    how: 'curl -sL https://navcom.app/_ipfs/navcom-directory.car | ipfs dag import'
  };
  writeFileSync(join(OUT, 'navcom-directory.json'), JSON.stringify(sidecar, null, 2) + '\n');

  console.log(`[car] ${cid}`);
  console.log(
    `[car] ${files.length} files, ${(raw / 1024).toFixed(1)} kB raw → ${(car.length / 1024).toFixed(1)} kB car` +
      ` — ${records} records across ${regions} regions`
  );
  console.log('[car] nobody is holding it yet — anybody can change that without a credential:');
  console.log('[car]   curl -sL https://navcom.app/_ipfs/navcom-directory.car | ipfs dag import');
}
