/**
 * The two files an integrator hits before it drafts a proposal.
 *
 * Ratified as an EIN standard, and it came from here after failing twice: two nodes
 * independently proposed a NavCom feed that invariant 1 forbids, found the rule, and
 * withdrew — *after* writing the proposal. A third is currently blocked on an answer that
 * was published in a document it had no reason to re-read. **A rule that lives only in a
 * document is a rule that arrives one round late.**
 *
 * ## Generated, never hand-written
 *
 * The Academy's worst finding was a machine-readable descriptor advertising a taxonomy its
 * code had already left behind — in the file an agent parses first. NavCom would have made
 * the same mistake within a month. So the refusals come from `@navcom/core`, the region
 * figures are counted from the CSV, and nothing here is typed by a person.
 *
 * ## Why this runs after the build, not before
 *
 * It writes into `build/`, not `static/`. A generated file sitting in the repository is a
 * generated file somebody eventually edits by hand, and then the descriptor drifts in the
 * one direction that is worse than useless. Nothing to edit, nothing to drift.
 *
 * ## The receipt says what it does not know
 *
 * `navcom-health.json` exists so another node can check whether what is *deployed* was ever
 * verified — a question no node in this network could answer about any other. The field that
 * earns it is the embarrassing one: when the suite last ran, and whether it ran anywhere
 * other than one laptop. A receipt that could not express *"local, four days ago"* would be
 * worth nothing, so when this cannot establish something it writes `null` and says
 * `unknown`, exactly as a blank directory field does.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createHash } from 'node:crypto';
import { CID } from 'multiformats/cid';
import * as Digest from 'multiformats/hashes/digest';
import { getPublicKey } from 'nostr-tools/pure';
import { PERMITTED, BROADCAST, REFUSALS, DECISIVE_FIELDS } from '@navcom/core';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BUILD = fileURLToPath(new URL('../build/', import.meta.url));

/** Fields that decide whether a person gets a bed. A record missing these is a record. */
const DECISIVE = DECISIVE_FIELDS;

/**
 * Minimal CSV, quotes included, because these files contain commas in addresses.
 * @param {string} line
 * @returns {string[]}
 */
