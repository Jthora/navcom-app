import { describe, expect, it } from "vitest";
import type { Drill, LogEntry } from "@navcom/core";
import { buildReview, render, type ReviewInput } from "../src/escalation/review.js";

/**
 * The reviewer's week.
 *
 * `CLAUDE.md` names the log reviewer as a role the design requires a human for — "minutes per
 * week, and it cannot be the agent or verification is theatre" — and nobody holds it. 10.b
 * defers the retrieval path until "a reviewer is named", and nobody accepts a job whose tooling
 * is ssh and a JSONL file. This is the smaller half built first, on the argument that "minutes
 * per week" is a claim the software has to make true before anybody can take the job.
 *
 * Everything worth testing is in `buildReview`, which takes plain values: no box, no log file,
 * no clock.
 */

const NOW = 1_800_000_000;
const day = 86_400;

const passingDrill: Drill = {
  at: NOW - 3 * day,
  paged: ["Wren"],
  acknowledged: [{ kind: "human", callsign: "Wren" }],
  firstAckMs: 41_000,
  result: "pass",
};

const base: ReviewInput = {
  now: NOW,
  days: 7,
  lastDrill: passingDrill,
  nextDrillAt: NOW + 4 * day,
  entries: [],
  oncall: ["Wren", "Raven"],
  log: { entries: 412, startsAt: "2026-06-04", intact: true, reason: null },
};

/* The two fields `buildReview` reads; the rest is what the chain needs to be a real entry. */
const escalation = (at: number, reachedHuman: boolean): LogEntry => ({
  at,
  actor: { kind: "node", callsign: "watchtower" },
  action: "escalated",
  subject: null,
  outcome: reachedHuman ? "escalation-reached-human" : "escalation-reached-nobody",
  hash: "0".repeat(64),
  prev: null,
});

describe("what a reviewer is shown", () => {
  it("says nothing needs a look on a good week", () => {
    const review = buildReview({ ...base, entries: [escalation(NOW - day, true)] });
    expect(review.attention).toEqual([]);
    expect(render(review).join("\n")).toContain("NOTHING NEEDS A LOOK");
  });

  it("names an escalation that reached nobody, with its date", () => {
    // The single most important thing on the page: the ladder ran and nobody came.
    const review = buildReview({ ...base, entries: [escalation(NOW - 2 * day, false)] });
    expect(review.attention.join(" ")).toMatch(/reached nobody/i);
    expect(render(review).join("\n")).toContain("REACHED NOBODY");
  });

  it("ignores escalations from before the window", () => {
    // Otherwise every week inherits every previous week's bad news and stops being readable.
    const review = buildReview({ ...base, entries: [escalation(NOW - 30 * day, false)] });
    expect(review.escalations).toEqual([]);
    expect(review.attention).toEqual([]);
  });

  it("treats a log that does not verify as the most serious thing there is", () => {
    /*
     * The reason the role exists. A chain that does not verify is a watch that cannot be held
     * to what it did, and no drill result matters more than that.
     */
    const review = buildReview({
      ...base,
      log: { entries: 412, startsAt: "2026-06-04", intact: false, reason: "entry 88 does not follow 87" },
    });
    expect(review.attention.join(" ")).toMatch(/does not verify/i);
    expect(review.attention.join(" ")).toContain("entry 88 does not follow 87");
    expect(render(review).join("\n")).toContain("CHAIN DOES NOT VERIFY");
  });

  it("says when no drill has ever run, which is not the same as one that failed", () => {
    const never = buildReview({ ...base, lastDrill: null, nextDrillAt: null });
    expect(never.attention.join(" ")).toMatch(/no drill has ever run/i);
    const failed = buildReview({ ...base, lastDrill: { ...passingDrill, result: "fail" } });
    expect(failed.attention.join(" ")).toMatch(/last drill failed/i);
  });

  it("says when a drill is overdue, where a reviewer will act on it", () => {
    // The rendered "-- overdue" marker is not enough on its own: NEEDS A LOOK is the only
    // part of this page anybody is required to read, so the item has to reach it.
    const review = buildReview({ ...base, nextDrillAt: NOW - day });
    expect(review.drillOverdue).toBe(true);
    expect(review.attention.join(" ")).toMatch(/a drill is overdue/);
    expect(render(review).join("\n")).toMatch(/overdue/i);
  });

  it("names the single-point-of-failure roster, because that is what it is", () => {
    // CLAUDE.md already calls one on-call person a known risk. The reviewer is who would
    // notice it had stayed that way.
    const one = buildReview({ ...base, oncall: ["Wren"] });
    expect(one.attention.join(" ")).toMatch(/one person deep \(Wren\)/);

    const none = buildReview({ ...base, oncall: [] });
    expect(none.attention.join(" ")).toMatch(/nobody is on call/i);
  });

  it("lists escalations rather than scoring anybody", () => {
    /*
     * "Show a count of anything" is an anti-pattern here because a number invites gaming. A
     * reviewer legitimately needs to see events, so they are listed with their dates — the
     * only figure printed is the size of a file.
     */
    const review = buildReview({
      ...base,
      entries: [escalation(NOW - 3 * day, true), escalation(NOW - day, false)],
    });
    const text = render(review).join("\n");
    expect(review.escalations).toHaveLength(2);
    expect(text).not.toMatch(/\b2 escalations\b/);
    expect(text.match(/reached/g) ?? []).toHaveLength(2);
  });
});
