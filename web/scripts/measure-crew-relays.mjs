#!/usr/bin/env node
/**
 * What the meeting pair does with crew events: groups.md phase 0's measurement, by hand.
 *
 *   node scripts/measure-crew-relays.mjs [wss://relay ...]
 *   node scripts/measure-crew-relays.mjs --burst wss://relay ...
 *
 * groups.md §7 lists what was not known before crews could ship: the largest event each relay keeps,
 * whether it stores and serves throwaway-signed `1913` events without proof of work, how long it keeps
 * events carrying an expiration, whether it indexes the single-letter routing tag, and its per-IP write
 * limits. This asks each relay, and prints what it said.
 *
 * **What it writes:** about twenty `1913` events per relay, each from a key made for it and thrown
 * away, carrying random bytes as content (sealed crew traffic looks no different), a random routing tag
 * and a NIP-40 expiration at most ten minutes out, so a relay that honours NIP-40 drops all of it on its
 * own. Nothing names NavCom, a person or a crew. Never run in a build.
 */
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';

const ARGS = process.argv.slice(2);
/**
 * Gentle unless told otherwise: one event every ten seconds, the sizes that matter and no burst.
 * relay.damus.io rate limits by volume — six events of up to 60 kB in a few seconds drew *"you are
 * noting too much"*, and going on drew a ban on this machine's address, and so on everything behind
 * the same router, for hours (measured 2026-10-29). These relays are strangers' servers, and a
 * measurement has to stay under what it is measuring.
 *
 * `--burst` sends every size at once and then twelve events as fast as the socket takes them. It runs
 * only against relays named on the command line, never the defaults, so it is always a choice.
 */
const BURST = ARGS.includes('--burst');
const GENTLE = !BURST;
const NAMED = ARGS.filter((a) => a.startsWith('wss://'));
if (BURST && NAMED.length === 0) {
  console.error('--burst runs only against relays named here: it can get this address banned. Name each one.');
  process.exit(2);
}
const RELAYS = NAMED.length > 0 ? NAMED : ['wss://relay.damus.io', 'wss://nos.lol'];
const pause = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
const now = () => Math.floor(Date.now() / 1000);
const tagOf = () => randomBytes(16).toString('hex');

/**
 * A crew event of about `bytes` as a complete event: opaque content, one routing tag, an expiry.
 * @param {number} bytes
 * @param {string} tag
 * @param {number} expiresIn seconds
 */
function crewEvent(bytes, tag, expiresIn) {
  const base = finalizeEvent({ kind: 1913, created_at: now() - Math.floor(Math.random() * 600), tags: [['y', tag], ['expiration', String(now() + expiresIn)]], content: '' }, generateSecretKey());
  const overhead = JSON.stringify(base).length;
  const content = randomBytes(Math.max(0, Math.ceil(((bytes - overhead) * 3) / 4))).toString('base64').slice(0, Math.max(0, bytes - overhead));
  return finalizeEvent({ kind: 1913, created_at: base.created_at, tags: base.tags, content }, generateSecretKey());
}

/** @param {string} url @returns {Promise<WebSocket>} */
function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

/**
 * Sends an event and waits for its OK, or says nothing came.
 * @param {WebSocket} ws
 * @param {import('nostr-tools/core').Event} event
 * @returns {Promise<{ ok: boolean | null, why: string }>}
 */
function publish(ws, event, timeoutMs = 10_000) {
  return new Promise((resolve) => {
    const done = (/** @type {{ ok: boolean | null, why: string }} */ r) => {
      ws.off('message', on);
      clearTimeout(timer);
      resolve(r);
    };
    const on = (/** @type {import('ws').RawData} */ raw) => {
      const m = JSON.parse(raw.toString());
      if (m[0] === 'OK' && m[1] === event.id) done({ ok: m[2], why: m[3] ?? '' });
      if (m[0] === 'NOTICE') done({ ok: false, why: `NOTICE ${m[1]}` });
    };
    const timer = setTimeout(() => done({ ok: null, why: 'no answer' }), timeoutMs);
    ws.on('message', on);
    ws.send(JSON.stringify(['EVENT', event]));
  });
}

