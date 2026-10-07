/**
 * CSV -> validated records, at build time. A malformed row fails the build rather than
 * shipping as a silently wrong entry.
 *
 * Column list: docs/product/directory-schema.md
 */

import {
  ACCEPTS, ACCESSIBILITY, BELONGINGS, CAPACITY_SIGNAL, COST, FLAG, ID_REQUIRED, METHOD,
  PETS, REPORTS_TO, RESOURCE_TYPES, SEASONAL, SEX_OFFENDER_OK, SOBRIETY
} from './types.js';
import type { ResourceRecord } from './types.js';
import { isValidIsoDate } from './iso-date.js';
import { confidentialRefusal, locatingLeaks } from './confidential.js';
import { ADDRESS_DECIMALS, decimalsOf } from './precision.js';

export interface ParseIssue {
  row: number;
  column: string;
  message: string;
}

export interface ParseResult {
  records: ResourceRecord[];
  issues: ParseIssue[];
}

/** RFC4180-ish: quoted fields, doubled quotes, embedded commas and newlines. */
/** A file that cannot be read as CSV at all, as opposed to a row that fails a rule. */
export class CsvError extends Error {}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  /** Where the currently-open quote started, 1-based including the header, for the message. */
  let quoteRow = 0;
  let i = 0;

  const src = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  while (i < src.length) {
    const c = src[i];

    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }

    if (c === '"') { quoted = true; quoteRow = rows.length + 1; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }

  /*
   * A quote that never closes swallows the rest of the file.
   *
   * One stray `"` in a notes column turned every following newline and comma into text inside
   * one field, so the build shipped a directory that stopped at that row — silently, because
   * `parseDirectory` reported no issue and had none to report. Silent absence of a shelter is
   * the failure this file exists to prevent, and it was the one malformation it could not see.
   */
  if (quoted) throw new CsvError(`unterminated quote — a \`"\` opened at row ${quoteRow} and never closed`);
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => cell.trim().length > 0));
}

const blank = (v: string | undefined): boolean => v === undefined || v.trim() === '';

function enumOf<T extends readonly string[]>(
  allowed: T, raw: string | undefined, column: string, rowNo: number, issues: ParseIssue[]
): T[number] | undefined {
  if (blank(raw)) return undefined;
  const v = raw!.trim();
  if ((allowed as readonly string[]).includes(v)) return v as T[number];
  issues.push({ row: rowNo, column, message: `"${v}" is not one of: ${allowed.join(', ')}` });
  return undefined;
}

function multiOf<T extends readonly string[]>(
  allowed: T, raw: string | undefined, column: string, rowNo: number, issues: ParseIssue[]
): T[number][] | undefined {
  if (blank(raw)) return undefined;
  const parts = raw!.split('|').map((p) => p.trim()).filter(Boolean);
  const out: T[number][] = [];
  for (const p of parts) {
    if ((allowed as readonly string[]).includes(p)) out.push(p as T[number]);
    else issues.push({ row: rowNo, column, message: `"${p}" is not one of: ${allowed.join(', ')}` });
  }
  return out.length ? out : undefined;
}

function boolOf(
  raw: string | undefined, column: string, rowNo: number, issues: ParseIssue[]
): boolean | undefined {
  if (blank(raw)) return undefined;
  const v = raw!.trim().toUpperCase();
  if (v === 'TRUE') return true;
  if (v === 'FALSE') return false;
  issues.push({ row: rowNo, column, message: `"${raw}" is not TRUE or FALSE` });
  return undefined;
}

function numOf(
  raw: string | undefined, column: string, rowNo: number, issues: ParseIssue[]
): number | undefined {
  if (blank(raw)) return undefined;
  const n = Number(raw);
  if (Number.isFinite(n)) return n;
  issues.push({ row: rowNo, column, message: `"${raw}" is not a number` });
  return undefined;
}

/**
 * A coordinate, at no more precision than an address earns [precision.ts]. Refused rather than
 * rounded: the fix belongs in the file, which is published as it stands.
 */
function coordOf(
  raw: string | undefined, column: string, rowNo: number, issues: ParseIssue[]
): number | undefined {
  const n = numOf(raw, column, rowNo, issues);
  if (n === undefined) return undefined;
  const decimals = decimalsOf(raw!);
  if (decimals === null || decimals > ADDRESS_DECIMALS) {
    issues.push({
      row: rowNo,
      column,
      message:
        `"${raw!.trim()}" claims more precision than an address earns — write it as a decimal ` +
        `with at most ${ADDRESS_DECIMALS} places, about a metre`
    });
    return undefined;
  }
  return n;
}

function dateOf(
  raw: string | undefined, column: string, rowNo: number, issues: ParseIssue[]
): string | undefined {
  if (blank(raw)) return undefined;
  const v = raw!.trim();
  if (!isValidIsoDate(v)) {
    issues.push({ row: rowNo, column, message: `"${v}" is not a real YYYY-MM-DD date` });
    return undefined;
  }
  return v;
}

const str = (v: string | undefined): string | undefined =>
  blank(v) ? undefined : v!.trim();

