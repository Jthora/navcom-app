#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { callsFor, render } from "./callsheet.js";
import { cmdRecord, parseRecordArgs } from "./record.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDirectoryOrThrow } from "@navcom/core";
import { audit } from "./audit.js";
import { dedupe } from "./dedupe.js";
import { toCsv } from "./emit.js";
import { merge } from "./merge.js";
import { needsStatusWrite } from "./manifest.js";
import { normalise } from "./normalise.js";
import { fetchOsm, type OsmConfig } from "./sources/osm.js";
import type { RawRecord, SeededRecord } from "./seeded.js";

/**
 * Five commands, each doing one thing.
 *
 *   fetch  -- the ONLY command that touches a network
 *   build  -- cache to proposed CSV. Pure, offline, deterministic, free
 *   diff   -- what would change, against what is committed
 *   apply  -- write it
 *   audit  -- check committed data against the rules
 *
 * `fetch` and `build` are separate so normalisation can be iterated a hundred times without
 * hitting a shelter's website once. Politeness and speed want the same thing here.
 *
 * Every command writes machine-readable JSON. An agent should never parse a log line.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
/** Between regions. Overpass is free infrastructure and this is the rent. */
const PAUSE_MS = Number(process.env["NAVCOM_SEED_PAUSE_MS"] ?? 2500);
const CONTACT = process.env["NAVCOM_SEED_CONTACT"] ?? "https://navcom.app";
const USER_AGENT = "navcom-seeder/0.1 (+" + CONTACT + ")";

interface RegionManifest {
  slug?: string;
  country?: string;
  sources?: { osm?: OsmConfig };
}

interface SourceReport {
  name: string;
  ok: boolean;
  records: number;
  ms: number;
  error?: string;
}

interface Report {
  region: string;
  command: string;
  at: string;
  sources?: SourceReport[];
  proposed?: { added: number; changed: number; unchanged: number; protected: number };
  merged?: { kept: string; dropped: string; reason: string }[];
  review?: { id: string; name: string; reason: string }[];
  /**
   * Dropped, but explicitly for the people this directory serves.
   *
   * Named individually rather than counted, because a count cannot be acted on and a name
   * can: these are the records a person can categorise in a minute and nobody can categorise
   * automatically.
   */
  uncategorised?: { name: string; serves: string; url?: string }[];
  findings?: { id: string; problem: string }[];
  /** Source categories with no home in the taxonomy. A question for a human, not an error. */
  unmapped?: { category: string; count: number }[];
}

const regionDir = (slug: string) => join(ROOT, "data", "regions", slug);
const cacheDir = (slug: string) => join(regionDir(slug), ".cache");
const reportPath = (slug: string) => join(regionDir(slug), ".seed-report.json");
const csvPath = (slug: string) => join(regionDir(slug), "resources.csv");
const proposedPath = (slug: string) => join(cacheDir(slug), "proposed.csv");
/**
 * Named services a person could categorise, **committed** rather than cached.
 *
 * The first version wrote these into the report in `.cache/`, which `.gitignore` excludes and
 * the next `build` overwrites. So a list whose entire purpose was to put six real services --
 * Union Gospel Mission and the Chief Seattle Club among them -- in front of a human, put them
 * somewhere no human would look, in a directory git is told to forget. It had already been
 * destroyed once by the time anybody noticed.
 *
 * *A mechanism nobody can reach is not built.* This is that rule's fifth instance, reproduced
 * an afternoon after it was written down.
 */
const uncategorisedPath = (slug: string) => join(regionDir(slug), "uncategorised.md");

function manifest(slug: string): RegionManifest {
  const p = join(regionDir(slug), "region.json");
  if (!existsSync(p)) throw new Error("No region at " + p);
  return JSON.parse(readFileSync(p, "utf8")) as RegionManifest;
}

let quiet = false;

function write(slug: string, report: Report): Report {
  mkdirSync(cacheDir(slug), { recursive: true });
  writeFileSync(reportPath(slug), JSON.stringify(report, null, 2) + "\n");
  // Always on disk; printed only when a person asked for one region. A sixty-five region
  // run that prints sixty-five reports has buried the summary that matters.
  if (!quiet) console.log(JSON.stringify(report, null, 2));
  return report;
}

