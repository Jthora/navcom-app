/**
 * The seeder, tested where it would do harm.
 *
 * Two failures here are not bugs, they are somebody walking two miles at 11pm: an intake
 * rule guessed from a website, and a human-verified record quietly overwritten by a scrape.
 * Most of what follows is about those two.
 */

import { describe, expect, it } from "vitest";
import type { ResourceRecord } from "@navcom/core";
import { audit } from "../src/audit.js";
import { dedupe, metresApart, nameKey } from "../src/dedupe.js";
import { COLUMNS, toCsv } from "../src/emit.js";
import { isHumanVerified, merge } from "../src/merge.js";
import { mapType, normalise, normalisePhone, seededId } from "../src/normalise.js";
import { parseRecordArgs } from "../src/record.js";
import { RESOURCE_TYPES } from "@navcom/core";
import type { RawRecord, SeededRecord } from "../src/seeded.js";
import { fromOverpass, overpassQuery , parseStatus, waitForSlot } from "../src/sources/osm.js";
import { needsStatusWrite } from "../src/manifest.js";

const raw = (over: Partial<RawRecord> = {}): RawRecord => ({
  source: "osm", sourceId: "node/123", name: "Hope House", ...over,
});

const seeded = (over: Partial<SeededRecord> = {}): SeededRecord => ({
  id: "st-louis-osm-aaaa", name: "Hope House", type: "shelter", ...over,
});

const committed = (over: Partial<ResourceRecord> = {}): ResourceRecord => ({
  id: "x", name: "X", type: "shelter", flag: "ok", ...over,
});

describe("ids survive a re-scrape", () => {
  it("is the same for the same source record, every time", () => {
    expect(seededId("st-louis", raw())).toBe(seededId("st-louis", raw()));
  });

  it("does not change when anything except the source id changes", () => {
    // A renamed shelter must stay the same record. If ids moved with names, every rename
    // would read as a deletion plus a creation and the diff would be unreadable.
    const before = seededId("st-louis", raw());
    expect(seededId("st-louis", raw({ name: "Hope House Emergency Shelter" }))).toBe(before);
  });

  it("differs by region and by source", () => {
    expect(seededId("kc", raw())).not.toBe(seededId("st-louis", raw()));
    expect(seededId("st-louis", raw({ source: "hud" }))).not.toBe(seededId("st-louis", raw()));
  });
});

describe("types fail toward `other`", () => {
  it("maps what it recognises", () => {
    expect(mapType("homeless_shelter")).toBe("shelter");
    expect(mapType("Warming Center")).toBe("warming");
    expect(mapType("needle exchange")).toBe("harm_reduction");
  });

  it("returns nothing rather than guessing, and the record is then not shipped", () => {
    // There is no catch-all type and adding one is a human decision -- extending the
    // taxonomy needs local knowledge. "Somewhere that helps, uncharacterised" is not
    // something an operator can act on at 11pm.
    for (const unknown of ["community hub", "resource", "", undefined, "misc"]) {
      expect(mapType(unknown), String(unknown)).toBeUndefined();
    }
  });

  it("only ever returns a type the directory actually has", () => {
    // An earlier version cast an invented "other" past the compiler and the data validator
    // caught it on the first real run. This is the check that catches it sooner.
    const every = ["shelter", "soup_kitchen", "clinic", "warming", "nonsense", undefined];
    for (const c of every) {
      const t = mapType(c);
      if (t !== undefined) expect(RESOURCE_TYPES, String(c)).toContain(t);
    }
  });
});