/**
 * The ids a REQ for the routing tag returns before EOSE.
 * @param {WebSocket} ws
 * @param {string} tag
 * @returns {Promise<string[]>}
 */
function readTag(ws, tag) {
  return new Promise((resolve) => {
    const id = `m${tagOf().slice(0, 8)}`;
    /** @type {string[]} */
    const ids = [];
    const on = (/** @type {import('ws').RawData} */ raw) => {
      const m = JSON.parse(raw.toString());
      if (m[0] === 'EVENT' && m[1] === id) ids.push(m[2].id);
      if ((m[0] === 'EOSE' || m[0] === 'CLOSED') && m[1] === id) {
        ws.off('message', on);
        ws.send(JSON.stringify(['CLOSE', id]));
        resolve(ids);
      }
    };
    ws.on('message', on);
    ws.send(JSON.stringify(['REQ', id, { kinds: [1913], '#y': [tag] }]));
    setTimeout(() => {
      ws.off('message', on);
      resolve(ids);
    }, 15_000);
  });
}

for (const url of RELAYS) {
  console.log(`\n===== ${url}`);
  const ws = await connect(url);
  ws.setMaxListeners(50);

  // The largest event kept: the padded lengths groups.md §7 measured, and either side of 65,536.
  const sizeTag = tagOf();
  const sizes = GENTLE ? [16_336, 46_372, 65_000, 70_000] : [1_529, 16_336, 31_077, 40_912, 46_372, 60_000, 65_000, 70_000, 100_000];
  const kept = [];
  for (const bytes of sizes) {
    if (GENTLE) await pause(10_000);
    const e = crewEvent(bytes, sizeTag, 600);
    const r = await publish(ws, e);
    console.log(`size ${String(JSON.stringify(e).length).padStart(7)} B: ${r.ok === true ? 'taken' : r.ok === false ? 'refused' : 'no answer'}${r.why ? ` (${r.why})` : ''}`);
    if (r.ok) kept.push(e.id);
  }
  const served = await readTag(ws, sizeTag);
  console.log(`served back by #y: ${served.length} of ${kept.length} taken${served.length === kept.length ? '' : ' — the tag is not indexed, or something taken was not kept'}`);

  // Expiry: one already past is refused or dropped; one a minute out is gone after it.
  const pastTag = tagOf();
  const past = crewEvent(1_529, pastTag, -60);
  const pr = await publish(ws, past);
  console.log(`already expired: ${pr.ok === true ? 'taken' : 'refused'}${pr.why ? ` (${pr.why})` : ''}; served after: ${(await readTag(ws, pastTag)).length}`);
  const soonTag = tagOf();
  const soon = crewEvent(1_529, soonTag, 60);
  const sr = await publish(ws, soon);
  console.log(`expiring in 60 s: ${sr.ok ? 'taken' : 'refused'}; served now: ${(await readTag(ws, soonTag)).length}`);

  // Per-IP write limits: twelve small events as fast as the socket takes them. Not when gentle.
  if (GENTLE) {
    await pause(10_000);
    console.log('burst: skipped (gentle)');
  }
  const burstTag = tagOf();
  const burst = GENTLE ? [] : await Promise.all(Array.from({ length: 12 }, () => publish(ws, crewEvent(1_529, burstTag, 600))));
  const refusedWhy = [...new Set(burst.filter((r) => r.ok !== true).map((r) => r.why))];
  console.log(`burst of 12: ${burst.filter((r) => r.ok === true).length} taken${refusedWhy.length ? `; refused: ${refusedWhy.join(' | ')}` : ''}`);

  console.log('waiting 90 s for the 60-second event to expire…');
  await new Promise((r) => setTimeout(r, 90_000));
  console.log(`expiring in 60 s, read 90 s later: served ${(await readTag(ws, soonTag)).length}`);
  ws.close();
}