async function cmdFetchQuiet(slug: string, only?: string, refresh = false): Promise<void> {
  quiet = true;
  try {
    await cmdFetch(slug, only, refresh);
    const report = JSON.parse(readFileSync(reportPath(slug), "utf8")) as Report;
    const broken = (report.sources ?? []).filter((s) => !s.ok);
    if (broken.length > 0) throw new Error(broken.map((b) => b.name + ": " + b.error).join("; "));
  } finally {
    quiet = false;
  }
}

function cmdBuildQuiet(slug: string): void {
  quiet = true;
  try { cmdBuild(slug); } finally { quiet = false; }
}

function cmdApplyQuiet(slug: string): void {
  quiet = true;
  try { cmdApply(slug); } finally { quiet = false; }
}

function committedRecords(slug: string) {
  return existsSync(csvPath(slug)) ? parseDirectoryOrThrow(readFileSync(csvPath(slug), "utf8")) : [];
}

/** Cached raw responses. Re-running must not re-hit anyone's server. */
function cachedRaw(slug: string): Record<string, RawRecord[]> {
  const p = join(cacheDir(slug), "raw.json");
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as Record<string, RawRecord[]>) : {};
}

/** Hours before a cached response is considered worth replacing. */
const CACHE_HOURS = Number(process.env["NAVCOM_SEED_CACHE_HOURS"] ?? 24);

function cacheIsFresh(slug: string): boolean {
  const p = join(cacheDir(slug), "raw.json");
  if (!existsSync(p)) return false;
  return Date.now() - statSync(p).mtimeMs < CACHE_HOURS * 3_600_000;
}