describe("phone numbers dial on the first tap", () => {
  it("normalises the shapes a US source actually produces", () => {
    for (const n of ["314-802-0700", "(314) 802-0700", "314.802.0700", "1-314-802-0700"]) {
      expect(normalisePhone(n), n).toBe("+13148020700");
    }
  });

  it("ignores an extension rather than counting its digits", () => {
    expect(normalisePhone("314-802-0700 ext 23")).toBe("+13148020700");
    expect(normalisePhone("314-802-0700 x23")).toBe("+13148020700");
  });

  it("returns nothing rather than a number it is not sure about", () => {
    // An absent phone renders as unknown, which is true. A wrong one is a failed call at
    // 11pm, and nothing on the surface would show it was wrong.
    for (const n of ["call the office", "555-0100", "", undefined, "0700"]) {
      expect(normalisePhone(n), String(n)).toBeUndefined();
    }
  });

  it("keeps an explicit international number as given", () => {
    expect(normalisePhone("+44 20 7946 0958")).toBe("+442079460958");
    expect(normalisePhone("0044 20 7946 0958")).toBe("+442079460958");
  });

  it("reads a domestic number in the country it was written in", () => {
    // The US is the odd one out: no trunk prefix. Most of the world writes a leading 0 and
    // drops it when dialling in, and a US-only rule silently dropped every one of them.
    expect(normalisePhone("020 7946 0958", "GB")).toBe("+442079460958");
    expect(normalisePhone("(02) 9374 4000", "AU")).toBe("+61293744000");
    expect(normalisePhone("03-1234-5678", "JP")).toBe("+81312345678");
    expect(normalisePhone("011 2345 6789", "IN")).toBe("+911123456789");
  });

  it("reads a number written with its country code but no plus", () => {
    expect(normalisePhone("44 20 7946 0958", "GB")).toBe("+442079460958");
    expect(normalisePhone("1 314 802 0700", "US")).toBe("+13148020700");
  });

  it("refuses to guess a dialling plan it does not have", () => {
    // An unlisted country is not a failure, it is one where only explicitly international
    // numbers are taken. Guessing produces a number that rings somewhere else entirely.
    expect(normalisePhone("0912 345 678", "PG")).toBeUndefined();
    expect(normalisePhone("+675 321 1234", "PG")).toBe("+6753211234");
  });
});

describe("normalising", () => {
  it("produces only fields a scraper is allowed to produce", () => {
    const out = normalise("st-louis", raw({
      category: "soup_kitchen", address: "  800 N Tucker  Blvd ",
      lat: 38.6, lon: -90.2, phone: "314-802-0700", hours: "Mon-Fri 08:00-16:00",
    }))!;
    expect(Object.keys(out).sort()).toEqual(
      ["address", "hours", "id", "lat", "lon", "name", "phone", "type"].sort(),
    );
  });

  it("drops a record it cannot characterise, rather than inventing a category", () => {
    expect(normalise("st-louis", raw({ category: "community hub" }))).toBeNull();
    expect(normalise("st-louis", raw({}))).toBeNull();
  });

  it("drops fields it cannot read instead of emitting empty ones", () => {
    const out = normalise("st-louis", raw({ category: "shelter", address: "   ", phone: "n/a", lat: Number.NaN }))!;
    expect(out.address).toBeUndefined();
    expect(out.phone).toBeUndefined();
    expect(out.lat).toBeUndefined();
  });

  it("drops a record with no name rather than throwing (found in robustness audit)", () => {
    // This function's own contract, stated one line above its signature, is "null when the
    // record cannot be characterised -- the caller drops it and reports why." A throw here
    // used to mean one bad record from a future second source could kill the whole region's
    // build instead of being tallied and skipped like every other unusable record in this
    // file (mapType() already honoured the contract; this did not).
    expect(normalise("st-louis", raw({ name: "  ", category: "shelter" }))).toBeNull();
  });
});

