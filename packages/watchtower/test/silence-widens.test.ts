/**
 * Silence widens (decided 2026-10-07; `escalation.spec.md`, *Silence widens*).
 *
 * The person who acknowledged is paged about an operator once. If that operator is still sending past
 * the re-page interval -- that operator's and the person's own -- the next attempt does not page them
 * alone again: the hold ends and the attempt is escalated as new, a ladder paging the roster, them
 * included, with a first page they can acknowledge. So a hold pages its person once, not up to six times.
 *
 * **It widens, or it changes nothing**, as a `wake-others` does. Who else would be paged and the
 * first-page budget are settled before the hold is touched; where nobody else on call can be paged or
 * the budget is spent, the person is paged again as before and the hold stands -- a widened ladder that
 * paged nobody would run out on an operator a person had acknowledged, and tell them nobody was coming.
 *
 * **Once per operator per hold window** [review: silence widens]. Each widening is a first page, so a
 * phone that never hears the box, and a person acknowledging every ladder it widened to, spent the whole
 * first-page budget in minutes; inside the window, whoever acknowledged is paged again alone instead.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { pageAll } from "../src/escalation/pager.js";
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
  signalFrom,
  workingPager,
  type Box,
} from "./helpers/executor.js";

afterEach(cleanup);

const real = Date.now.bind(Date);
const WIDENED = "Wren was paged again about you and your phone is still sending, so the watch is treating this one as new.";

/** Wren, who acknowledges, and Raven, on call beside her: somebody a hold of Wren's can widen to. */
const withRaven = (wren: string) => [onCallEntry("Wren", wren), onCallEntry("Raven", getPublicKey(generateSecretKey()))];

/** A clock this test moves, in seconds from now, and a way to send an attempt and wait to hear it answered. */
function driver(box: Box) {
  const clock = vi.spyOn(Date, "now");
  const at = (seconds: number) => clock.mockImplementation(() => real() + seconds * 1000);
  const send = async (operator: Uint8Array) => {
    const attempt = distressFrom(operator, box.pubkey);
    box.deliver(attempt);
    await vi.waitFor(() => expect(heard(box.published, operator, attempt.id).length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 20));
    return attempt;
  };
  return { at, send };
}

/** Whether anything the operator heard about these attempts said a ladder ran out: "Nobody is coming". */
const exhausted = (box: Box, operator: Uint8Array, ids: string[]) =>
  ids.some((id) => heard(box.published, operator, id).some((h) => h.payload.ladder === "exhausted"));