async function cmdFetch(slug: string, only?: string, refresh = false): Promise<void> {
  // The politest request is the one not made. A re-run over sixty-seven metros should cost
  // Overpass nothing for the ones already fetched today.
  if (!refresh && cacheIsFresh(slug)) {
    write(slug, {
      region: slug, command: "fetch", at: new Date().toISOString(),
      sources: [{ name: "cache", ok: true, records: Object.values(cachedRaw(slug)).flat().length, ms: 0 }],
    });
    return;
  }

  const region = manifest(slug);
  const raw = cachedRaw(slug);
  const sources: SourceReport[] = [];

  // Each source is independent. One returning 403 must leave the others intact and say
  // which one broke -- a run that silently produces half a region is worse than one that
  // stops, and worse still than one that says so.
  if (region.sources?.osm && (!only || only === "osm")) {
    const started = Date.now();
    try {
      const records = await fetchOsm(region.sources.osm, USER_AGENT);
      raw["osm"] = records;
      sources.push({ name: "osm", ok: true, records: records.length, ms: Date.now() - started });
    } catch (err: unknown) {
      sources.push({
        name: "osm", ok: false, records: 0, ms: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  mkdirSync(cacheDir(slug), { recursive: true });
  writeFileSync(join(cacheDir(slug), "raw.json"), JSON.stringify(raw, null, 2) + "\n");
  write(slug, { region: slug, command: "fetch", at: new Date().toISOString(), sources });
}

function cmdBuild(slug: string): Report {
  const region = manifest(slug);
  const raw = cachedRaw(slug);
  const country = region.country ?? "US";

  // Order is trust order: whichever record is seen first wins a merge.
  const flat = Object.values(raw).flat();
  const normalised: SeededRecord[] = [];
  const urls = new Map<string, string>();
  // Categories nothing could be done with. Reported by name and count, so the person who
  // owns the taxonomy can see what is being left out and decide whether to extend it.
  const unmapped = new Map<string, number>();
  /*
   * Dropped records that OSM says are for homeless people.
   *
   * A count told nobody anything: "Union Gospel Mission" and "(none): 18" are the same line
   * in a tally, and the first is one of the largest providers in its city. `social_facility:for`
   * says who a place serves; it does not say what it provides, so it can never assign a type
   * -- filing a `for=homeless` node as `shelter` is the confident wrong category this module
   * exists to refuse. What it can do is stop the record vanishing, so somebody with ten
   * minutes can look it up and say what it is.
   */
  const uncategorised: { name: string; serves: string; url?: string }[] = [];

  for (const r of flat) {
    const one = normalise(slug, r, country);
    if (!one) {
      const key = r.category ?? "(none)";
      unmapped.set(key, (unmapped.get(key) ?? 0) + 1);
      if (r.serves?.some((v) => v.includes("homeless")) && r.name) {
        uncategorised.push({
          name: r.name,
          serves: r.serves.join(", "),
          ...(r.url ? { url: r.url } : {}),
        });
      }
      continue;
    }
    normalised.push(one);
    if (r.url) urls.set(one.id, r.url);
  }

  const { records, merged } = dedupe(normalised);
  const today = new Date().toISOString().slice(0, 10);
  const result = merge(committedRecords(slug), records, today, urls, slug);

  mkdirSync(cacheDir(slug), { recursive: true });
  writeFileSync(proposedPath(slug), toCsv(result.records));
  /*
   * Whether this region's cache predates the `serves` tag.
   *
   * `social_facility:for` is what lets a dropped record be named, and a cache fetched before
   * it existed carries none -- so the region yields no candidates for a reason that has
   * nothing to do with the region. Passed through so an absent list can say which kind of
   * absence it is.
   */
  const scanned = flat.some((r) => r.serves !== undefined);
  writeUncategorised(slug, uncategorised, scanned);

  return write(slug, {
    region: slug, command: "build", at: new Date().toISOString(),
    proposed: {
      added: result.added, changed: result.changed,
      unchanged: result.unchanged, protected: result.protected,
    },
    merged, review: result.review,
    unmapped: [...unmapped.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count),
    ...(uncategorised.length > 0
      ? { uncategorised: uncategorised.sort((a, b) => a.name.localeCompare(b.name)) }
      : {}),
  });
}

/**
 * The list, as a file somebody will actually open.
 *
 * Markdown and not JSON: its reader is a person deciding where to spend an hour, not a
 * program. Names and what the source says they serve, nothing derived and nothing counted --
 * a total here would invite somebody to work the number down rather than ring the right place.
 *
 * Removed rather than left stale when a region has none, so its presence means something.
 */
function writeUncategorised(
  slug: string,
  rows: { name: string; serves: string; url?: string }[],
  scanned: boolean
): void {
  /*
   * Nothing found and never looked are different facts, and an absent file said both.
   *
   * *Volatile data shows its age. Stale reads "call first"; blank reads "unknown"* -- the
   * directory's own rule, applied to the artifact that decides where somebody spends an hour.
   * Twenty regions are in exactly this state today because Overpass rate-limited a heavy day,
   * and a contributor opening one of them would otherwise conclude it had been checked.
   */
  if (rows.length === 0 && !scanned) {
    writeFileSync(
      uncategorisedPath(slug),
      [
        "# " + slug + " has not been scanned for these",
        "",
        "This region's cached fetch predates `social_facility:for`, the tag that says who a",
        "place serves. So no candidate could be named here, and **that is not the same as there",
        "being none** — nobody has looked.",
        "",
        "`navcom-seed fetch " + slug + " && navcom-seed build " + slug + "` rewrites this file.",
        "",
      ].join("\n")
    );
    return;
  }
  if (rows.length === 0) {
    if (existsSync(uncategorisedPath(slug))) rmSync(uncategorisedPath(slug));
    return;
  }
  const lines = [
    "# Places in " + slug + " that need a person",
    "",
    "OpenStreetMap says each of these serves homeless people, and does not say **what it",
    "provides** — whether it is a bed, a meal, a shower or a desk. That is the one thing a",
    "directory row has to assert, so the seeder will not guess it and these are not published.",
    "",
    "Categorising one takes a minute and a phone call. Written by `navcom-seed build`; edit the",
    "region's `resources.csv` to publish one, and this file is rewritten on the next build.",
    "",
  ];
  for (const r of rows) {
    lines.push("- **" + r.name + "** — serves " + r.serves + (r.url ? " — <" + r.url + ">" : ""));
  }
  writeFileSync(uncategorisedPath(slug), lines.join("\n") + "\n");
}

function cmdApply(slug: string): void {
  if (!existsSync(proposedPath(slug))) throw new Error("Nothing built. Run `build` first.");
  const proposed = readFileSync(proposedPath(slug), "utf8");
  // Parsed before writing: a proposal that will not load is not written over real data.
  const records = parseDirectoryOrThrow(proposed);
  const findings = audit(records, slug);
  if (findings.length > 0) {
    write(slug, { region: slug, command: "apply", at: new Date().toISOString(), findings });
    throw new Error("Refused: " + findings.length + " audit finding(s). Nothing written.");
  }
  writeFileSync(csvPath(slug), proposed);

  // The manifest's status describes where a region's data came from, and a scrape is what
  // "seeded" means. Maintained by the tool that does the seeding, so it cannot drift from
  // the truth by somebody forgetting to edit a second file.
  const manifestPath = join(regionDir(slug), "region.json");
  const region = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  if (needsStatusWrite(region["status"])) {
    region["status"] = "seeded";
    writeFileSync(manifestPath, JSON.stringify(region, null, 2) + "\n");
  }

  write(slug, { region: slug, command: "apply", at: new Date().toISOString(), findings: [] });
}

function cmdAudit(slug: string): void {
  const findings = audit(committedRecords(slug), slug);
  write(slug, { region: slug, command: "audit", at: new Date().toISOString(), findings });
  if (findings.length > 0) process.exit(1);
}

/** Every region with a manifest, minus the scaffolding folders. */
function allRegions(): string[] {
  return readdirSync(join(ROOT, "data", "regions"))
    .filter((d) => !d.startsWith("_"))
    .filter((d) => existsSync(join(ROOT, "data", "regions", d, "region.json")))
    .sort();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Every region, one at a time, with a gap between them.
 *
 * Overpass is free infrastructure run for everybody, and sixty-five queries as fast as the
 * network allows is the behaviour that gets a project blocked and deserves to be. Sequential
 * with a pause is slower than nobody cares about and costs nothing that matters.
 *
 * A region that fails does not stop the others -- it lands in that region's own report and
 * the run continues, because one source having a bad day should not leave nineteen other
 * cities unscraped.
 */
async function everyRegion(only?: string, refresh = false): Promise<void> {
  const regions = allRegions();
  const failed: string[] = [];

  for (const [i, slug] of regions.entries()) {
    process.stderr.write("[" + (i + 1) + "/" + regions.length + "] " + slug + " ");
    try {
      await cmdFetchQuiet(slug, only, refresh);
      cmdBuildQuiet(slug);
      cmdApplyQuiet(slug);
      process.stderr.write("ok\n");
    } catch (err: unknown) {
      failed.push(slug);
      process.stderr.write("FAILED: " + (err instanceof Error ? err.message : String(err)) + "\n");
    }
    if (i < regions.length - 1) await sleep(PAUSE_MS);
  }

  console.log(JSON.stringify({
    command: "all", at: new Date().toISOString(),
    regions: regions.length, failed,
  }, null, 2));
}

async function main(): Promise<void> {
  const [command, slug, ...rest] = process.argv.slice(2);
  if (!command || !slug) {
    console.error("usage: navcom-seed <fetch|build|diff|apply|audit|calls|record> <region> [...]");
    process.exit(2);
  }
  const only = rest.find((a) => a.startsWith("--source="))?.split("=")[1];

  if (slug === "--all") {
    await everyRegion(only, rest.includes("--refresh"));
    return;
  }

  switch (command) {
    case "fetch": await cmdFetch(slug, only, rest.includes("--refresh")); break;
    // `diff` is `build` without applying -- the report IS the diff, and building twice is
    // free and deterministic, so there is nothing to gain from a separate code path.
    case "diff":
    case "build": cmdBuild(slug); break;
    case "apply": cmdApply(slug); break;
    case "audit": cmdAudit(slug); break;
    /*
     * The two halves of turning a scraped skeleton into a record somebody can act on.
     *
     * `calls` prints what to ask and who to ask; `record` writes down what they said, with the
     * provenance that decides what it is worth. Neither invents a fact — see `callsheet.ts`.
     */
    case "calls": {
      const limit = Number(rest.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 10);
      const now = new Date();
      console.log(render(slug, callsFor(csvPath(slug), now, limit), now));
      break;
    }
    case "record": cmdRecord(csvPath(slug), parseRecordArgs(slug, rest)); break;
    default:
      console.error("Unknown command: " + command);
      process.exit(2);
  }
}

main().catch((err: unknown) => {
  console.error("[seed] " + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
