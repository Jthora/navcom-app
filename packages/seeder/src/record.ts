import { readFileSync, writeFileSync } from "node:fs";
import { isValidIsoDate } from "@navcom/core";

/**
 * Writing down what somebody told you on the phone.
 *
 * The other half of the call sheet, and the half that decides whether any of it counts. A
 * value is worth what its provenance says it is worth — `in_person` ranks *high*, `phone`
 * ranks *medium*, `website` ranks *low* — so an answer recorded without `method` and
 * `verified_by` is an answer that changes nothing about how the directory reads.
 *
 * ## What it refuses
 *
 * - **An empty value.** A blank field renders as *unknown*, which is honest. Writing `""`
 *   because somebody would not say is the same thing as leaving it alone, so this says so and
 *   stops rather than pretending a call happened
 * - **A method it cannot rank.** Only `in_person`, `phone`, `staff_confirmed` and `website`,
 *   because those are what `confidenceForField` knows
 * - **A callsign it was not given.** `verified_by` is the whole model — *provenance by name* —
 *   and an anonymous check is a check nobody can weigh
 *
 * It refuses rather than warns because this is the one file in the project where a careless
 * write ends with somebody standing outside a locked door.
 */

const METHODS = new Set(["in_person", "phone", "staff_confirmed", "website"]);

function split(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const quote = (v: string): string =>
  /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;

export interface RecordArgs {
  slug: string;
  id: string;
  by: string;
  method: string;
  on: string;
  fields: Record<string, string>;
}

export function parseRecordArgs(slug: string, rest: string[]): RecordArgs {
  const id = rest[0];
  if (!id) throw new Error("which record? usage: record <region> <id> --by <callsign> --method phone --<field> \"<value>\"");

  const flags: Record<string, string> = {};
  for (let i = 1; i < rest.length; i++) {
    const a = rest[i];
    if (!a?.startsWith("--")) continue;
    const key = a.slice(2);
    const value = rest[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`--${key} needs a value. Leave a field out entirely rather than passing an empty one: blank renders as "unknown", which is the honest answer when nobody said.`);
    }
    flags[key] = value;
    i++;
  }

  const by = flags["by"];
  if (!by) throw new Error("--by <callsign> is required. Provenance by name is the whole model; a check nobody signed is a check nobody can weigh.");

  const method = flags["method"] ?? "phone";
  if (!METHODS.has(method)) {
    throw new Error(`--method must be one of ${[...METHODS].join(", ")} — those are what the confidence rules can rank.`);
  }

  const on = flags["on"] ?? new Date().toISOString().slice(0, 10);
  // isValidIsoDate, not a shape-only regex: found in robustness audit as a fourth site with
  // the same bug the other three (parse.ts, corrections.ts, places.ts) were fixed for --
  // "2023-02-30" passed a bare regex here, was written straight into committed data, and
  // only failed later, at the wrong time and the wrong blast radius: the next build/apply
  // on the region, or a full site build, days after a volunteer mistyped a date on a call.
  if (!isValidIsoDate(on)) throw new Error("--on must be a real YYYY-MM-DD date.");

  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(flags)) {
    if (k === "by" || k === "method" || k === "on") continue;
    if (!v.trim()) {
      throw new Error(`--${k} was empty. A field nobody would answer stays blank, and blank renders as "unknown" — which is true. Drop the flag.`);
    }
    fields[k] = v.trim();
  }
  if (Object.keys(fields).length === 0) {
    throw new Error("nothing to record. Pass at least one field, e.g. --pets \"service animals only\".");
  }

  return { slug, id, by, method, on, fields };
}

export function cmdRecord(path: string, args: RecordArgs): void {
  const text = readFileSync(path, "utf8");
  const lines = text.split(/\r?\n/);
  const head = split(lines[0] ?? "");

  const idAt = head.indexOf("id");
  const row = lines.findIndex((l, i) => i > 0 && l.trim() && split(l)[idAt] === args.id);
  if (row === -1) throw new Error(`no record ${args.id} in ${args.slug}.`);

  const unknown = Object.keys(args.fields).filter((f) => !head.includes(f));
  if (unknown.length) throw new Error(`not fields in this schema: ${unknown.join(", ")}`);

  const cells = split(lines[row]!);
  while (cells.length < head.length) cells.push("");

  const changed: string[] = [];
  for (const [field, value] of Object.entries(args.fields)) {
    const at = head.indexOf(field);
    const was = cells[at] ?? "";
    if (was === value) continue;
    cells[at] = value;
    changed.push(`${field}: ${was ? `${was} → ` : ""}${value}`);
  }

  /*
   * The provenance is written whether or not a value changed.
   *
   * "I called and they confirmed what we had" is a real result and the most common one. It
   * moves the record from `website`/low to `phone`/medium and resets its age, which is exactly
   * what the confidence rules are for — and a tool that only recorded *changes* would throw
   * away the commonest kind of verification.
   */
  cells[head.indexOf("verified_by")] = args.by;
  cells[head.indexOf("method")] = args.method;
  cells[head.indexOf("last_verified")] = args.on;

  lines[row] = cells.map(quote).join(",");
  writeFileSync(path, lines.join("\n"));

  console.log(`[seed] ${args.id} — ${args.by}, ${args.method}, ${args.on}`);
  if (changed.length) for (const c of changed) console.log(`         ${c}`);
  else console.log(`         confirmed as it stood`);
}
