#!/usr/bin/env node
/**
 * Writes the frozen set: the package versions NavCom keeps from Mecha Jono's exposed key
 * [packages/core/src/missions/frozen.ts; interchange spec §3, rev 7].
 *
 * **The owner runs this; nothing else does.** Which ids NavCom treats as genuine under a key whose
 * secret leaked is a decision about trust, so it is made by a person, on a day they choose, and
 * committed where the diff shows it. It reads relays, so it never runs in a build or a test.
 *
 *   node scripts/frozen-set.mjs            the newest version of each mission NavCom reads today,
 *                                          from The Record and its mirror, signatures checked
 *   node scripts/frozen-set.mjs --list F   cut down to Mecha Jono's own signed list of the 30079
 *                                          ids it signed, one id per line in F, once the owner has
 *                                          confirmed that list out of band
 *   node scripts/frozen-set.mjs --check    whether frozen.ts matches the digest the registry pins
 *
 * It writes frozen.ts and prints the digest. **The registry's pin is changed by hand**, in
 * packages/core/src/missions/package.ts: a list and its pin edited by one command would make the
 * pin say nothing. After `--list`, set `confirmed: true` there too. Then run core's tests: the
 * build refuses a list that does not match its pin.
 *
 * Every version NavCom has read from this key is dated after the exposure, so a snapshot can hold
 * a planted one. That is why each mission on an unconfirmed list shows at its jurisdiction only and
 * cannot be taken, and why `--list` exists.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { verifyEvent } from 'nostr-tools/pure';
import { FROZEN_SETS, MISSION_PUBLISHERS, MISSION_RELAYS, frozenDigest } from '@navcom/core';

const OUT = fileURLToPath(new URL('../../packages/core/src/missions/frozen.ts', import.meta.url));
const KEY = '6301c4d09a014909e5a48b7d0c9aa859eec18804c2fc87eab4e414aa5a319692';
const WAIT_MS = 15_000;

/** @typedef {{ id: string, pubkey: string, created_at: number, kind: number, tags: string[][], content: string, sig: string }} Signed */

/**
 * Every event `filter` matches on `url`, until its end of answer or the wait.
 * @param {string} url @param {Record<string, unknown>} filter @returns {Promise<Signed[]>}
 */
function ask(url, filter) {
  return new Promise((resolve) => {
    /** @type {Signed[]} */
    const events = [];
    let done = false;
    const ws = new WebSocket(url);
    /** @param {string} [why] */
    const finish = (why) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* already gone */
      }
      if (why) console.error(`[frozen-set] ${url}: ${why}`);
      resolve(events);
    };
    const timer = setTimeout(() => finish('no end of answer in time'), WAIT_MS);
    ws.addEventListener('open', () => ws.send(JSON.stringify(['REQ', 'frozen', filter])));
    ws.addEventListener('message', (m) => {
      let f;
      try {
        f = JSON.parse(String(m.data));
      } catch {
        return;
      }
      if (f[0] === 'EVENT' && f[1] === 'frozen') events.push(f[2]);
      else if (f[0] === 'EOSE' && f[1] === 'frozen') finish();
      else if (f[0] === 'CLOSED' && f[1] === 'frozen') finish(`refused: ${f[2] ?? ''}`);
    });
    ws.addEventListener('error', () => finish('could not connect'));
  });
}

/** @param {Signed} e */
const dOf = (e) => e.tags.find((t) => t[0] === 'd')?.[1];

/**
 * The best signed version of each `d`, from every relay: newest, then the lower id, nothing dated ahead.
 * @param {Record<string, unknown>} filter @returns {Promise<{ id: string, d: string }[]>}
 */
async function current(filter) {
  const latest = Math.floor(Date.now() / 1000) + 86_400;
  /** @type {Map<string, Signed>} */
  const best = new Map();
  for (const url of MISSION_RELAYS) {
    for (const e of await ask(url, filter)) {
      if (!e || e.kind !== 30079 || e.pubkey !== KEY || !Array.isArray(e.tags) || !verifyEvent({ ...e })) continue;
      const d = dOf(e);
      if (typeof d !== 'string' || e.created_at > latest) continue;
      const held = best.get(d);
      if (!held || e.created_at > held.created_at || (e.created_at === held.created_at && e.id < held.id)) best.set(d, e);
    }
  }
  return [...best.values()].map((e) => ({ id: e.id, d: /** @type {string} */ (dOf(e)) })).sort((a, b) => (a.id < b.id ? -1 : 1));
}

/**
 * frozen.ts with `set` in it, and everything else in the file as it was.
 * @param {{ key: string, taken: string, source: string, packages: readonly { id: string, d: string }[] }} set
 * @param {string} [before]
 */
export function source(set, before = readFileSync(OUT, 'utf8')) {
  const head = before.slice(0, before.indexOf('export const FROZEN_SETS'));
  const tail = before.slice(before.indexOf('\n];\n', before.indexOf('export const FROZEN_SETS')) + '\n];\n'.length);
  /** @param {string} v */
  const q = (v) => `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  const packages = set.packages.map((p) => `      { id: ${q(p.id)}, d: ${q(p.d)} }`).join(',\n');
  return (
    head +
    `export const FROZEN_SETS: readonly FrozenSet[] = [\n  {\n    key: ${q(set.key)},\n    taken: ${q(set.taken)},\n    source: ${q(set.source)},\n    packages: [\n${packages}\n    ]\n  }\n];\n` +
    tail
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pinned = MISSION_PUBLISHERS.flatMap((e) => e.keys).find((k) => k.pubkey === KEY)?.frozen;
  const args = process.argv.slice(2);

  if (args[0] === '--check') {
    const set = FROZEN_SETS.find((s) => s.key === KEY);
    const digest = set ? frozenDigest(set) : null;
    console.log(`[frozen-set] frozen.ts ${digest}\n[frozen-set] pinned    ${pinned?.sha256 ?? 'nothing'}`);
    process.exit(digest && digest === pinned?.sha256 ? 0 : 1);
  }

  const taken = new Date().toISOString().slice(0, 10);
  let packages;
  let sourceText;
  if (args[0] === '--list') {
    const ids = [...new Set(readFileSync(args[1], 'utf8').split(/\s+/).filter((x) => /^[0-9a-f]{64}$/.test(x)))];
    if (ids.length === 0) throw new Error(`No 64-hex ids in ${args[1]}.`);
    const found = await current({ ids, kinds: [30079], authors: [KEY] });
    for (const id of ids) if (!found.some((p) => p.id === id)) console.error(`[frozen-set] ${id} is on the list and no relay serves it: replaced or deleted since, so it is not kept`);
    packages = found.filter((p) => ids.includes(p.id));
    sourceText = `Mecha Jono's signed list of the 30079 ids it signed under this key, confirmed by the owner, cut to what the relays serve, ${taken}`;
  } else {
    packages = await current({ kinds: [30079], authors: [KEY], '#t': ['navcom_mission'] });
    sourceText = `the newest version of each mission NavCom read from The Record and its mirror on ${taken}, signatures checked; not yet confirmed by Mecha Jono`;
  }

  const set = { key: KEY, taken, source: sourceText, packages };
  writeFileSync(OUT, source(set));
  const digest = frozenDigest(set);
  console.log(`[frozen-set] ${packages.length} package(s) written to ${OUT}`);
  console.log(`[frozen-set] sha256 ${digest}`);
  console.log(`[frozen-set] now set, by hand, in packages/core/src/missions/package.ts:`);
  console.log(`             frozen: { sha256: '${digest}', confirmed: ${args[0] === '--list'} }`);
}