describe("deduplication keeps both when unsure", () => {
  it("merges an exact phone match", () => {
    const r = dedupe([
      seeded({ id: "a", phone: "+13148020700" }),
      seeded({ id: "b", name: "Hope Hse", phone: "+13148020700" }),
    ]);
    expect(r.records).toHaveLength(1);
    expect(r.merged[0]?.reason).toBe("phone");
  });

  it("merges the same name at the same place", () => {
    const r = dedupe([
      seeded({ id: "a", lat: 38.6270, lon: -90.1994 }),
      seeded({ id: "b", name: "Hope House Center", lat: 38.6271, lon: -90.1995 }),
    ]);
    expect(r.records).toHaveLength(1);
    expect(r.merged[0]?.reason).toBe("name-and-place");
  });

  it("keeps two branches of one charity apart", () => {
    // The failure this is here to prevent: one address welded to the other's phone number,
    // and nothing about the result looks wrong afterwards.
    const r = dedupe([
      seeded({ id: "a", lat: 38.6270, lon: -90.1994 }),
      seeded({ id: "b", lat: 38.7100, lon: -90.3300 }),
    ]);
    expect(r.records).toHaveLength(2);
  });

  it("keeps same-named records when it cannot tell where they are", () => {
    const r = dedupe([seeded({ id: "a" }), seeded({ id: "b" })]);
    expect(r.records).toHaveLength(2);
  });

  it("fills gaps but never overwrites", () => {
    // Merging may only ever ADD facts. Substituting one source's answer for another's is
    // how a record ends up internally inconsistent with nothing to show for it.
    const r = dedupe([
      seeded({ id: "a", phone: "+13148020700", address: "800 N Tucker" }),
      seeded({ id: "b", phone: "+13148020700", address: "999 Elsewhere", hours: "24/7" }),
    ]);
    expect(r.records[0]?.address).toBe("800 N Tucker");
    expect(r.records[0]?.hours).toBe("24/7");
  });

  it("measures distance sanely", () => {
    expect(metresApart({ lat: 38.627, lon: -90.199 }, { lat: 38.627, lon: -90.199 })).toBe(0);
    const km = metresApart({ lat: 38.627, lon: -90.199 }, { lat: 38.636, lon: -90.199 });
    expect(km).toBeGreaterThan(900);
    expect(km).toBeLessThan(1100);
  });

  it("does not blow up crossing the antimeridian (found in robustness audit)", () => {
    // A raw longitude difference here used to compute two points 0.2 degrees apart, on
    // opposite sides of +/-180, as roughly the earth's circumference apart instead of
    // ~22km. Latent today -- no current region is near the dateline -- cheap to close.
    const km = metresApart({ lat: 0, lon: 179.9 }, { lat: 0, lon: -179.9 });
    expect(km).toBeGreaterThan(20_000);
    expect(km).toBeLessThan(25_000);
  });

  it("ignores the words that appear in half of all charity names", () => {
    expect(nameKey("The Hope House Center, Inc.")).toBe(nameKey("Hope House"));
  });
});

describe("the scraper owns only what it made", () => {
  // Found by running it for real. The merge originally replaced every `method: website` row,
  // on the reasoning that those were previous scrape output. They are not: `website` also
  // describes a person who read a shelter's site and typed the details in by hand, which is
  // how this project's first ten St. Louis records were made. The first real run proposed
  // deleting all ten.
  const handTyped = committed({
    id: "st-louis-st-patrick-center", name: "St. Patrick Center",
    method: "website", last_verified: "2026-08-18", verified_by: "anonymous",
  });

  it("protects a row a person typed in, even though its method is website", () => {
    const out = merge([handTyped], [], "2026-08-19", new Map(), "st-louis");
    expect(out.records).toHaveLength(1);
    expect(out.protected).toBe(1);
  });

  it("replaces a row it made itself", () => {
    const mine = committed({
      id: "st-louis-osm-4a1c9f22", name: "Old Name", method: "website",
      last_verified: "2026-08-01",
    });
    const out = merge([mine], [], "2026-08-19", new Map(), "st-louis");
    expect(out.records).toHaveLength(0);
  });
});

describe("human rows are sacred", () => {
  const human = committed({
    id: "human-1", name: "Bridge Outreach", phone: "+13145550100",
    pets: "yes", sobriety: "no_questions", method: "in_person", verified_by: "Wren",
    last_verified: "2026-08-01",
  });

  it("passes them through untouched, always", () => {
    const out = merge([human], [seeded({ id: "s1", name: "Somewhere Else" })], "2026-08-19");
    const kept = out.records.find((r) => r.id === "human-1");
    expect(kept).toEqual(human);
    expect(out.protected).toBe(1);
  });

  it("never adds a second copy of a place a human already checked", () => {
    const out = merge(
      [human],
      [seeded({ id: "s1", name: "Bridge Outreach", phone: "+13145550100" })],
      "2026-08-19",
    );
    expect(out.records).toHaveLength(1);
    expect(out.records[0]?.verified_by).toBe("Wren");
  });

  it("reports a disagreement instead of correcting the human", () => {
    const out = merge(
      [human],
      [seeded({ id: "s1", name: "Bridge Outreach", phone: "+13145550100", address: "12 New St" })],
      "2026-08-19",
    );
    expect(out.review.map((r) => r.reason).join(" ")).toMatch(/different address: 12 New St/);
    expect(out.records[0]?.address).toBeUndefined();
  });

  it("keeps a human record public sources no longer list, and asks about it", () => {
    // A shelter missing from a listing site has not necessarily closed, and the person who
    // went there knew something the scraper does not.
    const out = merge([human], [], "2026-08-19");
    expect(out.records).toHaveLength(1);
    expect(out.review.map((r) => r.reason).join(" ")).toMatch(/no longer found in public sources/);
  });
});

