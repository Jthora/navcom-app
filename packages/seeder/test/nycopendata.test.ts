/**
 * New York City's open data, tested against what the city actually returned.
 *
 * The fixtures are recorded responses from `data.cityofnewyork.us` (2026-11-02), not hand-written
 * rows: the mojibake in one DHS address, the placeholder building number DYCD wrote for The Door,
 * and FY2025's every-site-twice are all things nobody would have thought to invent.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalise } from "../src/normalise.js";
import {
  dropInHours,
  fetchNycOpenData,
  fiscalYearAsOf,
  fromDropInCentres,
  fromYouthDropIns,
  nycRowsUrl,
  updatedOnOf,
  type SocrataRow,
} from "../src/sources/nycopendata.js";

const fixture = (name: string): SocrataRow[] =>
  JSON.parse(readFileSync(new URL("./fixtures/nycopendata/" + name, import.meta.url), "utf8")) as SocrataRow[];

const dhs = fixture("bmxf-3rd4.json");
const dycd = fixture("ebkm-iyma.json");
const meta = JSON.parse(
  readFileSync(new URL("./fixtures/nycopendata/metadata.json", import.meta.url), "utf8"),
) as Record<string, { dataUpdatedAt: string }>;

describe("DHS's drop-in centres", () => {
  const out = fromDropInCentres(dhs, updatedOnOf(meta["bmxf-3rd4"]!));

  it("files every one as a drop-in, and nothing else", () => {
    expect(out).toHaveLength(8);
    for (const r of out) expect(r.category).toBe("daytime");
    expect(out.map((r) => normalise("new-york", r)?.type)).toEqual(Array(8).fill("daytime"));
  });

  it("is dated by the city's own update, not the day it was read", () => {
    for (const r of out) expect(r.asOf).toBe("2026-10-08");
  });

  it("keys on the building, so a re-scrape reads as a diff", () => {
    const nine = out.find((r) => r.name === "9th Street Drop-In")!;
    expect(nine.sourceId).toBe("bmxf-3rd4/1026725");
    expect(new Set(out.map((r) => r.sourceId)).size).toBe(out.length);
  });

  it("gives a bare street its borough, and a semicolon its comma", () => {
    expect(out.find((r) => r.name === "9th Street Drop-In")!.address).toBe("771 9th Avenue, Manhattan, NY 10019");
    expect(out.find((r) => r.name === "Living Room")!.address).toBe("800 Barretto Street, Bronx, NY 10474");
  });

  it("repairs the no-break space DHS's file mangled", () => {
    // Arrives as "114 West 14thÂ Street": a UTF-8 no-break space read as Latin-1.
    expect(String(dhs.find((r) => r["center_name"] === "Paul Place DIC")!["address"])).toContain("Â");
    expect(out.find((r) => r.name === "Paul Place DIC")!.address).toBe("114 West 14th Street, NY 10012");
  });

  it("keeps the hours DHS states, winter clause and all", () => {
    expect(out.find((r) => r.name === "Olivieri")!.hours).toBe(
      "Open from 7:30 a.m.-8:30 p.m. This program remain open 24 hours during winter months",
    );
  });

  it("carries no phone, because the city gave none", () => {
    for (const r of out) expect(r.phone).toBeUndefined();
  });

  it("says where a person can read the same list", () => {
    for (const r of out) expect(r.url).toBe("https://data.cityofnewyork.us/d/bmxf-3rd4");
  });
});

describe("a comment is hours only when it reads as hours", () => {
  it("takes a statement of opening hours", () => {
    expect(dropInHours("Open 24 hours")).toBe("Open 24 hours");
  });

  it("refuses anything else, so an intake rule cannot arrive dressed as hours", () => {
    // `hours` is a column a scraper may fill and an intake rule is not. A comment saying who a
    // place takes, written into `hours`, would be a guessed intake rule with the lock bypassed.
    expect(dropInHours("Single adults 18 and over only")).toBeUndefined();
    expect(dropInHours("Closed for renovation; reopening Open House in May")).toBeUndefined();
    expect(dropInHours("")).toBeUndefined();
    expect(dropInHours(undefined)).toBeUndefined();
  });
});

describe("DYCD's youth drop-ins", () => {
  const out = fromYouthDropIns(dycd, updatedOnOf(meta["ebkm-iyma"]!));

  it("takes the runaway-and-homeless-youth drop-ins of the latest year, and nothing else", () => {
    // The fixture holds FY2026 and FY2025 drop-ins, a summer-jobs site and a safety council.
    expect(out).toHaveLength(8);
    for (const r of out) expect(r.category).toBe("youth");
    expect(out.map((r) => r.name)).not.toContain("1199SEIU Child Care Corporation");
    expect(out.map((r) => r.name)).not.toContain("Youth Drop-In 27 Port Richmond Avenue"); // FY2025's name
    expect(out.map((r) => normalise("new-york", r)?.type)).toEqual(Array(8).fill("youth"));
  });

  it("refuses another RHY programme even when the query let it through", () => {
    // Defence in depth. The other RHY types are residences for young people, and a residence's
    // address in a directory anybody can read is the last thing it needs.
    const residence = { ...dycd[0]!, program_type: "Transitional Independent Living (TIL)", program_site_name: "A residence", bin: "1999999" };
    expect(fromYouthDropIns([residence], "2026-09-24")).toEqual([]);
    expect(fromYouthDropIns([...dycd, residence], "2026-09-24").map((r) => r.name)).not.toContain("A residence");
  });

  it("dates a fiscal year's listing no later than the year's end", () => {
    for (const r of out) expect(r.asOf).toBe("2026-06-30");
    expect(fiscalYearAsOf("2026", "2026-09-24")).toBe("2026-06-30");
    expect(fiscalYearAsOf("2027", "2026-09-24")).toBe("2026-09-24");
  });

  it("never keys on a placeholder building number", () => {
    // DYCD wrote BIN 1000000 for The Door in FY2025. Two places sharing it would share an id.
    const door = dycd.find((r) => r["date"] === "2025" && r["bin"] === "1000000")!;
    expect(door).toBeDefined();
    const [alone] = fromYouthDropIns([door], "2026-09-24");
    expect(alone!.sourceId).toBe("ebkm-iyma/555 broome street, new york, ny 10013");
  });

  it("lists a site once when DYCD lists it once per contract, keeping the durable id", () => {
    // FY2025 has every drop-in twice, and The Door's twin is the placeholder row above.
    const fy2025 = dycd.filter((r) => r["date"] === "2025");
    expect(fy2025).toHaveLength(16);
    const out25 = fromYouthDropIns(fy2025, "2026-09-24");
    expect(out25).toHaveLength(8);
    expect(out25.filter((r) => r.address?.startsWith("555 Broome")).map((r) => r.sourceId)).toEqual(["ebkm-iyma/1083493"]);
  });

  it("writes an address a person can walk to", () => {
    expect(out.find((r) => r.name === "AFC Drop-In Center")!.address).toBe("307 West 38 Street, New York, NY 10018");
  });
});

describe("asking the city", () => {
  it("filters DYCD's 31,000 sites in the query, not after it", () => {
    const params = new URL(nycRowsUrl("ebkm-iyma")).searchParams;
    expect(params.get("$where")).toBe("program_area='RHY' AND program_type='Drop-in Centers'");
    expect(params.get("$limit")).toBe("5000");
  });

  it("refuses a data set nobody has decided the meaning of", () => {
    expect(() => nycRowsUrl("i7jb-7jku")).toThrow(/no mapping/);
  });

  it("will not date a row the city did not date", () => {
    expect(updatedOnOf({ dataUpdatedAt: "2026-10-08T13:49:12+0000" })).toBe("2026-10-08");
    expect(() => updatedOnOf({})).toThrow(/no update date/);
  });

  const respond = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

  it("asks for nothing when a region names a data set it cannot read", async () => {
    let asked = 0;
    const fake = (async () => { asked++; return respond([]); }) as typeof fetch;
    await expect(fetchNycOpenData({ datasets: ["bmxf-3rd4", "i7jb-7jku"] }, "test", fake)).rejects.toThrow(/no mapping/);
    expect(asked).toBe(0);
  });

  it("reads the date and the rows, and stamps one with the other", async () => {
    const fake = (async (url: string | URL | Request) =>
      respond(String(url).includes("/api/views/metadata/") ? meta["bmxf-3rd4"] : dhs)) as typeof fetch;
    const out = await fetchNycOpenData({ datasets: ["bmxf-3rd4"] }, "test", fake);
    expect(out).toHaveLength(8);
    expect(out.every((r) => r.asOf === "2026-10-08")).toBe(true);
  });

  it("refuses a page that came back full rather than use part of a list", async () => {
    const full = Array.from({ length: 5000 }, () => dhs[0]);
    const fake = (async (url: string | URL | Request) =>
      respond(String(url).includes("/api/views/metadata/") ? meta["bmxf-3rd4"] : full)) as typeof fetch;
    await expect(fetchNycOpenData({ datasets: ["bmxf-3rd4"] }, "test", fake)).rejects.toThrow(/cut short/);
  });
});