describe("the first attempt past the interval, after a page about that operator", () => {
  it("is escalated as new: the hold ends and a ladder pages the roster, the person who acknowledged included", async () => {
    // Before: Wren was paged alone again, every five minutes for the whole hold -- six times at the most --
    // and Raven, on call beside her, heard nothing of an operator who kept sending.
    const { log } = quiet();
    // Three units: the first ladder's, the widened one's, and one for a stranger after it -- and no more.
    const box = await acknowledgedBox({ over: { maxPagesPerWindow: 3 }, roster: withRaven });
    const { at, send } = driver(box);
    at(0);
    await send(box.operator);
    await vi.waitFor(() => expect(box.page).toHaveBeenCalledTimes(2));
    expect(box.page.mock.calls[1]![4]).toBe("repeat");

    at(301);
    const after = await send(box.operator);
    await vi.waitFor(() => expect(box.page).toHaveBeenCalledTimes(3));
    const [roster, , , distress, kind] = box.page.mock.calls[2]!;
    expect(roster.map((e) => e.declaration.author.callsign), "Wren was paged alone again").toEqual(["Wren", "Raven"]);
    // A first page, with the attempt's id: Wren or Raven can acknowledge the ladder it opened.
    expect([distress, kind]).toEqual([after.id, "first"]);
    expect(box.executor.ladders.get(after.id)?.distressId, "no ladder of its own").toBe(after.id);
    expect(box.executor.ladders.get(after.id)?.state).toBe("paging");

    await vi.waitFor(() => expect(heard(box.published, box.operator, after.id)).toHaveLength(2));
    const [held, opened] = heard(box.published, box.operator, after.id);
    expect(held!.payload.responder).toMatchObject({ kind: "human", callsign: "Wren" });
    expect(held!.payload.text).toBe(`Acknowledged 5 min ago. ${WIDENED} The watch is paging Wren, Raven about this one.`);
    expect(opened!.payload.responder.kind, "a machine's report read as a person").toBe("node");
    expect(opened!.payload.ladder).toBe("paging");
    expect(opened!.payload.text).toBe(`${WIDENED} Paging Wren, Raven.`);
    for (const said of [held!.payload.text, opened!.payload.text]) expect(said).not.toMatch(/could not be paged/);

    // Nobody failed to be paged, so nothing says so: one page to Wren, a channel took it.
    expect(logged(box.logPath).filter((e) => e.action === "contacted").map((e) => e.outcome)).toEqual(["contact-attempted"]);
    expect(log.mock.calls.flat().join("\n")).toMatch(/\[page\] Wren is not paged again about [0-9a-f]{8} -- .*\(silence widens\)/);

    // Exactly one unit taken: a stranger after it is paged, and the next is refused.
    const stranger = generateSecretKey();
    const one = distressFrom(stranger, box.pubkey);
    box.deliver(one);
    await vi.waitFor(() => expect(box.page).toHaveBeenCalledTimes(4));
    expect(box.page.mock.calls[3]![3]).toBe(one.id);
    const another = generateSecretKey();
    const two = distressFrom(another, box.pubkey);
    box.deliver(two);
    await vi.waitFor(() => expect(heard(box.published, another, two.id)).toHaveLength(1));
    expect(heard(box.published, another, two.id)[0]!.payload.text).toMatch(/too many alerts/);
    expect(box.page).toHaveBeenCalledTimes(4);
  });

  it("is told, inside the interval, when the watch will treat it as new rather than when Wren is paged again", async () => {
    quiet();
    const box = await acknowledgedBox({ roster: withRaven });
    const { at, send } = driver(box);
    at(0);
    await send(box.operator);
    at(120);
    const inside = await send(box.operator);
    expect(heard(box.published, box.operator, inside.id)[0]!.payload.text).toBe(
      "Acknowledged 2 min ago. Wren was paged again 2 min ago. If your phone is still sending in 3 min, the watch treats it as new.",
    );
    expect(box.page, "paged again inside the interval").toHaveBeenCalledTimes(2);
  });

  it("waits for both intervals: the operator's and the person's own, whoever that last page was about", async () => {
    quiet();
    const box = await acknowledgedBox({ roster: withRaven });
    const a = box.operator;
    const { operator: b } = await holdAnother(box, box.responder);
    const { at, send } = driver(box);
    at(0);
    await send(a);
    at(10);
    await send(b); // the first page about B goes at once, five minutes before A's interval is out
    await vi.waitFor(() => expect(box.page).toHaveBeenCalledTimes(4));

    at(305);
    const early = await send(a);
    expect(heard(box.published, a, early.id)[0]!.payload.text).toBe(
      "Acknowledged 5 min ago. Wren was paged again 5 min ago. If your phone is still sending in less than a minute, the watch treats it as new.",
    );
    expect(box.executor.ladders.get(early.id), "widened inside Wren's own interval").toBeUndefined();
    expect(box.page).toHaveBeenCalledTimes(4);

    at(312);
    const after = await send(a);
    await vi.waitFor(() => expect(box.page).toHaveBeenCalledTimes(5));
    expect(box.page.mock.calls[4]!.slice(3, 5)).toEqual([after.id, "first"]);
    expect(box.executor.ladders.get(after.id)?.distressId).toBe(after.id);
  });

  it("leaves the riders standing: one page names everyone who sent since, and restarts each of their intervals", async () => {
    quiet();
    const box = await acknowledgedBox({ roster: withRaven });
    const a = box.operator;
    const { operator: c } = await holdAnother(box, box.responder);
    const { at, send } = driver(box);
    at(0);
    await send(a);
    at(200);
    await send(a); // held, for Wren's next page to name
    at(250);
    const c1 = await send(c);
    await vi.waitFor(() => expect(box.page).toHaveBeenCalledTimes(4));
    const [, message, , , kind, attempt] = box.page.mock.calls[3]!;
    expect([kind, attempt]).toEqual(["repeat", c1.id]);
    expect(message).toMatch(/^NavCom REPEAT -- 2 operators you acknowledged sent Distress again: /);
    expect(message).toContain(getPublicKey(a).slice(0, 8));
    expect(message).toContain(getPublicKey(c).slice(0, 8));

    // A's interval runs from that page now, not from the first.
    at(320);
    const held = await send(a);
    expect(box.executor.ladders.get(held.id)).toBeUndefined();
    expect(heard(box.published, a, held.id)[0]!.payload.text).toBe(
      "Acknowledged 5 min ago. Wren was paged again 1 min ago. If your phone is still sending in 4 min, the watch treats it as new.",
    );
    expect(box.page).toHaveBeenCalledTimes(4);

    at(551);
    const after = await send(a);
    await vi.waitFor(() => expect(box.page).toHaveBeenCalledTimes(5));
    expect(box.page.mock.calls[4]!.slice(3, 5)).toEqual([after.id, "first"]);
  });

  it("does not start the interval over when the same person acknowledges the ladder it opened -- and does not widen again", async () => {
    // The interval is theirs and that operator's, not the hold's: the attempt after Wren answered the
    // widened ladder is past it, so it pages at once. But a hold widens about one operator once per hold
    // window [review: silence widens]: it widened again here at once, every time Wren answered, so it is
    // Wren who is paged, alone, as where nobody else could be.
    const { warn } = quiet();
    const box = await acknowledgedBox({ roster: withRaven });
    const { at, send } = driver(box);
    at(0);
    await send(box.operator);
    at(301);
    const widened = await send(box.operator);
    await vi.waitFor(() => expect(box.page).toHaveBeenCalledTimes(3));
    expect(box.page.mock.calls[2]!.slice(3, 5)).toEqual([widened.id, "first"]);
    box.deliver(signalFrom(box.responder, box.address, "distress-ack", { distress_id: widened.id }));
    await vi.waitFor(() => expect(box.executor.ladders.get(widened.id)?.state).toBe("acknowledged"));

    at(320);
    const next = await send(box.operator);
    await vi.waitFor(() => expect(box.page).toHaveBeenCalledTimes(4));
    const [roster, , , distress, kind, attempt] = box.page.mock.calls[3]!;
    expect(roster.map((e) => e.declaration.author.callsign), "widened again: the roster paged a second time").toEqual(["Wren"]);
    expect([distress, kind, attempt]).toEqual(["", "repeat", next.id]);
    expect(box.executor.ladders.get(next.id)).toBeUndefined();
    expect(heard(box.published, box.operator, next.id)[0]!.payload.text).toBe(
      "Acknowledged less than a minute ago. The watch is paging Wren again about this one. " +
        "If your phone is still sending in 30 min, the watch treats it as new.",
    );
    expect(warn.mock.calls.flat().join("\n")).toMatch(
      /\[page\] silence widens refused -- the roster was paged about them \d+s ago, and a hold widens about one operator once in 1800s: paging Wren again about [0-9a-f]{8} instead, and the hold stands/,
    );

    // Inside the interval it is told when Wren is paged again, and when the window lets it widen.
    at(400);
    const inside = await send(box.operator);
    expect(heard(box.published, box.operator, inside.id)[0]!.payload.text).toBe(
      "Acknowledged 2 min ago. Wren was paged again 1 min ago, and is paged again if your phone is still sending in 4 min. " +
        "If your phone is still sending in 29 min, the watch treats it as new.",
    );
    // And past it, Wren again -- not the roster.
    at(621);
    const later = await send(box.operator);
    await vi.waitFor(() => expect(box.page).toHaveBeenCalledTimes(5));
    expect(box.page.mock.calls[4]!.slice(3, 6)).toEqual(["", "repeat", later.id]);
  });

  it("cannot spend the first-page budget through a phone that never hears the box and a person who acknowledges every ladder", async () => {
    // The loop [review: silence widens]: a relay refuses the executor key, or withholds answers, so the
    // operator's phone never ends its Distress; Wren acknowledges each ladder the hold widens to. Each
    // acknowledgement was a new hold, and the next attempt past Wren's interval widened again at once --
    // nineteen first pages to the whole roster in thirteen minutes, the budget of twenty spent, and a
    // stranger's genuinely new Distress after it refused: "Nobody has been woken."
    quiet();
    const times: { at: number; kind: string }[] = [];
    const working = workingPager();
    const page = vi.fn<typeof pageAll>(async (...args) => {
      times.push({ at: Math.floor(Date.now() / 1000), kind: args[4] ?? "first" });
      return working(...args);
    });
    const box = await acknowledgedBox({ page, roster: withRaven });
    const { at, send } = driver(box);
    const start = Math.floor(Date.now() / 1000);
    at(0);
    await send(box.operator);
    const widenedAt: number[] = [];
    let t = 301;
    // Short of the hold window, so every attempt is the hold's to answer.
    while (t < 1_700) {
      at(t);
      const attempt = await send(box.operator);
      const ladder = box.executor.ladders.get(attempt.id);
      if (ladder?.distressId === attempt.id && ladder.state === "paging") {
        widenedAt.push(t);
        await vi.waitFor(() => expect(page.mock.calls.some((c) => c[3] === attempt.id && c[4] === "first")).toBe(true));
        t += 15;
        at(t);
        box.deliver(signalFrom(box.responder, box.address, "distress-ack", { distress_id: attempt.id }));
        await vi.waitFor(() => expect(box.executor.ladders.get(attempt.id)?.state).toBe("acknowledged"));
      }
      t += 30;
    }
    expect(widenedAt, "the roster was paged about one operator more than once in a hold window").toEqual([301]);
    // Wren alone, never more often than once in five minutes.
    const repeats = times.filter((p) => p.kind === "repeat").map((p) => p.at - start);
    expect(repeats.length).toBeGreaterThan(3);
    for (let i = 1; i < repeats.length; i++) expect(repeats[i]! - repeats[i - 1]!).toBeGreaterThanOrEqual(300);

    // A different operator's new Distress after all that still finds the budget.
    at(t);
    const stranger = generateSecretKey();
    const s = distressFrom(stranger, box.pubkey);
    box.deliver(s);
    await vi.waitFor(() => expect(heard(box.published, stranger, s.id).length).toBeGreaterThan(0));
    expect(heard(box.published, stranger, s.id).map((h) => h.payload.text).join(" ")).not.toMatch(/too many alerts/);
    await vi.waitFor(() => expect(page.mock.calls.some((c) => c[3] === s.id && c[4] === "first")).toBe(true));
  }, 30_000);

  it("opens one ladder, and takes one unit, for two attempts in one tick", async () => {
    const { log } = quiet();
    const box = await acknowledgedBox({ over: { maxPagesPerWindow: 3 }, roster: withRaven });
    const { at, send } = driver(box);
    at(0);
    await send(box.operator);
    at(301);
    const first = distressFrom(box.operator, box.pubkey);
    const second = distressFrom(box.operator, box.pubkey);
    box.deliver(first);
    box.deliver(second);
    await vi.waitFor(() => expect(heard(box.published, box.operator, second.id)).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 30));
    expect(box.page, "two ladders paged for one operator").toHaveBeenCalledTimes(3);
    expect(box.executor.ladders.get(second.id)?.distressId, "the second attempt opened a ladder of its own").toBe(first.id);
    const [joined] = heard(box.published, box.operator, second.id);
    expect(joined!.payload.responder.kind).toBe("node");
    expect(joined!.payload.text).toBe(`${WIDENED} Paging Wren, Raven.`);
    expect(log.mock.calls.flat().filter((l) => /\(silence widens\)/.test(String(l)))).toHaveLength(1);
    // One unit left of three, for a stranger.
    const stranger = generateSecretKey();
    const flood = distressFrom(stranger, box.pubkey);
    box.deliver(flood);
    await vi.waitFor(() => expect(box.page).toHaveBeenCalledTimes(4));
    expect(box.page.mock.calls[3]![3]).toBe(flood.id);
  });
});