describe("what a scrape writes", () => {
  it("stamps provenance that renders as unverified, with no way to opt out", () => {
    const out = merge([], [seeded()], "2026-08-19");
    const r = out.records[0]!;
    expect(r.method).toBe("website");
    expect(r.verified_by).toBe("");
    expect(r.last_verified).toBe("2026-08-19");
  });

  it("counts added, changed and unchanged so a diff is explainable", () => {
    // Scraper-shaped ids, and the region passed -- otherwise these are rows somebody else
    // made, and the merge is right to leave them alone.
    const a = "st-louis-osm-11111111";
    const b = "st-louis-osm-22222222";
    const first = merge([], [seeded({ id: a }), seeded({ id: b, name: "Second" })], "2026-08-19", new Map(), "st-louis");
    expect(first.added).toBe(2);

    const second = merge(
      first.records,
      [seeded({ id: a, phone: "+13148020700" }), seeded({ id: b, name: "Second" })],
      "2026-08-20", new Map(), "st-louis",
    );
    expect(second.changed).toBe(1);
    expect(second.unchanged).toBe(1);
    expect(second.added).toBe(0);
  });

  it("says when a source quietly stopped returning records", () => {
    const first = merge([], [seeded({ id: "st-louis-osm-33333333" })], "2026-08-19", new Map(), "st-louis");
    const second = merge(first.records, [], "2026-08-20", new Map(), "st-louis");
    expect(second.review.map((r) => r.reason).join(" ")).toMatch(/no longer in public sources/);
  });

  it("knows a human row from a seeded one", () => {
    expect(isHumanVerified(committed({ method: "in_person" }))).toBe(true);
    expect(isHumanVerified(committed({ method: "phone" }))).toBe(true);
    expect(isHumanVerified(committed({ method: "website" }))).toBe(false);
    expect(isHumanVerified(committed())).toBe(false);
  });
});

describe("the audit", () => {
  it("passes clean seeded data", () => {
    const out = merge([], [seeded()], "2026-08-19");
    expect(audit(out.records)).toEqual([]);
  });

  it("catches an intake rule on a seeded row", () => {
    // The whole point. SeededRecord makes this unreachable in the pipeline; this catches it
    // arriving from a hand-edited CSV or a cast around the type.
    const bad = committed({ id: "s1", method: "website", last_verified: "2026-08-19", pets: "yes" });
    expect(audit([bad]).map((f) => f.problem).join(" ")).toMatch(/intake rule set: pets=yes/);
  });

  it("catches every intake column, not just the memorable ones", () => {
    const bad = committed({
      id: "s1", method: "website", last_verified: "2026-08-19",
      sobriety: "sober_required", id_required: "yes", curfew: "22:00",
      referral_required: true, capacity_signal: "often_full",
    });
    expect(audit([bad])).toHaveLength(5);
  });

  it("catches a scraper claiming to have verified something", () => {
    const bad = committed({
      id: "st-louis-osm-4a1c9f22", method: "website",
      last_verified: "2026-08-19", verified_by: "Wren",
    });
    expect(audit([bad], "st-louis").map((f) => f.problem).join(" ")).toMatch(/verifies nothing/);
  });

  it("lets a person who typed a row from a website sign it", () => {
    // The first real run refused to write because ten hand-typed records carried
    // verified_by=anonymous. They are not scraper output and "anonymous" is a real author.
    const typed = committed({
      id: "st-louis-st-patrick-center", method: "website",
      last_verified: "2026-08-18", verified_by: "anonymous",
    });
    expect(audit([typed], "st-louis")).toEqual([]);
  });

  it("still refuses an intake rule on a hand-typed website row", () => {
    // Reading a shelter's website is not local knowledge, whoever did the reading.
    const typed = committed({
      id: "st-louis-st-patrick-center", method: "website",
      last_verified: "2026-08-18", verified_by: "anonymous", pets: "yes",
    });
    expect(audit([typed], "st-louis").map((f) => f.problem).join(" ")).toMatch(/intake rule set/);
  });

  it("leaves human rows alone -- intake rules are exactly what they are for", () => {
    const good = committed({
      id: "h1", method: "in_person", verified_by: "Wren", last_verified: "2026-08-01",
      pets: "yes", sobriety: "no_questions", curfew: "22:00",
    });
    expect(audit([good])).toEqual([]);
  });

  it("catches a duplicate id", () => {
    const rows = [committed({ id: "same", method: "in_person" }), committed({ id: "same", method: "in_person" })];
    expect(audit(rows).map((f) => f.problem)).toContain("duplicate id");
  });
});

