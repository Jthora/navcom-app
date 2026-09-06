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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createHash } from 'node:crypto';
import { CID } from 'multiformats/cid';
import * as Digest from 'multiformats/hashes/digest';
import { getPublicKey } from 'nostr-tools/pure';
import { PERMITTED, BROADCAST, REFUSALS } from '@navcom/core';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BUILD = fileURLToPath(new URL('../build/', import.meta.url));

/** Fields that decide whether a person gets a bed. A record missing these is a record. */
const DECISIVE = ['intake_hours', 'pets', 'id_required', 'capacity_signal', 'sobriety', 'accepts', 'curfew'];

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
 * What a browser actually downloads for the terminal, gzipped.
 *
 * Deliberately the same measurement `budget.mjs` makes rather than a second opinion on it:
 * two numbers for one budget is how a receipt starts disagreeing with the gate.
 */
function terminalBytes() {
  const report = join(BUILD, '.budget.json');
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

export function healthDocument(env = process.env, receiptPath = join(BUILD, '.verify-receipt.json')) {
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
    built: new Date().toISOString(),
    suites: suites ?? { ran: 'unknown', at: null, counts: null },
    // `CI` is set by every runner worth trusting and by nothing else.
    built_on: env.CI ? 'ci' : 'local',
    budget: terminalBytes(),
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

  const block = spec.match(/```\n([\s\S]*?)```/)?.[1] ?? '';
  /** @type {Record<string, string[]>} */
  const vocabulary = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^(\w+)\s+(.+)$/);
    if (m) vocabulary[m[1]] = m[2].split('\u00b7').map((t) => t.trim()).filter(Boolean);
  }

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
      }
    ],
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
    /** What will never appear, so nobody builds a field expecting it. */
    never: [
      'physical descriptors of any person — race, clothing, build, vehicle',
      'the location of people being served, including encampments and rough sleeping',
      'free text of any kind',
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