describe("where it cannot widen, it changes nothing", () => {
  it("with the budget spent between the page and the attempt: Wren is paged again, the hold stands, and nothing runs out", async () => {
    // The spec's first reading -- escalated as new, budget included -- opened a ladder that paged nobody
    // in a flood. The operator's later attempts joined it, Wren was never paged again, and it ran out:
    // "Nobody is coming", minutes after Wren had acknowledged them.
    const { warn } = quiet();
    const box = await acknowledgedBox({ over: { maxPagesPerWindow: 2 }, roster: withRaven });
    const { at, send } = driver(box);
    at(0);
    const a1 = await send(box.operator);
    at(120);
    const a2 = await send(box.operator);
    // While it could widen, that is what the operator is told.
    expect(heard(box.published, box.operator, a2.id)[0]!.payload.text).toBe(
      "Acknowledged 2 min ago. Wren was paged again 2 min ago. If your phone is still sending in 3 min, the watch treats it as new.",
    );

    // A stranger spends the last unit.
    at(130);
    const stranger = generateSecretKey();
    const flood = distressFrom(stranger, box.pubkey);
    box.deliver(flood);
    await vi.waitFor(() => expect(box.page).toHaveBeenCalledTimes(3));

    // Now it cannot: told when Wren is paged again, as before Silence widens.
    at(140);
    const a3 = await send(box.operator);
    expect(heard(box.published, box.operator, a3.id)[0]!.payload.text).toBe(
      "Acknowledged 2 min ago. Wren was paged again 2 min ago, and is paged again if your phone is still sending in 3 min. " +
        "If your phone is still sending in 28 min, the watch treats it as new.",
    );

    at(301);
    const a4 = await send(box.operator);
    await vi.waitFor(() => expect(box.page).toHaveBeenCalledTimes(4));
    const [roster, , , distress, kind, attempt] = box.page.mock.calls[3]!;
    expect(roster.map((e) => e.declaration.author.callsign)).toEqual(["Wren"]);
    expect([distress, kind, attempt]).toEqual(["", "repeat", a4.id]);
    expect(box.executor.ladders.get(a4.id), "a ladder opened that could page nobody").toBeUndefined();
    expect(heard(box.published, box.operator, a4.id)[0]!.payload.responder).toMatchObject({ kind: "human", callsign: "Wren" });
    expect(warn.mock.calls.flat().join("\n")).toMatch(
      /\[page\] silence widens refused -- the first-page budget is spent: paging Wren again about [0-9a-f]{8} instead, and the hold stands/,
    );

    // Long enough for any ladder to have run out, and a sweep at that clock.
    at(700);
    await new Promise((r) => setTimeout(r, 1_100));
    const a5 = await send(box.operator);
    expect(heard(box.published, box.operator, a5.id)[0]!.payload.responder.kind).toBe("human");
    expect(exhausted(box, box.operator, [a1.id, a2.id, a3.id, a4.id, a5.id]), "the operator was told nobody is coming").toBe(false);
  });

  it("with nobody else on call: Wren is paged again and the hold stands, saying so in the executor's output", async () => {
    const { warn } = quiet();
    const box = await acknowledgedBox();
    const { at, send } = driver(box);
    at(0);
    await send(box.operator);
    at(301);
    const after = await send(box.operator);
    await vi.waitFor(() => expect(box.page).toHaveBeenCalledTimes(3));
    expect(box.page.mock.calls[2]!.slice(3, 6)).toEqual(["", "repeat", after.id]);
    expect(box.executor.ladders.get(after.id)).toBeUndefined();
    expect(warn.mock.calls.flat().join("\n")).toMatch(/silence widens refused -- nobody else on call can be paged/);
  });
  it("with the rest of the roster only at a console: Wren is paged again, and nothing widens to nobody", async () => {
    // Raven is on call, but only at a console: a ladder would run no command for her. Widened, that
    // ladder's only real page is Wren's, it spends a unit of the budget, and -- with Wren asleep -- it
    // runs out on an operator Wren had acknowledged.
    const { warn } = quiet();
    const box = await acknowledgedBox({
      roster: (wren) => [onCallEntry("Wren", wren), onCallEntry("Raven", getPublicKey(generateSecretKey()), "console-open")],
    });
    const { at, send } = driver(box);
    at(0);
    await send(box.operator);
    at(120);
    const inside = await send(box.operator);
    expect(heard(box.published, box.operator, inside.id)[0]!.payload.text).toBe(
      "Acknowledged 2 min ago. Wren was paged again 2 min ago, and is paged again if your phone is still sending in 3 min. " +
        "If your phone is still sending in 28 min, the watch treats it as new.",
    );

    at(301);
    const after = await send(box.operator);
    await vi.waitFor(() => expect(box.page).toHaveBeenCalledTimes(3));
    const [roster, , , distress, kind, attempt] = box.page.mock.calls[2]!;
    expect(roster.map((e) => e.declaration.author.callsign)).toEqual(["Wren"]);
    expect([distress, kind, attempt]).toEqual(["", "repeat", after.id]);
    expect(box.executor.ladders.get(after.id), "widened to a roster only at a console").toBeUndefined();
    expect(warn.mock.calls.flat().join("\n")).toMatch(
      /\[page\] silence widens refused -- nobody else on call can be paged: paging Wren again about [0-9a-f]{8} instead, and the hold stands/,
    );
  });
});

