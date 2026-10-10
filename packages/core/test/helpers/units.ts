/**
 * A unit on paper, for the governance tests: per-member keys by name, a chain builder that takes
 * explicit times, and an explicit `now` for every reading. Nothing here reads a clock.
 */
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import type { Event } from 'nostr-tools/core';
import { bytesToHex, randomBytes } from '@noble/hashes/utils';
import { charterCode, lineageOf, type Charter, type Governance, type Room, type Template } from '../../src/units/charter.js';
import {
  compactOf, reasonHash, rootId, signStatement, type Act, type Office, type Statement
} from '../../src/units/statements.js';
import { buildRecall, buildResult, evaluate, type UnitInput, type UnitView } from '../../src/units/governance.js';

export const DAY = 86_400;
/** 10 January 2027, noon UTC. */
export const T0 = Date.UTC(2027, 0, 10, 12) / 1000;
export const REASON = reasonHash('in their own words');
/** Far enough ahead that nothing a test signs is held as future-dated. */
export const LATER = T0 + 20 * 365 * DAY;

export const LED: Governance = { shape: 'led', threshold: 'majority', term: 12, coCap: 'none' };

export interface UnitOptions {
  governance?: Governance;
  room?: Room;
  template?: Template;
  /** Re-founded: the founders carry signatures from two former keys, `oldA` and `oldB`. */
  reform?: boolean;
  at?: number;
}

type Body<S> = S extends Act ? Omit<S, 'unit' | 'prev'> & { prev?: readonly string[] } : never;

export class TestUnit {
  readonly unit = bytesToHex(randomBytes(16));
  readonly oldUnit = bytesToHex(randomBytes(16));
  readonly charter: Charter;
  readonly code: string;
  readonly found: [Event, Event];
  readonly root: string;
  chain: { act: Event; sign?: Event }[] = [];
  loose: Event[] = [];
  private keys = new Map<string, Uint8Array>();
  private cache: { at: string; view: UnitView } | null = null;

  constructor(o: UnitOptions = {}) {
    const governance = o.governance ?? LED;
    const led = governance.shape === 'led';
    this.charter = {
      rule: 'g1',
      template: o.template ?? (led ? 'military' : 'plain'),
      room: o.room ?? 12,
      governance,
      authority: 'word',
      higher: led
        ? { mayServe: true, under: [], top: { kind: 'alliance', articles: '0'.repeat(64) } }
        : { mayServe: false, under: [], top: { kind: 'independent' } },
      lineage: o.reform ? lineageOf(this.oldUnit) : null
    };
    this.code = charterCode(this.charter);
    const at = o.at ?? T0;
    const [a, b] = led ? ['co', 'xo'] : ['a', 'b'];
    const former = (oldName: string, newName: string) =>
      o.reform
        ? compactOf(this.sign(oldName, { t: 'refound-by', unit: this.unit, lineage: this.charter.lineage!, key: this.key(newName) }, at))
        : null;
    const fa = this.sign(a, {
      t: 'found', unit: this.unit, code: this.code, role: led ? 'co' : 'member', other: this.key(b),
      callsign: a.toUpperCase(), former: former('oldA', a)
    }, at);
    const fb = this.sign(b, {
      t: 'found', unit: this.unit, code: this.code, role: led ? 'xo' : 'member', other: this.key(a),
      callsign: b.toUpperCase(), former: former('oldB', b)
    }, at);
    this.found = [fa, fb];
    this.root = rootId(this.unit, fa.id, fb.id);
  }

  sk(name: string): Uint8Array {
    let k = this.keys.get(name);
    if (!k) {
      k = generateSecretKey();
      this.keys.set(name, k);
    }
    return k;
  }
  key = (name: string): string => getPublicKey(this.sk(name));
  nameOf = (key: string | null): string | null => {
    if (key === null) return null;
    for (const n of this.keys.keys()) if (this.key(n) === key) return n;
    return `?${key.slice(0, 8)}`;
  };
  sign = (name: string, s: Statement, at: number): Event => signStatement(this.sk(name), s, at);

  input(now: number, extra: Partial<UnitInput> = {}): UnitInput {
    return { code: this.code, unit: this.unit, found: this.found, chain: this.chain, loose: this.loose, now, ...extra };
  }
  view(now: number = LATER, extra: Partial<UnitInput> = {}): UnitView {
    const plain = Object.keys(extra).length === 0;
    const at = `${now} ${this.chain.length} ${this.loose.length}`;
    if (plain && this.cache?.at === at) return this.cache.view;
    const view = evaluate(this.input(now, extra));
    if (plain) this.cache = { at, view };
    return view;
  }
  /** What a phone holding everything would build on. */
  tips = (): string[] => this.view().head;

  // -------------------------------------------------------------------------------------------
  // Chain acts
  // -------------------------------------------------------------------------------------------

  /** Signs and appends an act. `co` adds a second signer's `sign`. */
  act<S extends Act>(name: string, body: Body<S>, at: number, co?: { name: string; at?: number }): Event {
    const { prev, ...rest } = body as { prev?: readonly string[] };
    const s = { ...rest, unit: this.unit, prev: [...new Set(prev ?? this.tips())].sort() } as unknown as Statement;
    const e = this.sign(name, s, at);
    const sign = co ? this.sign(co.name, { t: 'sign', unit: this.unit, act: e.id }, co.at ?? at) : undefined;
    this.chain.push(sign ? { act: e, sign } : { act: e });
    return e;
  }

