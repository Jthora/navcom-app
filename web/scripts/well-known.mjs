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

  write('navcom-refusals.json', refusals);
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