describe("the ceiling comes first", () => {
  it("a person at it is escalated as new by the ceiling, never said to be paged again with the hold standing", async () => {
    // Silence widening ran before the ceiling: with nobody else on call it warned "paging Wren again ...
    // and the hold stands", and the ceiling then ended the hold -- the executor's output contradicting
    // itself on the path a reviewer reads.
    const { warn, error } = quiet();
    const box = await acknowledgedBox({ over: { maxPagesPerWindow: 200 } });
    const a = box.operator;
    const operators = [a];
    for (let i = 1; i < REPAGE_CEILING; i++) operators.push((await holdAnother(box, box.responder)).operator);
    const { at, send } = driver(box);
    at(0);
    for (const operator of operators) await send(operator);
    await vi.waitFor(() => expect(box.page.mock.calls.filter((c) => c[4] === "repeat")).toHaveLength(REPAGE_CEILING));

    at(301);
    const over = distressFrom(a, box.pubkey);
    box.deliver(over);
    await vi.waitFor(() => expect(heard(box.published, a, over.id)).toHaveLength(2));
    const [held, opened] = heard(box.published, a, over.id);
    expect(held!.payload.text).toBe(
      "Acknowledged 5 min ago. Wren has been paged again as often as the watch allows in an hour, so the watch is " +
        "treating this one as new. The watch is paging Wren about this one.",
    );
    expect(opened!.payload.text).toBe(
      "Wren has been paged again as often as the watch allows in an hour, so the watch is treating this one as new. Paging Wren.",
    );
    expect(error.mock.calls.flat().join("\n")).toMatch(/REFUSED by the re-page ceiling: Wren has been paged again/);
    expect(warn.mock.calls.flat().join("\n"), "said the hold stands, then ended it").not.toMatch(/silence widens refused/);
  }, 30_000);
});