  admit(name: string, by: readonly string[], at: number, o: { prev?: string[]; readmits?: string; callsign?: string } = {}): Event {
    return this.act(by[0]!, {
      t: 'admit', key: this.key(name), callsign: o.callsign ?? name.toUpperCase(),
      readmits: o.readmits ? this.key(o.readmits) : null, prev: o.prev
    }, at, by[1] ? { name: by[1] } : undefined);
  }
  /** Admits each name in turn, by the two given. */
  fill(names: readonly string[], by: readonly string[], at: number): void {
    names.forEach((n, i) => this.admit(n, by, at + i));
  }
  remove(names: readonly string[], by: readonly string[], at: number, prev?: string[]): Event {
    return this.act(by[0]!, {
      t: 'remove', keys: names.map(this.key).sort(), reason: REASON, prev
    }, at, by[1] ? { name: by[1] } : undefined);
  }
  leave = (name: string, at: number, prev?: string[]): Event => this.act(name, { t: 'leave', prev }, at);
  vacate = (name: string, office: Office, at: number, prev?: string[]): Event =>
    this.act(name, { t: 'vacate', office, prev }, at);
  open = (name: string, office: Office, at: number, prev?: string[]): Event =>
    this.act(name, { t: 'open', office, prev }, at);
  petition = (name: string, office: Office, subject: string, at: number, prev?: string[]): Event =>
    this.act(name, { t: 'petition', office, subject: this.key(subject), reason: REASON, prev }, at);

  // -------------------------------------------------------------------------------------------
  // Loose statements
  // -------------------------------------------------------------------------------------------

  stand(name: string, run: string, at: number): Event {
    const e = this.sign(name, { t: 'stand', unit: this.unit, run }, at);
    this.loose.push(e);
    return e;
  }
  endorse(names: readonly string[], run: string, candidate: string, at: number): Event[] {
    const out = names.map((n, i) => this.sign(n, { t: 'endorse', unit: this.unit, run, candidate: this.key(candidate) }, at + i));
    this.loose.push(...out);
    return out;
  }
  support(names: readonly string[], petition: string, at: number): Event[] {
    const out = names.map((n, i) => this.sign(n, { t: 'support', unit: this.unit, petition }, at + i));
    this.loose.push(...out);
    return out;
  }

  /** A candidate stands and the voters endorse: everything a result needs, loose. */
  vote(run: string, candidate: string, voters: readonly string[], at: number): void {
    this.stand(candidate, run, at);
    this.endorse(voters, run, candidate, at + 1);
  }

  /** The result a phone holding everything would post. */
  result(poster: string, run: string, candidate: string, at: number, prev?: string[]): Event {
    const view = this.view(at);
    const stand = this.loose.find((e) => e.pubkey === this.key(candidate) && e.content.includes(`"stand","${this.unit}","${run}"`))!;
    const e = buildResult({
      unit: this.unit, view, run, candidate: this.key(candidate), stand, endorsements: this.loose,
      prev: prev ?? view.head, at
    }, this.sk(poster));
    this.chain.push({ act: e });
    return e;
  }

  /** The recall a phone holding everything would post. */
  recall(poster: string, petition: string, at: number, prev?: string[]): Event {
    const view = this.view(at);
    const e = buildRecall({ unit: this.unit, view, petition, supports: this.loose, prev: prev ?? view.head, at }, this.sk(poster));
    this.chain.push({ act: e });
    return e;
  }

  /** Opens, votes and posts in one go. Returns the open and the result. */
  elect(o: { office: Office; opener: string; candidate: string; voters: readonly string[]; at: number; poster?: string }) {
    const open = this.open(o.opener, o.office, o.at);
    this.vote(open.id, o.candidate, o.voters, o.at + 60);
    const result = this.result(o.poster ?? o.opener, open.id, o.candidate, o.at + 600);
    return { open, result };
  }

  // -------------------------------------------------------------------------------------------
  // Readings
  // -------------------------------------------------------------------------------------------

  /** Who holds each office, by name, with acting marked. */
  offices(now: number = LATER): { co: string | null; xo: string | null; coActing: boolean; xoActing: boolean } {
    const v = this.view(now);
    if (!v.offices) throw new Error(`no offices: ${v.status} ${v.reason ?? ''}`);
    return {
      co: this.nameOf(v.offices.co.holder),
      xo: this.nameOf(v.offices.xo.holder),
      coActing: v.offices.co.acting,
      xoActing: v.offices.xo.acting
    };
  }
  members = (now: number = LATER): string[] => this.view(now).members.map((r) => this.nameOf(r.key)!).sort();
  voidReason = (id: string, now: number = LATER): string | undefined => this.view(now).void.find((v) => v.id === id)?.reason;
  heldReason = (id: string, now: number = LATER): string | undefined => this.view(now).held.find((v) => v.id === id)?.reason;
}

export const makeUnit = (o: UnitOptions = {}): TestUnit => new TestUnit(o);

/** A Led unit with the founders and `names` admitted by them. */
export function ledUnit(names: readonly string[], o: UnitOptions = {}): TestUnit {
  const u = makeUnit(o);
  u.fill(names, ['co', 'xo'], (o.at ?? T0) + 3600);
  return u;
}

export const names = (n: number, prefix = 'm'): string[] => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);

export const shuffled = <T>(xs: readonly T[]): T[] => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
};