describe("what OpenStreetMap is asked for", () => {
  // Both of these were in the query and both were removed after seeing the real output.
  // Asserted so re-adding them is a decision somebody makes on purpose.
  const query = overpassQuery([-90.42, 38.48, -90.10, 38.78]);

  it("asks for social facilities, which describe a service", () => {
    expect(query).toContain("social_facility");
    expect(query).toContain("food_bank");
  });

  it("does not ask for generic healthcare", () => {
    // Returned a medical school, a cancer centre, four private urgent-care franchises, two
    // travel clinics, five home-health agencies and a medspa. The Medic wants the nearest ER
    // that will not call police, and no generic healthcare tag can distinguish that.
    expect(query).not.toContain("healthcare");
    expect(query).not.toContain("clinic");
    expect(query).not.toContain("doctors");
  });

  it("does not ask for amenity=shelter", () => {
    // In OSM that means a structure keeping rain off. It returned "Tornado Shelter",
    // "Duck Shelter" and "Bowl Lake Pavilion" as emergency accommodation. A wasted journey
    // is bad; a park pavilion is somebody walking there at midnight in February.
    expect(query).not.toMatch(/"amenity"="shelter"/);
  });

  it("keeps a name-less node out, because nobody can be sent to one", () => {
    const out = fromOverpass({
      elements: [
        { type: "node", id: 1, lat: 38.6, lon: -90.2, tags: { social_facility: "shelter" } },
        { type: "node", id: 2, lat: 38.6, lon: -90.2, tags: { social_facility: "shelter", name: "Real Place" } },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.name).toBe("Real Place");
  });

  it("distinguishes a node from a way with the same number", () => {
    const out = fromOverpass({
      elements: [
        { type: "node", id: 7, tags: { name: "A", social_facility: "shelter" } },
        { type: "way", id: 7, tags: { name: "B", social_facility: "shelter" } },
      ],
    });
    expect(out[0]?.sourceId).not.toBe(out[1]?.sourceId);
  });

  it("reads a centroid for a way, which has no lat/lon of its own", () => {
    const out = fromOverpass({
      elements: [{ type: "way", id: 9, center: { lat: 38.64, lon: -90.21 }, tags: { name: "W", social_facility: "shelter" } }],
    });
    expect(out[0]?.lat).toBe(38.64);
  });
});

describe("the CSV", () => {
  it("keeps the committed column order, so a diff is about data", () => {
    expect(toCsv([]).trim()).toBe(COLUMNS.join(","));
  });

  it("leaves every intake column empty on a seeded row", () => {
    const out = merge([], [seeded({ address: "800 N Tucker", phone: "+13148020700" })], "2026-08-19");
    const [, row] = toCsv(out.records).trim().split("\n");
    const cells = row!.split(",");
    for (const column of ["pets", "sobriety", "id_required", "curfew", "capacity_signal"]) {
      expect(cells[COLUMNS.indexOf(column as never)], column).toBe("");
    }
  });

  it("quotes what needs quoting and escapes what needs escaping", () => {
    const rows = toCsv([committed({ id: "a", name: 'The "Big" House, Inc.', notes: "line\nbreak" })]);
    expect(rows).toContain('"The ""Big"" House, Inc."');
    expect(rows).toContain('"line\nbreak"');
  });
});

describe("recording a call (found in robustness audit: --on had no coverage at all)", () => {
  const args = ["place-a", "--by", "Wren", "--method", "phone", "--on", "2026-08-19", "--pets", "yes"];

  it("accepts a well-formed call", () => {
    const parsed = parseRecordArgs("st-louis", args);
    expect(parsed.on).toBe("2026-08-19");
    expect(parsed.fields.pets).toBe("yes");
  });

  it("refuses a calendar-invalid date rather than writing it straight to committed data", () => {
    // The same bug class as the other three isValidIsoDate call sites, missed here because
    // this file is outside area 3's scope: a shape-only regex let "2023-02-30" through,
    // wrote it into the CSV, and only failed later -- at the next build/apply on the
    // region, or a full site build -- days after a volunteer mistyped it on a call.
    const bad = ["place-a", "--by", "Wren", "--method", "phone", "--on", "2023-02-30", "--pets", "yes"];
    expect(() => parseRecordArgs("st-louis", bad)).toThrow(/real YYYY-MM-DD date/);
  });

  it("refuses a shape-invalid date too", () => {
    const bad = ["place-a", "--by", "Wren", "--method", "phone", "--on", "08/19/2026", "--pets", "yes"];
    expect(() => parseRecordArgs("st-louis", bad)).toThrow(/real YYYY-MM-DD date/);
  });

  it("defaults --on to today when omitted, and today is always valid", () => {
    const noOn = ["place-a", "--by", "Wren", "--method", "phone", "--pets", "yes"];
    expect(() => parseRecordArgs("st-louis", noOn)).not.toThrow();
  });
});

describe("asking Overpass before knocking", () => {
  /*
   * A run over sixty-seven metros lost thirty-one of them to dropped connections once, and
   * fifty-eight to the same thing again: nine regions succeeded and then Overpass stopped
   * accepting connections at all. The retry ladder was blind — 4s, 8s, 16s — while the service
   * publishes exactly when a slot frees to anybody who asks.
   */
  it("reads a free slot", () => {
    const status = parseStatus(
      ["Connected as: 3086356085", "Current time: 2026-09-02T11:00:00Z", "Rate limit: 2", "2 slots available now."].join("\n"),
    );
    expect(status).toEqual({ slots: 2, waitSeconds: 0 });
  });

  it("takes the soonest slot when none is free", () => {
    const status = parseStatus(
      [
        "Rate limit: 2",
        "Slot available after: 2026-09-02T11:00:20Z, in 20 seconds.",
        "Slot available after: 2026-09-02T11:00:14Z, in 14 seconds.",
      ].join("\n"),
    );
    expect(status).toEqual({ slots: 0, waitSeconds: 14 });
  });

  it("ignores a slot that freed while the page was being written", () => {
    // Negative seconds appear when the server renders one moment and we read the next.
    const status = parseStatus("Slot available after: 2026-09-02T10:59:59Z, in -3 seconds.");
    expect(status.waitSeconds).toBe(0);
  });

  it("waits the time it was told, and no longer than the cap", async () => {
    const slept: number[] = [];
    await waitForSlot("ua", {
      fetchImpl: (async () => ({ ok: true, text: async () => "Slot available after: x, in 30 seconds." })) as never,
      sleepImpl: async (ms: number) => void slept.push(ms),
    });
    expect(slept).toEqual([30_000]);

    slept.length = 0;
    await waitForSlot("ua", {
      capSeconds: 5,
      fetchImpl: (async () => ({ ok: true, text: async () => "Slot available after: x, in 3600 seconds." })) as never,
      sleepImpl: async (ms: number) => void slept.push(ms),
    });
    expect(slept, "an hour-long wait would stall the whole run").toEqual([5_000]);
  });

  it("fails open when the status endpoint is the thing that is down", async () => {
    /*
     * The assertion that keeps this from being a new failure mode. A politeness check that
     * throws is worse than no check: it turns a service having a bad day into a run that
     * cannot start, and the retry ladder below already covers the real failure.
     */
    const slept: number[] = [];
    const out = await waitForSlot("ua", {
      fetchImpl: (async () => {
        throw new Error("fetch failed");
      }) as never,
      sleepImpl: async (ms: number) => void slept.push(ms),
    });
    expect(out).toBeNull();
    expect(slept, "a dead status endpoint made the caller wait").toEqual([]);
  });

  it("and when it answers with something unparseable", async () => {
    const out = await waitForSlot("ua", {
      fetchImpl: (async () => ({ ok: true, text: async () => "<html>maintenance</html>" })) as never,
      sleepImpl: async () => undefined,
    });
    expect(out).toEqual({ slots: 0, waitSeconds: 0 });
  });
});

describe("the manifest is written only when it must be", () => {
  /*
   * `apply` rewrote region.json on every run, including for regions already marked `seeded`
   * where the value written was the value already there. A JSON round-trip is not lossless on
   * a hand-edited file: reseeding nine regions moved adelaide's bbox from `-35.0` to `-35` —
   * identical to a parser, a diff nobody asked for, in a file the tool only needed to read.
   */
  it("leaves a region that is already seeded alone", () => {
    expect(needsStatusWrite("seeded")).toBe(false);
  });

  it("and never overrides a maintainer's own claim", () => {
    expect(needsStatusWrite("maintained")).toBe(false);
  });

  it("but does record that a scrape happened when the status says otherwise", () => {
    // The reason the write exists at all: status must not drift from what the data is.
    expect(needsStatusWrite("example")).toBe(true);
    expect(needsStatusWrite(undefined)).toBe(true);
  });
});