function split(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** @param {string} csvPath @returns {Record<string,string>[]} */
function rows(csvPath) {
  const lines = readFileSync(csvPath, 'utf8').split(/\r?\n/).filter((l) => l.trim());
  const head = split(lines[0] ?? '');
  return lines.slice(1).map((line) => {
    const cells = split(line);
    return Object.fromEntries(head.map((h, i) => [h, cells[i] ?? '']));
  });
}

/**
 * What the cold-start ask actually is, counted rather than remembered.
 *
 * Three artifacts said "two of 479 records", which is true network-wide across sixty-nine
 * regions and is the wrong number to plan with. A broadcaster recruiting in one metro needs
 * that metro's number, and it is much smaller — which makes the ask an afternoon rather than
 * a percentage nobody can feel.
 */
/** @param {string} metro */
export function metroFigures(metro) {
  const csv = join(ROOT, 'data', 'regions', metro, 'resources.csv');
  if (!existsSync(csv)) return null;
  const records = rows(csv);

  /** @param {Record<string,string>} r */
  const missing = (r) => DECISIVE.filter((f) => !(r[f] ?? '').trim()).length;
  // A place with no number cannot be called, however much it is missing.
  const callable = records.filter((r) => (r.phone ?? '').trim() && missing(r) > 0);
  const confirmed = records.filter((r) => {
    const m = (r.method ?? '').trim();
    return (r.verified_by ?? '').trim() && m && m !== 'website' && m !== 'secondhand';
  });

  return {
    records: records.length,
    callable: callable.length,
    confirmed_by_a_person: confirmed.length,
    decisive_fields_filled: records.reduce((n, r) => n + (DECISIVE.length - missing(r)), 0)
  };
}

export function refusalsDocument() {
  return {
    node: 'navcom',
    /** @type {string|null} */
    updated: null, // set by the writer, so the pure document stays comparable in tests
    read_this_before: 'proposing an integration. Every entry below has already been proposed by somebody.',
    refuses: REFUSALS.map(({ id, refuses, because }) => ({ id, refuses, because })),
    accepts: PERMITTED.map(({ id, refuses, because }) => ({ id, accepts: refuses, because })),
    /*
     * The one thing a peer is currently blocked on, put where it can be fetched rather than
     * republished. RevNow committed its first episodes to this and asked twice for the metro
     * and the boundary; both were answered in an artifact it had no reason to re-read.
     */
    broadcast: { ...BROADCAST, ...(metroFigures(BROADCAST.metro) ?? {}) },
    verification: '/.well-known/navcom-health.json'
  };
}

/**
 * `git status --porcelain` as paths, at most twenty: enough to see why, never a listing of a tree.
 * A modified file says how many lines moved, from `git diff --numstat` — enough to tell a host
 * adding its own platform's binary to a lockfile from somebody's edit, without publishing either.
 * @param {string} porcelain
 * @param {string | null} [numstat]
 * @returns {string[]}
 */
export function changedPaths(porcelain, numstat = null) {
  const moved = new Map();
  for (const line of (numstat ?? '').split('\n')) {
    const [added, removed, path] = line.split('\t');
    if (path) moved.set(path, `+${added} -${removed}`);
  }
  return porcelain
    .split('\n')
    .filter(Boolean)
    .slice(0, 20)
    // The status column, however much of it survived: `git()` trims, which eats the first line's.
    .map((line) => line.replace(/^\s*\S{1,2}\s+/, ''))
    .map((path) => (moved.has(path) ? `${path} (${moved.get(path)})` : path));
}

/** `git`, or nothing. A build from a tarball is a real case and must not crash the build. */
/** @param {...string} args @returns {string|null} */
function git(...args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

/**
 * What a browser actually downloads, per surface, gzipped.
 *
 * Deliberately the same measurement `budget.mjs` makes rather than a second opinion on it:
 * two numbers for one budget is how a receipt starts disagreeing with the gate. So the budget
 * step writes this report and runs first — until 2026-10-06 nothing wrote it, and this read null
 * on every deploy since it was added.
 */
function budgetReport(report = join(BUILD, '.budget.json')) {
  if (!existsSync(report)) return null;
  try {
    return JSON.parse(readFileSync(report, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * The directory's content identifier, if it has been packed.
 *
 * Read from the sidecar rather than recomputed, so the receipt and the archive can never name
 * different snapshots — the same reasoning that makes the budget figure come from the gate
 * rather than from a second measurement.
 */
function directoryCid() {
  const sidecar = join(BUILD, '_ipfs', 'navcom-directory.json');
  if (!existsSync(sidecar)) return null;
  try {
    const d = JSON.parse(readFileSync(sidecar, 'utf8'));
    return {
      cid: d.cid,
      car: d.car,
      records: d.records,
      regions: d.regions,
      held_by: d.held_by,
      /*
       * Carried through including its failure. A pin that was attempted and refused is a
       * different state from one nobody tried, and a receipt that flattened the two into
       * "absent" would hide the case worth acting on.
       */
      pin: d.pin ?? null,
      /*
       * Whether a pointer went out, including when it did not. A holder polling this endpoint is
       * exactly the reader who needs to know that announcements are failing — otherwise their
       * subscription looks quiet in a way indistinguishable from nothing having changed.
       */
      announced: d.announced ?? null
    };
  } catch {
    return null;
  }
}

/**
 * The verified-build receipt.
 *
 * `suites` is written by the test run, not by this script, and its absence is reported as
 * absence. A build that cannot prove it was tested says so — which is the entire value of
 * the file, and the reason the honest state today reads `local` with a stale date.
 */
export { nodeIdentity };

export function healthDocument(
  env = process.env,
  receiptPath = join(BUILD, '.verify-receipt.json'),
  budgetPath = join(BUILD, '.budget.json')
) {
  /*
   * The path is a parameter so a test can assert the *absent* case, which is the one that
   * matters — a receipt that could not say "unknown" would be worth nothing, and after a real
   * build the file exists, so the honest branch would otherwise never be exercised again.
   */
  const receipt = receiptPath;
  let suites = null;
  if (existsSync(receipt)) {
    try {
      suites = JSON.parse(readFileSync(receipt, 'utf8'));
    } catch {
      suites = null;
    }
  }

  const commit = git('rev-parse', 'HEAD');
  const dirty = git('status', '--porcelain');

  return {
    node: 'navcom',
    commit,
    // A build from a working tree with uncommitted changes is not the commit it names.
    clean: dirty === null ? null : dirty === '',
    /*
     * Which paths, when it is not. Every deploy has read `clean: false` while every local build of
     * the same commit is clean, and a bare false could not say whether the host had rewritten a
     * lockfile or dropped a directory of its own beside the source. Named, a reader can judge.
     */
    ...(dirty ? { changed: changedPaths(dirty, git('diff', '--numstat', 'HEAD')) } : {}),
    built: new Date().toISOString(),
    suites: suites ?? { ran: 'unknown', at: null, counts: null },
    // `CI` is set by every runner worth trusting and by nothing else.
    built_on: env.CI ? 'ci' : 'local',
    budget: budgetReport(budgetPath),
    /*
     * What the directory is, independent of where it is hosted. Null until it has been
     * packed, and `held_by` says plainly that computing an identifier is not the same as
     * anybody holding a copy — a CID looks like a guarantee and is not one.
     */
    directory: directoryCid(),
    refuses: '/.well-known/navcom-refusals.json'
  };
}

/** @param {string} name @param {unknown} doc */
/**
 * NavCom's node identity, at a path a peer can check for themselves.
 *
 * Mecha Jono's allowlist process asks for a pubkey *published somewhere independently
 * confirmable* rather than one handed over in a message, and re-checks it on a drift schedule.
 * That is the right shape and it is the same reasoning NavCom applies everywhere else: a claim
 * is worth what its method says, and "somebody told me in a chat" is a weak method.
 *
 * Derived from the secret at build time rather than written down, so the published identity
 * cannot drift from the one that actually signs. If the secret is absent the file still ships,
 * saying plainly that this node publishes no pointers — which is true and is not a failure.
 *
 * @param {NodeJS.ProcessEnv} env
 */
function nodeIdentity(env = process.env) {
  const secret = env.NAVCOM_NODE_SECRET;
  if (!secret || !/^[0-9a-f]{64}$/.test(secret)) {
    return {
      node: 'navcom',
      site: 'https://navcom.app',
      pubkey: null,
      /** Same shape either way: a reader should never have to check whether a field exists. */
      signs: [],
      authority: 'none — no node key is configured on this build, so NavCom publishes no signed pointers.',
      not: ['an operator key', 'a Watchtower key', 'a permission of any kind'],
      refuses: '/.well-known/navcom-refusals.json'
    };
  }

  const bytes = Uint8Array.from((secret.match(/../g) ?? []).map((b) => parseInt(b, 16)));
  return {
    node: 'navcom',
    site: 'https://navcom.app',
    pubkey: getPublicKey(bytes),
    /** Exhaustive. A key that signs one kind is a key whose misuse is obvious. */
    signs: [{ kind: 30078, d: 'navcom:directory', what: 'the content identifier of the published directory' }],
    /*
     * Said in the artifact, because it is the sentence most likely to be assumed away by whoever
     * wires this up. The signature proves this pipeline published something. It is not evidence
     * the pointer is correct, and a consumer's protection is fetching the bytes and hashing them.
     */
    authority: 'none — this key attests origin, never truth. Verify the CID against the content.',
    /** What this key is emphatically not, so nobody keys anything else on it. */
    not: ['an operator key', 'a Watchtower key', 'a permission of any kind'],
    refuses: '/.well-known/navcom-refusals.json'
  };
}

/**
 * What NavCom defines for the intelligence grid, and what a consumer must do about it.
 *
 * NavCom is the authority for intel produced onto the grid — Starcom refines raw intel and
 * does not mint it, so the shape is declared here and implemented downstream rather than
 * negotiated. This file exists so conformance does not require reading prose.
 *
 * The vocabulary and the status are read out of the spec and the code rather than retyped,
 * because a declaration maintained by hand is a declaration that drifts. `status` in
 * particular may not say "implemented" while nothing implements it, and may not go on saying
 * "specified" once something does.
 */
/**
 * The bytes a vocabulary CID is taken over, and the only definition of them.
 *
 * Canonical because a consumer has to reproduce it exactly: namespaces sorted, members sorted
 * inside each, no whitespace. Anything else and the hash is ours alone, which is the same as
 * not having one.
 *
 * @param {Record<string, readonly string[]>} tags
 * @returns {Buffer}
 */
export function canonicalVocabulary(tags) {
  /** @type {Record<string, string[]>} */
  const sorted = {};
  for (const ns of Object.keys(tags).sort()) sorted[ns] = [...tags[ns]].sort();
  return Buffer.from(JSON.stringify(sorted), 'utf8');
}

/**
 * A raw CIDv1 over those bytes, computed synchronously.
 *
 * Raw rather than UnixFS: a consumer must be able to recompute this from the JSON they already
 * fetched, with a sha256 and a multihash and nothing else. A directory-wrapped identifier would
 * require them to run our encoder, which makes the check depend on agreeing about a library
 * rather than about the content.
 *
 * @param {Record<string, readonly string[]>} tags
 * @returns {string}
 */
export function vocabularyCid(tags) {
  const bytes = canonicalVocabulary(tags);
  const mh = Digest.create(0x12, createHash('sha256').update(bytes).digest());
  return CID.create(1, 0x55, mh).toString();
}

export function intelDocument(root = ROOT) {
  const spec = readFileSync(join(root, 'docs/product/raw-intel.md'), 'utf8');

  /*
   * Anchored to the vocabulary section, not to the first fence in the file.
   *
   * It took whatever bare fenced block came first, which was the vocabulary right up until a
   * section above it gained a code example -- and then the published vocabulary silently
   * emptied, which tells every consumer that every tag is unknown. Caught by the guard below
   * rather than in production, and the guard's own comment had predicted this exact shape.
   *
   * Anchoring means a fence added anywhere else in the spec cannot reach it.
   */
  const section = spec.split(/^## 7\./m)[1] ?? '';
  const block = section.match(/```\n([\s\S]*?)```/)?.[1] ?? '';
  /** @type {Record<string, string[]>} */
  const vocabulary = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^(\w+)\s+(.+)$/);
    if (m) vocabulary[m[1]] = m[2].split('\u00b7').map((t) => t.trim()).filter(Boolean);
  }

  /*
   * How an observation is found, read out of §4's table rather than typed here.
   *
   * §4 pinned `g` and `d` and this file said nothing about either, so the one document a
   * consumer is told to conform to was silent on how to ask for the object it defines. A
   * consumer building a filter on `#g` found the builder emitting it, a comment beside it
   * calling discovery unsettled, and nothing here to settle it -- and had to ask whether its
   * filter would keep working. Anchored to the subsection for the vocabulary's reason: a table
   * added anywhere else in the spec cannot reach it.
   */
  const finding = spec.split(/^### Finding one/m)[1]?.split(/^#{2,3} /m)[0] ?? '';
  const discovery = [...finding.matchAll(/^\| `(\w)` \| (.+?) \| `(.+?)` \|$/gm)]
    .map(([, tag, carries, filter]) => ({ tag, carries, filter }));

  /*
   * Derived from whether anything can BUILD one, not whether a constant exists.
   *
   * This tested `kinds.ts` for `KIND_OBSERVATION = 1911`, which would have flipped a public
   * contract to "implemented" on a one-line commit declaring a number — while no operator could
   * file an observation and none existed. Starcom would have been told to expect events that
   * nothing emits. Declaring a kind is not implementing an object, and this project's own
   * standard is that a mechanism nobody can reach is not built.
   */
  const emitted = existsSync(join(root, 'packages/core/src/directory/observation.ts'));

  /*
   * The report kind is reserved and unbuilt. Derived from a builder existing rather than from the
   * constant in `kinds.ts`, which is exactly the distinction the comment above was written for.
   */
  const reportEmitted = existsSync(join(root, 'packages/core/src/events/report.ts'));

  /*
   * The same question, asked of the other half, because the answer is different.
   *
   * `buildRefinement` is implemented in core, tested, and **called by nothing** -- so every
   * observation NavCom has ever published is `area`, and the 48-hour delay this file declares
   * has never once elapsed into an event. That is precisely the failure the comment above
   * describes: a consumer told to expect something nothing emits. It was true one field over
   * while the guard watched the first.
   *
   * Derived rather than remembered, so the day somebody wires a caller the declaration stops
   * carrying the note on its own. Core and its own tests do not count -- a caller there is the
   * thing being tested, not a path an operator can reach.
   */
  const refinable = (() => {
    /** @param {string} dir @returns {boolean} */
    const calls = (dir) => {
      let found = false;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (found) break;
        const at = join(dir, entry.name);
        if (entry.isDirectory()) found = calls(at);
        else if (/\.(ts|svelte|js)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
          found = readFileSync(at, 'utf8').includes('buildRefinement(');
        }
      }
      return found;
    };
    try {
      return calls(join(root, 'web/src'));
    } catch {
      return false;
    }
  })();

  return {
    spec: 'navcom-intel',
    version: '0.1.0',
    document: 'https://navcom.app/docs/product/raw-intel/',
    /* The sentence most likely to be assumed away: this is not a proposal to Starcom. */
    authority:
      'NavCom defines what raw intel is on this grid. A consumer conforms to this document; ' +
      'it does not negotiate with it. Changes are announced here, by version.',
    status: emitted
      ? 'implemented in core — an observation can be built and signed. Whether an operator can reach it is a separate question this file does not answer'
      : 'specified, not implemented — nothing can build an observation yet, and none exists',
    defines: [
      {
        kind: 1911,
        name: 'observation',
        range: 'regular (1000-9999) — stored, immutable, superseded but never edited',
        signed_by: 'contact key, or anonymous. Never the operational key',
        required: ['anchor', 'observed_at', 'tags', 'method', 'callsign', 'precision'],
        method: ['saw', 'told', 'inferred'],
        precision: ['area', 'exact']
      },
      {
        kind: 1912,
        name: 'report',
        range: 'regular (1000-9999) — stored, immutable, superseded but never edited',
        signed_by: 'the operator\'s contact key, the one that signed their card. Never the operational key',
        /*
         * Derived, not asserted, for the reason the status above is: reserving a number is not
         * implementing an object, and a consumer told to expect events nothing sends builds against
         * a world that does not exist. This flips the day a builder appears in core.
         */
        emitted: reportEmitted,
        /* Undefined while reserved, so JSON leaves them out: the fields are stated once something sends them. */
        required: reportEmitted ? ['callsign', 'date'] : undefined,
        optional: reportEmitted ? ['does', 'region', 'counts', 'supersedes'] : undefined,
        mission_tags: reportEmitted ? ['a', 'ask'] : undefined,
        sealed: reportEmitted
          ? 'A mission report may instead be sealed to the mission\'s poster (NIP-44, NIP-59, to the relays its kind-10050 list names). The poster\'s labels then name the id inside the seal'
          : undefined,
        note: reportEmitted
          ? 'An operator\'s own account of their own work, signed by the contact key. On its own: a callsign, a day (YYYY-MM-DD, never a time) and one to three activity terms, with an optional region in the content and never as a tag. Naming a mission instead: an `a` tag for the package, an `ask` tag per objective done, and counts that each answer one of the poster\'s own `effect` lines verbatim, of things and never of people — a reader drops a count whose line the package does not carry. No g tag, no t tags, no partners, no coordinates, no free text; a report carrying any field or tag outside this is refused, not trimmed. NavCom\'s client sends none the same day as the work.'
          : 'RESERVED. Nothing in NavCom builds one yet, so none exists. The number is allocated so that nobody else takes it and an implementer has something citable. Fields are settled in docs/design/the-artifact-that-leaves.md and in the exchange with Archangel Agency: callsign, date, one to three activity terms, an optional region in the content and never a tag, and an optional supersedes. No g tag, no t tags, no mission, no partners, no counts, no coordinates, no time of day.'
      }
    ],
    /*
     * Stated here so both tags sit inside the versioning commitment below: moving either one is
     * a breaking change, announced and overlapped like any other, rather than a quiet edit to a
     * builder that leaves a consumer's filter matching nothing -- which looks exactly like
     * nobody having observed anything.
     */
    discovery: {
      tags: discovery,
      region_is: 'a directory region slug: the id in https://navcom.app/directory/<region>/, and the same `g` a kind 30915 place carries. Never a geohash. A few slugs happen to parse as one; decode none of them',
      position_is: 'in content only, where `precision` governs it. No tag on this kind carries a position',
      refinement:
        'carries only `refines`, which relays do not index, and neither tag above. Find one by author' +
        (refinable ? '' : '. Moot while `refinement_not_emitted` stands')
    },
    /** Obligations on whoever consumes this. Each is a way the exchange stops compounding. */
    requires: [
      'Preserve the chain: a refined report cites the event ids it was built from, so a third party can walk it back without asking either of us',
      'Grade downstream. NavCom carries method, which is a fact; it never grades its own operators, which would be a reputation system by another name',
      'Treat an unknown tag as unknown. Never infer meaning from a tag absent from this vocabulary',
      'Expect no free text. There is none, by construction — a parser hoping for some is a parser waiting for a descriptor',
      'F6 is a valid grade. There is no quality bar at submission, so low-confidence intel is the normal case and not an error',
      'Treat a `refines` event as REPLACING the observation it names, never as a second one. The two must never corroborate each other — dedup on event id is correct and does not catch this, because they are genuinely distinct events',
      'Honour `precision`. An `area` observation is a 4-character geohash and must render as an area; drawing it as a point asserts a location the operator deliberately withheld, which is usually a real address belonging to someone uninvolved',
      'Do not alias `method` onto an existing vocabulary. `saw` and `told` are not the nearest words in your taxonomy — `told` in particular cannot name who told them, because that would be a person the anchor rule forbids, so it is unverifiable by construction rather than merely unverified'
    ],
    /*
     * The limit on the claim above, published because an earlier version of this file made the
     * stronger one and a consumer may have built against it.
     *
     * An anchor has a name and a name is free text — there is no directory without names, so
     * it cannot be closed the way a notes field was. The observation carries none; the record
     * it points at carries one. A consumer resolving an anchor is therefore handling
     * unstructured text and should treat it as such, whatever this document says about
     * observations.
     *
     * What the schema does buy is narrower and still worth having: no CATEGORY exists for
     * locating people, so there is no way to file a class of thing. It prevents a system for
     * finding people. It does not prevent one person lying once.
     */
    /*
     * Published for the same reason as the block below it: this file already told a consumer
     * to expect these events, and one may have built for them.
     */
    ...(refinable
      ? {}
      : {
          refinement_not_emitted: {
            claim:
              'No `exact` observation exists. Every observation published so far is `area`, and the 48-hour delay below has never elapsed into an event.',
            why: 'Every anchor available today is a published directory record, and that record ships its coordinates at full precision in the directory itself — so refining would withhold for 48 hours a number the same application publishes outright. The split earns its keep when §5\'s anchor object exists and an observation can name something that is not a row.',
            consumer_should:
              'Implement the `refines` rule above regardless — it is cheap, and the day one fires you have to be right already — but do not wait for a refinement, and never read an absent one as a position deliberately withheld.'
          }
        }),
    anchor_names_are_free_text: {
      claim: 'The observation carries no free text. The anchor it references has a name, which does.',
      consumer_should: 'Treat a resolved anchor name as unstructured text. Do not infer from this document that nothing in the chain is free-form.',
      why_not_closed: 'There is no directory without names. This is a limit, not a hole.'
    },
    /** What will never appear, so nobody builds a field expecting it. */
    never: [
      'physical descriptors of any person — race, clothing, build, vehicle',
      'the location of people being served, including encampments and rough sleeping',
      'free text of any kind IN THE OBSERVATION — but see `anchor_names_are_free_text` below, because the thing it references is not so constrained',
      'photographs (deferred, not forgotten)',
      'anything signed by an operational key'
    ],
    parameters: {
      precision_delay_hours: 48,
      /* A count, not a distance. "Coarse" is not a specification and an earlier draft's
         adjective and example disagreed by eight-fold. The privacy claim is a function of
         this number, so it is normative and pinned. */
      area_geohash_chars: 4,
      expiry_days: 90,
      expiry_rule: 'uncorroborated and uncited observations are dropped from local stores; cited ones are kept. Not a property of the event — a relay that keeps everything is not in violation'
    },
    /**
     * How this contract changes, so a bump cannot silently stop ingestion.
     *
     * A consumer is told to fail closed on an unrecognised version, which is right and makes
     * a surprise bump NavCom's failure rather than theirs.
     */
    versioning: {
      policy: 'semver. A breaking change increments major and is announced here before it ships',
      overlap_days: 90,
      commitment: 'Both versions are emitted during the overlap. A consumer failing closed on an unknown version will never be starved without warning'
    },
    vocabulary: {
      status: 'stub — needs local knowledge, and is deliberately not generated',
      /*
       * Cache policy, because staleness here rejects valid data rather than serving old data.
       *
       * Degrade PERMISSIVE. A list you cannot confirm is current must not be enforced: doing
       * so drops real observations that then look exactly like malformed input, which is the
       * worst failure available — silent, and it discards what the network is shortest of.
       */
      cache: {
        ttl_seconds: 3600,
        max_stale_seconds: 86400,
        /*
         * Bounds, so a consumer does not have to invent a sanity check.
         *
         * Starcom had to refuse a non-positive ttl on its own initiative — zero means refetch
         * on every call, which is a denial of service against us, published by us. A contract
         * that can instruct a consumer to hurt its publisher should say what it will never
         * ask for, rather than leaving each consumer to guess a floor.
         */
        ttl_seconds_min: 60,
        ttl_seconds_max: 86400,
        on_out_of_range: 'refuse the value and use your own default. A ttl outside these bounds is a defect in this document, not an instruction',
        on_stale: 'validate tag SHAPE only, and say so in the drop reason. Never enforce a list you cannot confirm is current',
        note: 'A vocabulary change does NOT bump this contract version — the list is data, the version covers the shape. A consumer refetching only on a version change would never refetch.'
      },
      /*
       * Signed out-of-band, because this file is a supply-chain surface.
       *
       * Compromise the origin and you choose what a consumer accepts — an attacker's allowlist,
       * enforced by us. The staleness ceiling caps that at 24 hours; this closes it. The same
       * CID is announced as kind 30078 under `d: navcom:intel-vocabulary`, signed by the node
       * key, on relays the web origin does not control. A consumer recomputes it from
       * `vocabulary.tags` and compares against the relay copy. They must not take this field's
       * word for itself — a CID published beside the thing it describes proves nothing alone.
       */
      cid: vocabularyCid(vocabulary),
      cid_announced_as: { kind: 30078, d: 'navcom:intel-vocabulary' },
      cid_over: 'JSON.stringify of vocabulary.tags with namespaces sorted and members sorted within each, utf8, no whitespace. Raw CIDv1, sha2-256.',
      tags: vocabulary
    },
    /**
     * What a normal publication rate looks like, so anomaly detection can be distributed.
     *
     * Proposed by NavCom and then not implemented for several rounds. Stated publicly it costs
     * nobody a staffed watch: a relay operator, a consumer or a bystander can all notice a rate
     * that is not a person, without either of us telling them what to look for.
     */
    volume: {
      shape: 'An observation is a human act at human rate. It is produced by somebody standing somewhere.',
      per_operator_per_patrol: 'single digits typically; tens is a very busy night',
      per_operator_per_day_max_plausible: 50,
      abnormal: 'A sustained rate above this from one key is not a person on foot. It is not proof of bad faith — a scripted importer would look the same — but nothing in NavCom produces it, so it did not come from the app.',
      note: 'These are expectations, not limits. NavCom enforces no rate; it has no server that could.'
    },
    /*
     * Where bulk belongs, published because the expensive path was the only one a consumer could
     * find.
     *
     * `/directory.json` is a convenience: one file, every record, 16 MB uncompressed and 1.3 MB
     * gzipped -- a twelvefold penalty for any client that omits `Accept-Encoding`, which a
     * hand-rolled fetcher routinely does. It is linked by no page, disallowed in `robots.txt`
     * since the crawl spike of 2026-10-04, and nothing here had ever told a consumer that a
     * content-addressed copy exists instead.
     *
     * The CAR is the path bulk traffic is supposed to take: fetched once, verified against a CID
     * announced on relays this origin does not control, and fetched again only when that CID
     * moves. A consumer polling the JSON export on a timer pays for the same bytes repeatedly and
     * takes our word for them every time.
     */
    bulk: {
      car: 'https://navcom.app/_ipfs/navcom-directory.car',
      cid_announced_as: { kind: 30078, d: 'navcom:directory' },
      prefer:
        'Fetch the CAR once, verify it against the announced CID, and fetch again when the CID changes. Watch the announcement rather than polling an HTTPS file.',
      json_export: 'https://navcom.app/directory.json',
      json_export_note:
        'A convenience, not the contract. Disallowed to crawlers, uncompressed for any client that does not ask for compression, and may be rate limited. Nothing in this document depends on it staying free to poll.'
    },
    refuses: '/.well-known/navcom-refusals.json'
  };
}

/** @param {string} name @param {unknown} doc */
function write(name, doc) {
  const dir = join(BUILD, '.well-known');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), JSON.stringify(doc, null, 2) + '\n');
  return join(dir, name);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!existsSync(BUILD)) {
    console.error('[well-known] no build/ — run `npm run build` first.');
    process.exit(1);
  }
  const refusals = refusalsDocument();
  refusals.updated = new Date().toISOString().slice(0, 10);
  const health = healthDocument();

  const identity = nodeIdentity();

  const intel = intelDocument();

  write('navcom-refusals.json', refusals);
  write('navcom-intel.json', intel);
  write('navcom-health.json', health);
  write('navcom-node.json', identity);

  console.log(
    `[well-known] refusals: ${refusals.refuses.length} refused, ${refusals.accepts.length} accepted`
  );
  console.log(
    `[well-known] broadcast: ${refusals.broadcast.metro} — ${refusals.broadcast.callable} callable, ` +
      `${refusals.broadcast.confirmed_by_a_person} confirmed by a person`
  );
  console.log(
    `[well-known] receipt: ${health.suites.ran}${health.suites.at ? ` at ${health.suites.at}` : ''}, built on ${health.built_on}`
  );
  console.log(
    `[well-known] identity: ${identity.pubkey ?? 'no node key — publishes no pointers'}`
  );
}