describe("what counts as a page about them", () => {
  it("not a page every channel failed: the next attempt after its ladder is a first page again", async () => {
    // Wren's re-page fails on every channel; the hold escalates, and Wren answers that ladder. A page
    // that woke nobody holds nothing back, so her next page about this operator goes at once.
    quiet();
    const working = workingPager();
    let failed = false;
    const page = vi.fn<typeof pageAll>(async (roster, message, timeout, distress, kind, attempt) => {
      const results = await working(roster, message, timeout, distress, kind, attempt);
      if (kind !== "repeat" || failed) return results;
      failed = true;
      return results.map((r) => ({ ...r, dispatched: false, error: "exit 1" }));
    });
    const box = await acknowledgedBox({ page, roster: withRaven });
    const again = distressFrom(box.operator, box.pubkey);
    box.deliver(again);
    await vi.waitFor(() => expect(box.executor.ladders.get(again.id)?.distressId).toBe(again.id));
    box.deliver(signalFrom(box.responder, box.address, "distress-ack", { distress_id: again.id }));
    await vi.waitFor(() => expect(box.executor.ladders.get(again.id)?.state).toBe("acknowledged"));
    const pages = page.mock.calls.length;

    const next = distressFrom(box.operator, box.pubkey);
    box.deliver(next);
    await vi.waitFor(() => expect(page.mock.calls.length).toBe(pages + 1));
    expect(page.mock.calls[pages]!.slice(3, 6)).toEqual(["", "repeat", next.id]);
    await vi.waitFor(() => expect(heard(box.published, box.operator, next.id).length).toBeGreaterThan(0));
    expect(heard(box.published, box.operator, next.id)[0]!.payload.text).toBe(
      "Acknowledged less than a minute ago. The watch is paging Wren again about this one. If your phone is still sending in 5 min, the watch treats it as new.",
    );
  });

  it("not a page stamped after the clock: stepped back past it, the next attempt pages Wren again", async () => {
    quiet();
    const box = await acknowledgedBox({ roster: withRaven });
    const { at, send } = driver(box);
    at(60);
    await send(box.operator);
    at(20);
    const after = await send(box.operator);
    await vi.waitFor(() => expect(box.page).toHaveBeenCalledTimes(3));
    expect(box.page.mock.calls[2]!.slice(3, 6)).toEqual(["", "repeat", after.id]);
    expect(box.executor.ladders.get(after.id), "widened on a page that stands for nothing").toBeUndefined();
    expect(heard(box.published, box.operator, after.id)[0]!.payload.text).toBe(
      "Acknowledged less than a minute ago. The watch is paging Wren again about this one. If your phone is still sending in 5 min, the watch treats it as new.",
    );
  });
});
