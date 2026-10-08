import { describe, expect, it } from "vitest";
import type { Drill, LogEntry } from "@navcom/core";
import { buildReview, NIGHT_SECONDS, render, REPAGED_A_NIGHT, type ReviewInput } from "../src/escalation/review.js";

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

const resent = (at: number, sent: boolean): LogEntry => ({
  at,
  actor: { kind: "node", callsign: "escalation" },
  action: "acked",
  subject: null,
  outcome: sent ? "acknowledged" : "ack-not-sent",
  hash: "0".repeat(64),
  prev: null,
});

describe("a repeat Distress answered with an earlier acknowledgement [review: D2]", () => {
  it("is listed by date, and is not a reason to look when it went out", () => {
    const review = buildReview({ ...base, entries: [escalation(NOW - 2 * day, true), resent(NOW - 2 * day + 600, true)] });
    expect(review.resent).toEqual([{ at: NOW - 2 * day + 600, sent: true }]);
    expect(review.attention).toEqual([]);
    expect(render(review).join("\n")).toMatch(/HELD[^\n]*\n {2}\d{4}-\d{2}-\d{2} {2}sent/);
  });

  it("is a reason to look when no relay took it, and says what the watch did then [#14, #25]", () => {
    const review = buildReview({ ...base, entries: [escalation(NOW - day, true), resent(NOW - day + 300, false)] });
    const page = render(review).join("\n");
    expect(page).toContain("REACHED NO RELAY");
    expect(page).toContain("NEEDS A LOOK");
    // A held answer no relay takes, on either send, ends the hold and the operator's next attempt
    // is escalated as new, so "nobody was paged" is no longer true -- and what the operator heard is
    // not something this log can see.
    const said = review.attention.join(" ");
    expect(said).toMatch(/reached no relay .*stopped holding it .*next attempt as new/);
    expect(said).not.toMatch(/nobody was paged|told nothing/);
  });
});

const repaged = (at: number, outcome: "contact-attempted" | "contact-failed" | "contact-not-attempted"): LogEntry => ({
  at,
  actor: { kind: "node", callsign: "escalation" },
  action: "contacted",
  subject: { kind: "human", callsign: "Wren", pubkey: "a".repeat(64) },
  outcome,
  hash: "0".repeat(64),
  prev: null,
});

describe("the person who acknowledged, paged again about a repeat Distress (decided 2026-10-07)", () => {
  it("is listed by date and name, and is not a reason to look when a channel took it", () => {
    const review = buildReview({ ...base, entries: [escalation(NOW - 2 * day, true), repaged(NOW - 2 * day + 600, "contact-attempted")] });
    expect(review.repaged).toEqual([{ at: NOW - 2 * day + 600, who: "Wren", pubkey: "a".repeat(64), outcome: "paged" }]);
    expect(review.attention).toEqual([]);
    expect(render(review).join("\n")).toMatch(/PAGED AGAIN[^\n]*\n {2}\d{4}-\d{2}-\d{2} {2}Wren {2}paged/);
  });

  it("is a reason to look when every channel failed, and says only what the log knows", () => {
    const review = buildReview({ ...base, entries: [repaged(NOW - day, "contact-failed")] });
    const page = render(review).join("\n");
    expect(page).toMatch(/PAGED AGAIN[^\n]*\n {2}\d{4}-\d{2}-\d{2} {2}Wren {2}EVERY CHANNEL FAILED\n/);
    expect(page).toContain("NEEDS A LOOK");
    expect(review.attention.join(" ")).toMatch(/Wren could not be paged again .*every channel failed; check their channel/);
    // An executor stopping as the page failed escalates nothing, and the entry cannot tell that
    // apart [review: hold decisions]: "escalated as new" was said of a ladder that never opened.
    expect(page).not.toMatch(/escalated/i);
  });

  it("is a reason to look when there was nothing to try, and does not claim to know why", () => {
    const review = buildReview({ ...base, entries: [repaged(NOW - day, "contact-not-attempted")] });
    const page = render(review).join("\n");
    expect(page).toMatch(/PAGED AGAIN[^\n]*\n {2}\d{4}-\d{2}-\d{2} {2}Wren {2}COULD NOT BE PAGED\n/);
    // The page budget counts first pages only now, so it is never why a re-page did not go (option E,
    // decided 2026-10-07); the per-person ceiling is.
    expect(review.attention.join(" ")).toMatch(
      /Wren could not be paged again .*off the roster, only at a console, or at their re-page ceiling; the executor.s output from then says which/,
    );
    expect(review.attention.join(" ")).not.toMatch(/budget/);
    expect(page).not.toMatch(/escalated/i);
  });

  it("ignores pages from before the window", () => {
    const review = buildReview({ ...base, entries: [repaged(NOW - 30 * day, "contact-failed")] });
    expect(review.repaged).toEqual([]);
    expect(review.attention).toEqual([]);
  });
});

describe("somebody paged again more than a night should hold (option E, decided 2026-10-07)", () => {
  /*
   * The repeated game shows up nowhere else: a phone that keeps starting its Distress again, or a
   * relay withholding the watch's answers, pages the person who acknowledged again and again, each
   * page within the rules. One operator through a whole hold is six at the most.
   */
  const pagedAt = (at: number, who = "Wren", key = "a") => ({
    ...repaged(at, "contact-attempted"),
    subject: { kind: "human" as const, callsign: who, pubkey: key.repeat(64) },
  });

  it("names them, by name and date, past REPAGED_A_NIGHT pages in twelve hours", () => {
    const start = NOW - 2 * day;
    const entries = Array.from({ length: REPAGED_A_NIGHT + 1 }, (_, i) => pagedAt(start + i * 600));
    const review = buildReview({ ...base, entries });
    expect(review.attention.join(" ")).toMatch(
      new RegExp(`Wren was paged again ${REPAGED_A_NIGHT + 1} times in one night \\(\\d{4}-\\d{2}-\\d{2}\\) -- more than one hold's worth`),
    );
    // The commonest cause is within the rules -- the first page about each operator goes at once, so a
    // person holding two who both keep sending is paged seven times in half an hour -- and it comes first.
    expect(review.attention.join(" ")).toMatch(
      /more than one hold's worth: several operators they acknowledged all still sending, a phone that keeps starting its Distress again, or a relay/,
    );
    expect(render(review).join("\n")).toContain("NEEDS A LOOK");
  });

  it("does not name one hold's worth, or the same count spread over days", () => {
    const start = NOW - 3 * day;
    const oneHold = Array.from({ length: REPAGED_A_NIGHT }, (_, i) => pagedAt(start + i * 300));
    expect(buildReview({ ...base, entries: oneHold }).attention).toEqual([]);
    // Seven pages, but never more than six inside any twelve hours.
    const spread = Array.from({ length: REPAGED_A_NIGHT + 1 }, (_, i) => pagedAt(start + i * (NIGHT_SECONDS / 4)));
    expect(buildReview({ ...base, entries: spread }).attention).toEqual([]);
  });

  it("counts each person by key, never two people sharing a callsign as one, and never a total", () => {
    const start = NOW - day;
    const entries = [
      ...Array.from({ length: 4 }, (_, i) => pagedAt(start + i * 600, "Wren", "a")),
      ...Array.from({ length: 4 }, (_, i) => pagedAt(start + i * 600 + 60, "Wren", "b")),
    ];
    expect(buildReview({ ...base, entries }).attention, "two people's pages summed into one").toEqual([]);
  });
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