export function parseDirectory(csv: string): ParseResult {
  const issues: ParseIssue[] = [];
  const records: ResourceRecord[] = [];

  let rows: string[][];
  try {
    rows = parseCsv(csv);
  } catch (e) {
    // Reported rather than thrown, so the caller that wants issues gets one and
    // `parseDirectoryOrThrow` still fails the build. No records: a file that cannot be scanned
    // has no rows worth trusting, including the ones before the break.
    if (!(e instanceof CsvError)) throw e;
    issues.push({ row: 0, column: 'file', message: e.message });
    return { records, issues };
  }

  if (rows.length === 0) return { records, issues };

  const header = rows[0].map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const seenIds = new Set<string>();

  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const rowNo = r + 1; // 1-based, counting the header
    const get = (name: string): string | undefined => {
      const i = idx(name);
      return i === -1 ? undefined : cells[i];
    };

    const id = str(get('id'));
    const name = str(get('name'));
    const type = enumOf(RESOURCE_TYPES, get('type'), 'type', rowNo, issues);

    if (!id) { issues.push({ row: rowNo, column: 'id', message: 'required' }); continue; }
    if (!name) { issues.push({ row: rowNo, column: 'name', message: 'required' }); continue; }
    if (!type) continue; // enumOf already recorded why
    if (seenIds.has(id)) {
      issues.push({ row: rowNo, column: 'id', message: `duplicate id "${id}" — ids are never reused` });
      continue;
    }
    seenIds.add(id);

    // Absent flag means ok; an unrecognised flag is an error, not a default.
    const rawFlag = get('flag');
    const flag = blank(rawFlag) ? 'ok' : enumOf(FLAG, rawFlag, 'flag', rowNo, issues);
    if (!flag) continue;

    const record: ResourceRecord = {
      id,
      name,
      type,
      address: str(get('address')),
      lat: coordOf(get('lat'), 'lat', rowNo, issues),
      lon: coordOf(get('lon'), 'lon', rowNo, issues),
      phone: str(get('phone')),

      accepts: multiOf(ACCEPTS, get('accepts'), 'accepts', rowNo, issues),
      pets: enumOf(PETS, get('pets'), 'pets', rowNo, issues),
      sobriety: enumOf(SOBRIETY, get('sobriety'), 'sobriety', rowNo, issues),
      id_required: enumOf(ID_REQUIRED, get('id_required'), 'id_required', rowNo, issues),
      referral_required: boolOf(get('referral_required'), 'referral_required', rowNo, issues),
      sex_offender_ok: enumOf(SEX_OFFENDER_OK, get('sex_offender_ok'), 'sex_offender_ok', rowNo, issues),
      reports_to: multiOf(REPORTS_TO, get('reports_to'), 'reports_to', rowNo, issues),
      curfew: str(get('curfew')),
      max_stay: str(get('max_stay')),
      belongings: enumOf(BELONGINGS, get('belongings'), 'belongings', rowNo, issues),
      accessibility: multiOf(ACCESSIBILITY, get('accessibility'), 'accessibility', rowNo, issues),
      languages: blank(get('languages'))
        ? undefined
        : get('languages')!.split('|').map((s) => s.trim()).filter(Boolean),
      cost: enumOf(COST, get('cost'), 'cost', rowNo, issues),

      hours: str(get('hours')),
      intake_hours: str(get('intake_hours')),
      seasonal: enumOf(SEASONAL, get('seasonal'), 'seasonal', rowNo, issues),
      capacity_signal: enumOf(CAPACITY_SIGNAL, get('capacity_signal'), 'capacity_signal', rowNo, issues),

      last_verified: dateOf(get('last_verified'), 'last_verified', rowNo, issues),
      verified_by: str(get('verified_by')),
      method: enumOf(METHOD, get('method'), 'method', rowNo, issues),
      flag,

      notes: str(get('notes'))
    };

    /*
     * A refuge that shipped with its address on it.
     *
     * Reported *and* stripped, which looks like belt and braces and is not. The issue is what
     * matters for committed data: this file is in git, a maintainer has to remove the address
     * from the row rather than have a parser quietly paper over it on every build, and
     * `parseDirectoryOrThrow` turns the issue into a failed build. The strip is for the other
     * caller — `parseDirectory` hands back records *and* issues, and nothing forces a reader
     * to look at the second one. A caller that ignores issues gets a safe record anyway.
     *
     * Deliberately not `continue`: dropping the row would remove a refuge from the directory
     * because somebody filled in one field too many, and a service nobody can find is its own
     * harm. The region and the phone survive, which is what a person at 11pm actually needs.
     */
    for (const field of locatingLeaks(record)) {
      issues.push({
        row: rowNo,
        column: field,
        message: confidentialRefusal(record.type, [field])
      });
      record[field] = undefined;
    }

    records.push(record);
  }

  return { records, issues };
}

/** Build-time entry point. Throws so a malformed CSV cannot ship. */
export function parseDirectoryOrThrow(csv: string): ResourceRecord[] {
  const { records, issues } = parseDirectory(csv);
  if (issues.length > 0) {
    const detail = issues.map((i) => `  row ${i.row}, ${i.column}: ${i.message}`).join('\n');
    throw new Error(`Directory CSV has ${issues.length} problem(s):\n${detail}`);
  }
  return records;
}
