import { createHash } from 'node:crypto';
import type { BrowserContext, Page } from '@playwright/test';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';

/**
 * Standing a test publisher into the registry the served build pins [core: missions/package.ts].
 *
 * Every mission NavCom shows comes from a registered key, and the registry holds Mecha Jono's two:
 * one whose secret leaked and is frozen, and one not yet trusted to sign. No test has either secret,
 * so no browser test could post a mission anybody can take, or a key in any other state. Here a
 * stand-in publisher is added to the registry in the code the server sends — and, for a frozen key,
 * its list beside Mecha Jono's — so a test can sign packages under keys in exactly the states it is
 * about. That changes who posts, not what the phone does.
 *
 * The splice is checked: `admitted` says whether it found the registry in what was served, so a
 * test cannot pass because nothing was changed. A build from before 2026-10-18 has the registry in
 * its earlier shape, a map of keys with no dates; the stand-in goes in that way, as near as that
 * shape can say, so a test of the new rules fails there on what the phone does rather than on the
 * splice.
 */

export interface StandInKey {
  secret: Uint8Array;
  pubkey: string;
  generation: number;
  /** Absent: not trusted to sign. */
  notBefore?: string;
  notAfter: string;
  exposed?: string;
  frozen?: { confirmed: boolean; packages: { id: string; d: string }[] };
}

export interface StandIn {
  id: string;
  name: string;
  agent: boolean;
  inbox?: string[];
  keys: StandInKey[];
}

/** A key for a stand-in, trusted from long ago until long after any test, unless told otherwise. */
export function standInKey(over: Partial<Omit<StandInKey, 'secret' | 'pubkey'>> = {}): StandInKey {
  const secret = generateSecretKey();
  return {
    secret,
    pubkey: getPublicKey(secret),
    generation: 1,
    notBefore: '2020-01-01T00:00:00Z',
    notAfter: '2100-01-01T00:00:00Z',
    ...over
  };
}

/** The digest the registry pins over a frozen list: core's `frozenDigest`, rewritten here so a build that lacks it still runs. */
export function frozenDigest(key: string, packages: { id: string; d: string }[]): string {
  const lines = [...packages].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((p) => `${p.id} ${p.d}`);
  return createHash('sha256').update([key, ...lines].join('\n'), 'utf8').digest('hex');
}

const MECHA_OLD = '6301c4d09a014909e5a48b7d0c9aa859eec18804c2fc87eab4e414aa5a319692';
const lit = (v: unknown) => JSON.stringify(v);

function entryNow(s: StandIn): string {
  const keys = s.keys.map((k) => {
    const parts = [`pubkey:${lit(k.pubkey)}`, `generation:${k.generation}`];
    if (k.notBefore !== undefined) parts.push(`notBefore:${lit(k.notBefore)}`);
    parts.push(`notAfter:${lit(k.notAfter)}`);
    if (k.exposed) parts.push(`exposed:${lit(k.exposed)}`);
    if (k.frozen) parts.push(`frozen:{sha256:${lit(frozenDigest(k.pubkey, k.frozen.packages))},confirmed:${k.frozen.confirmed ? '!0' : '!1'}}`);
    return `{${parts.join(',')}}`;
  });
  const inbox = s.inbox ? `,inbox:${lit(s.inbox)}` : '';
  return `{id:${lit(s.id)},name:${lit(s.name)},agent:${s.agent ? '!0' : '!1'}${inbox},keys:[${keys.join(',')}],next:null}`;
}

function setNow(k: StandInKey): string {
  return `{key:${lit(k.pubkey)},taken:"2026-10-18",source:"a test",packages:${lit(k.frozen!.packages)}}`;
}

/** The earlier shape: one entry per key, a name, the agent mark, the inbox and the day it was exposed. */
function entriesBefore(s: StandIn): string {
  return s.keys
    .map((k) => `${lit(k.pubkey)}:{name:${lit(s.name)},agent:${s.agent ? '!0' : '!1'}${s.inbox ? `,inbox:${lit(s.inbox)}` : ''}${k.exposed ? `,exposed:${lit(k.exposed)}` : ''}}`)
    .join(',');
}

/** Adds `standIns` to the registry in every script the page loads. The worker would serve the build's own code past this: block it. */
export async function admit(target: Page | BrowserContext, standIns: StandIn[]): Promise<{ admitted: () => boolean }> {
  let admitted = false;
  const now = standIns.map(entryNow).join(',');
  const sets = standIns.flatMap((s) => s.keys.filter((k) => k.frozen).map(setNow)).join(',');
  const before = standIns.map(entriesBefore).join(',');
  await target.route('**/_app/immutable/**/*.js', async (route) => {
    const response = await route.fetch();
    let body = await response.text();
    if (body.includes('{id:"mecha-jono",')) {
      body = body.replace('{id:"mecha-jono",', `${now},{id:"mecha-jono",`);
      admitted = true;
    } else if (body.includes(`{${lit(MECHA_OLD)}:{name:"Mecha Jono"`)) {
      body = body.replace(`{${lit(MECHA_OLD)}:{name:"Mecha Jono"`, `{${before},${lit(MECHA_OLD)}:{name:"Mecha Jono"`);
      admitted = true;
    }
    if (sets && body.includes(`{key:${lit(MECHA_OLD)},`)) body = body.replace(`{key:${lit(MECHA_OLD)},`, `${sets},{key:${lit(MECHA_OLD)},`);
    await route.fulfill({ response, body });
  });
  return { admitted: () => admitted };
}

const secs = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

/** A field mission under `key`: open, in California unless filed elsewhere, ending when given. */
export function mission(
  key: StandInKey,
  d: string,
  o: {
    title?: string;
    at?: string;
    ends?: string;
    state?: string;
    jurisdiction?: string;
    extra?: string[][];
    objectives?: { id: string; ask: string }[];
  } = {}
) {
  return finalizeEvent(
    {
      kind: 30079,
      created_at: secs(o.at ?? '2026-10-05T16:00:00Z'),
      content: JSON.stringify({ name: o.title ?? d, objectives: o.objectives ?? [{ id: `${d}#do`, ask: 'Hand out water.' }] }),
      tags: [
        ['d', d], ['t', 'starcom_mission_package'], ['t', 'navcom_handoff'], ['t', 'navcom_mission'],
        ['mission_state', o.state ?? 'open'], ['valid_until', String(secs(o.ends ?? '2026-12-31T00:00:00Z'))], ['jurisdiction', o.jurisdiction ?? 'us-ca'],
        ...(o.extra ?? [])
      ]
    },
    key.secret
  );
}

/** A real package, signed again by a stand-in: the same words, tags and date under a key a test holds. */
export function resign<T extends { kind: number; created_at: number; tags: string[][]; content: string }>(event: T, key: StandInKey) {
  return finalizeEvent({ kind: event.kind, created_at: event.created_at, tags: event.tags, content: event.content }, key.secret);
}
