/**
 * Re-pages have a limit of their own, and never take from the page budget (option E, decided
 * 2026-10-07; `escalation.spec.md`, *Re-pages have a limit of their own*).
 *
 * The page budget bounds what a stranger holding the watch's address can make it do, and only a
 * first page is open to a stranger: a re-page needs an acknowledgement from a roster key. Charged to
 * one pool, a few operators still sending through a hold spent what a new Distress needed, and a
 * flood spent what the operators somebody already had needed. So:
 *
 * - the budget counts first pages only, and a spent budget never refuses a re-page
 * - the first page about each operator a person holds goes at once
 * - after that, one page per re-page interval per person, naming every operator they hold who sent since
 * - a ceiling per person, far above all of that, catches a loop; at it the hold ends and a ladder pages everyone
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { REPAGE_CEILING } from "../src/escalation/executor.js";
import {
  acknowledgedBox,
  cleanup,
  distressFrom,
  heard,
  holdAnother,
  logged,
  onCallEntry,
  quiet,
} from "./helpers/executor.js";

afterEach(cleanup);

const real = Date.now.bind(Date);

describe("the page budget counts first pages only", () => {
  it("never refuses a re-page, and a spent budget is no reason a hold ends", async () => {
    // Before: a spent budget refused the page to the person who acknowledged, ended the hold, and
    // opened a ladder that could page nobody -- an operator somebody already had, told nobody could be woken.
    quiet();
    const box = await acknowledgedBox({ over: { maxPagesPerWindow: 1 } });
    const again = distressFrom(box.operator, box.pubkey);
    box.deliver(again);

    await vi.waitFor(() => expect(box.page).toHaveBeenCalledTimes(2));
    const [roster, , , distress, kind, attempt] = box.page.mock.calls[1]!;
    expect(roster.map((e) => e.declaration.author.callsign), "the re-page was refused by the first-page budget").toEqual(["Wren"]);
    expect([distress, kind, attempt]).toEqual(["", "repeat", again.id]);
    await vi.waitFor(() => expect(heard(box.published, box.operator, again.id).length).toBeGreaterThan(0));
    const [held] = heard(box.published, box.operator, again.id);
    expect(held!.payload.responder.kind, "the hold ended").toBe("human");
    expect(held!.payload.text).toMatch(/^Acknowledged less than a minute ago\. The watch is paging Wren again about this one\. /);
    expect(held!.payload.text).not.toMatch(/too many alerts/);
    expect(box.executor.ladders.all(), "a ladder opened").toHaveLength(1);
    await vi.waitFor(() =>
      expect(logged(box.logPath).filter((e) => e.action === "contacted").map((e) => e.outcome)).toEqual(["contact-attempted"]),
    );
  });

  it("takes nothing from it: with one unit left after the first ladder, re-pages leave it for a new Distress", async () => {
    // With a budget of one, the first ladder spends it and a stranger is refused whether or not a re-page
    // took a unit, so that case could not show a re-page draining it. Two: the first ladder takes one,
    // and the stranger is paged only if none of the re-pages took the other.
    quiet();
    const raven = getPublicKey(generateSecretKey());
    const fresh = await acknowledgedBox({
      over: { maxPagesPerWindow: 2 },
      roster: (wren) => [onCallEntry("Wren", wren), onCallEntry("Raven", raven)],
    });
    const clock = vi.spyOn(Date, "now");
    // Three re-pages about the operator Wren holds, each past the re-page interval.
    for (const [i, seconds] of [0, 301, 602].entries()) {
      clock.mockImplementation(() => real() + seconds * 1000);
      fresh.deliver(distressFrom(fresh.operator, fresh.pubkey));
      await vi.waitFor(() => expect(fresh.page).toHaveBeenCalledTimes(2 + i));
      expect(fresh.page.mock.calls[1 + i]![4]).toBe("repeat");
    }
    // A stranger's Distress after them is paged: the unit the re-pages did not touch.
    const stranger = generateSecretKey();
    const flood = distressFrom(stranger, fresh.pubkey);
    fresh.deliver(flood);
    await vi.waitFor(() => expect(fresh.page).toHaveBeenCalledTimes(5));
    const [roster, , , distress, kind] = fresh.page.mock.calls[4]!;
    expect([distress, kind], "the re-pages spent what a new Distress needed").toEqual([flood.id, "first"]);
    expect(roster.map((e) => e.declaration.author.callsign)).toEqual(["Wren", "Raven"]);
    await vi.waitFor(() => expect(heard(fresh.published, stranger, flood.id).length).toBeGreaterThan(0));
    expect(heard(fresh.published, stranger, flood.id)[0]!.payload.text).not.toMatch(/too many alerts/);
  });

  it("still bounds first pages: a new Distress past it is told nobody could be paged, and says which limit", async () => {
    const { error } = quiet();
    const box = await acknowledgedBox({ over: { maxPagesPerWindow: 1 } });
    // A re-page first, which takes nothing from the budget...
    box.deliver(distressFrom(box.operator, box.pubkey));
    await vi.waitFor(() => expect(box.page).toHaveBeenCalledTimes(2));
    // ...and a stranger's Distress after it, which the budget refuses.
    const stranger = generateSecretKey();
    const flood = distressFrom(stranger, box.pubkey);
    box.deliver(flood);
    await vi.waitFor(() => expect(heard(box.published, stranger, flood.id)).toHaveLength(1));
    expect(heard(box.published, stranger, flood.id)[0]!.payload.text).toBe(
      "The watch could not page anyone -- too many alerts at once. Nobody has been woken.",
    );
    expect(box.page).toHaveBeenCalledTimes(2);
    expect(error.mock.calls.flat().join("\n")).toMatch(/BUDGET SPENT -- refused by the first-page budget/);
  });
});

describe("one page per interval for each person, whoever it is about", () => {
  it("pages about each operator they hold at once the first time, then once per interval naming everyone who sent since", async () => {
    const { log } = quiet();
    const raven = getPublicKey(generateSecretKey());
    const box = await acknowledgedBox({ roster: (wren) => [onCallEntry("Wren", wren), onCallEntry("Raven", raven)] });
    const a = box.operator;
    const { operator: b } = await holdAnother(box, box.responder);
    expect(box.page).toHaveBeenCalledTimes(2);
    const clock = vi.spyOn(Date, "now");
    const at = (seconds: number) => clock.mockImplementation(() => real() + seconds * 1000);
    const send = async (operator: Uint8Array) => {
      const attempt = distressFrom(operator, box.pubkey);
      box.deliver(attempt);
      await vi.waitFor(() => expect(heard(box.published, operator, attempt.id).length).toBeGreaterThan(0));
      await new Promise((r) => setTimeout(r, 20));
      return attempt;
    };

    // The first page about each goes at once -- Wren is paged about B ten seconds after A.
    at(0);
    const a1 = await send(a);
    at(10);
    const b1 = await send(b);
    expect(box.page, "the first page about B waited behind the page about A").toHaveBeenCalledTimes(4);
    expect(box.page.mock.calls[2]![5]).toBe(a1.id);
    expect(box.page.mock.calls[3]![5]).toBe(b1.id);

    // Inside A's own interval: held.
    at(200);
    await send(a);
    expect(box.page).toHaveBeenCalledTimes(4);

    // A's own interval is over, but Wren was paged about B five seconds after A: held, and A is told when.
    at(305);
    const a3 = await send(a);
    expect(box.page, "paged again inside the person's own interval").toHaveBeenCalledTimes(4);
    const [held] = heard(box.published, a, a3.id);
    expect(held!.payload.text).toBe(
      "Acknowledged 5 min ago. Wren was paged again 5 min ago, and is paged again if your phone is still sending in " +
        "less than a minute. If your phone is still sending in 25 min, the watch treats it as new.",
    );
    expect(log.mock.calls.flat().join("\n")).toMatch(/the re-page interval, per person/);

    // B's next attempt, past both intervals: one page, naming B and A -- who sent since Wren's last page.
    at(312);
    const b2 = await send(b);
    await vi.waitFor(() => expect(box.page).toHaveBeenCalledTimes(5));
    const [roster, message, , distress, kind, attempt] = box.page.mock.calls[4]!;
    expect(roster.map((e) => e.declaration.author.callsign)).toEqual(["Wren"]);
    expect([distress, kind, attempt]).toEqual(["", "repeat", b2.id]);
    expect(message).toMatch(/^NavCom REPEAT -- 2 operators you acknowledged sent Distress again: /);
    expect(message).toContain(getPublicKey(b).slice(0, 8));
    expect(message).toContain(getPublicKey(a).slice(0, 8));

    // And A's next attempt is held by that page: it named A.
    at(330);
    await send(a);
    expect(box.page, "A was paged about again although the last page named them").toHaveBeenCalledTimes(5);
  });

  it("tells an operator only about their own pages, never who else the person holds", async () => {
    quiet();
    const box = await acknowledgedBox();
    const { operator: b } = await holdAnother(box, box.responder);
    const clock = vi.spyOn(Date, "now");
    clock.mockImplementation(() => real());
    box.deliver(distressFrom(box.operator, box.pubkey));
    await vi.waitFor(() => expect(box.page).toHaveBeenCalledTimes(3));
    clock.mockImplementation(() => real() + 5_000);
    box.deliver(distressFrom(b, box.pubkey));
    await vi.waitFor(() => expect(box.page).toHaveBeenCalledTimes(4));
    clock.mockImplementation(() => real() + 302_000);
    const later = distressFrom(box.operator, box.pubkey);
    box.deliver(later);
    await vi.waitFor(() => expect(heard(box.published, box.operator, later.id).length).toBeGreaterThan(0));
    const text = heard(box.published, box.operator, later.id)[0]!.payload.text ?? "";
    expect(text).not.toContain(getPublicKey(b).slice(0, 8));
    expect(text).not.toMatch(/another|someone else|other operator/i);
  });
});

describe("the ceiling, there to catch a loop", () => {
  it(`stops re-paging a person paged ${REPAGE_CEILING} times in an hour: the hold ends and a ladder pages the roster, them included`, async () => {
    const { error } = quiet();
    const raven = getPublicKey(generateSecretKey());
    const box = await acknowledgedBox({
      over: { maxPagesPerWindow: 200 },
      roster: (wren) => [onCallEntry("Wren", wren), onCallEntry("Raven", raven)],
    });
    const operators = [box.operator];
    for (let i = 1; i <= REPAGE_CEILING; i++) operators.push((await holdAnother(box, box.responder)).operator);
    const ladders = box.page.mock.calls.length;

    // The first page about each operator goes at once -- until the ceiling.
    for (const operator of operators.slice(0, REPAGE_CEILING)) {
      const attempt = distressFrom(operator, box.pubkey);
      box.deliver(attempt);
      await vi.waitFor(() => expect(heard(box.published, operator, attempt.id).length).toBeGreaterThan(0));
    }
    await vi.waitFor(() => expect(box.page).toHaveBeenCalledTimes(ladders + REPAGE_CEILING));
    expect(box.page.mock.calls.slice(ladders).every((c) => c[4] === "repeat")).toBe(true);

    const last = operators[REPAGE_CEILING]!;
    const over = distressFrom(last, box.pubkey);
    box.deliver(over);
    await vi.waitFor(() => expect(heard(box.published, last, over.id)).toHaveLength(2));
    const [held, opened] = heard(box.published, last, over.id);
    // True as it is said: the ladder pages Wren too, with a first page -- the ceiling stops the re-pages.
    expect(held!.payload.text).toBe(
      "Acknowledged less than a minute ago. Wren has been paged again as often as the watch allows in an hour, so the " +
        "watch is treating this one as new. The watch is paging Wren, Raven about this one.",
    );
    expect(opened!.payload.responder.kind).toBe("node");
    expect(opened!.payload.text).toBe(
      "Wren has been paged again as often as the watch allows in an hour, so the watch is treating this one as new. Paging Wren, Raven.",
    );
    for (const said of [held!.payload.text, opened!.payload.text]) expect(said).not.toMatch(/could not be paged/);
    await vi.waitFor(() => expect(box.page).toHaveBeenCalledTimes(ladders + REPAGE_CEILING + 1));
    const [roster, , , distress, kind] = box.page.mock.calls.at(-1)!;
    expect([distress, kind]).toEqual([over.id, "first"]);
    expect(roster.map((e) => e.declaration.author.callsign)).toEqual(["Wren", "Raven"]);
    expect(box.executor.ladders.get(over.id)?.distressId).toBe(over.id);
    expect(error.mock.calls.flat().join("\n")).toMatch(new RegExp(`REFUSED by the re-page ceiling: Wren has been paged again ${REPAGE_CEILING} times`));
    expect(logged(box.logPath).filter((e) => e.action === "contacted").at(-1)!.outcome).toBe("contact-not-attempted");
  }, 30_000);
});
