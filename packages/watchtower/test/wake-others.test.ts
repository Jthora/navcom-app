/**
 * "Wake the others now" (decided 2026-10-07, option (d); `escalation.spec.md`, *Wake the others*).
 *
 * The person paged again about an operator they acknowledged had no move on that page: the executor
 * dropped an acknowledgement of the held attempt, and nothing else could be sent. Now they can ask the
 * watch to page everyone about it. **It can only widen and never closes anything** [invariant 2]: it
 * ends the hold and opens a ladder for that attempt, the operator is told who asked, and "a person has
 * it" comes only from somebody acknowledging that ladder. **Where it cannot widen, it changes nothing**:
 * the hold stands, and the person who acknowledged is still paged.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { sealSignal } from "../src/shared/crypto.js";
import { KIND_SIGNAL } from "../src/shared/kinds.js";
import {
  acknowledgedBox,
  answering,
  cleanup,
  distressFrom,
  heard,
  holdAnother,
  nowS,
  onCallEntry,
  quiet,
  signalFrom,
  workingPager,
} from "./helpers/executor.js";

afterEach(cleanup);

const real = Date.now.bind(Date);
/** The first eight hex of an operator's key, as an answer names them. */
const pk8 = (secret: Uint8Array) => getPublicKey(secret).slice(0, 8);

/** A box where Wren acknowledged, the operator sent again, and Wren was paged about that attempt. */
async function repaged(opts: Parameters<typeof acknowledgedBox>[0] = {}) {
  const raven = generateSecretKey();
  const box = await acknowledgedBox({
    roster: (wren) => [onCallEntry("Wren", wren), onCallEntry("Raven", getPublicKey(raven))],
    ...opts,
  });
  const attempt = distressFrom(box.operator, box.pubkey);
  box.deliver(attempt);
  await vi.waitFor(() => expect(box.page).toHaveBeenCalledTimes(2));
  // The repeat page carries the attempt under its own placeholder -- what the person's wake names.
  expect(box.page.mock.calls[1]![5]).toBe(attempt.id);
  return { ...box, raven, attempt };
}

describe("accepted from a roster key, about an attempt in a hold that still stands", () => {
  it("ends the hold, pages everyone but the person who asked, and tells the operator who asked", async () => {
    quiet();
    const box = await repaged();
    const wake = signalFrom(box.responder, box.address, "wake-others", { distress_id: box.attempt.id });
    box.deliver(wake);

    await vi.waitFor(() => expect(box.page).toHaveBeenCalledTimes(3));
    const [roster, , , distress, kind] = box.page.mock.calls[2]!;
    expect(roster.map((e) => e.declaration.author.callsign), "the person who asked was woken again").toEqual(["Raven"]);
    // A first page about the attempt, with its id: the roster can acknowledge the ladder it opened.
    expect([distress, kind]).toEqual([box.attempt.id, "first"]);
    expect(box.executor.ladders.get(box.attempt.id)?.state).toBe("paging");

    await vi.waitFor(() => expect(heard(box.published, box.operator, box.attempt.id).length).toBeGreaterThan(1));
    const told = heard(box.published, box.operator, box.attempt.id).at(-1)!;
    expect(told.payload.responder.kind, "a widening read as a person having it").toBe("node");
    expect(told.payload.ladder).toBe("paging");
    expect(told.payload.text).toBe("Wren asked the watch to page everyone about this one. Paging Raven.");

    // The person who asked is answered, and told who is being woken.
    await vi.waitFor(() => expect(heard(box.published, box.responder, wake.id)).toHaveLength(1));
    const [answer] = heard(box.published, box.responder, wake.id);
    expect(answer!.payload.responder.kind).toBe("node");
    expect(answer!.payload.text).toBe(`Done. The hold on ${pk8(box.operator)} has ended and the watch is paging Raven about them.`);
  });

  it("never closes anything: the operator's next attempt joins that ladder, and only acknowledging it says a person has it", async () => {
    quiet();
    const box = await repaged();
    box.deliver(signalFrom(box.responder, box.address, "wake-others", { distress_id: box.attempt.id }));
    await vi.waitFor(() => expect(box.page).toHaveBeenCalledTimes(3));

    const next = distressFrom(box.operator, box.pubkey);
    box.deliver(next);
    await vi.waitFor(() => expect(heard(box.published, box.operator, next.id)).toHaveLength(1));
    const [joined] = heard(box.published, box.operator, next.id);
    expect(joined!.payload.responder.kind, "answered from the hold the wake ended").toBe("node");
    expect(joined!.payload.text).toBe("Wren asked the watch to page everyone about this one. Paging Raven.");
    expect(box.executor.ladders.get(next.id)?.distressId).toBe(box.attempt.id);

    // The person who asked can still acknowledge it -- and that, only that, is a person having it.
    box.deliver(signalFrom(box.responder, box.address, "distress-ack", { distress_id: box.attempt.id }));
    await vi.waitFor(() => expect(box.executor.ladders.get(box.attempt.id)?.state).toBe("acknowledged"));
    const last = heard(box.published, box.operator, box.attempt.id).at(-1)!;
    expect(last.payload.responder).toMatchObject({ kind: "human", callsign: "Wren" });
  });

  it("answers with the executor's own key, and the watch key's copy, where the box has one", async () => {
    quiet();
    const box = await repaged({ ownKey: true });
    const wake = signalFrom(box.responder, box.address, "wake-others", { distress_id: box.attempt.id });
    box.deliver(wake);
    await vi.waitFor(() => expect(heard(box.published, box.responder, wake.id)).toHaveLength(2));
    const [mine, copy] = heard(box.published, box.responder, wake.id);
    expect(mine!.signer).toBe(box.executorPubkey);
    expect(copy!.signer).toBe(box.pubkey);
    expect(copy!.payload.copy_of).toBe(mine!.event.id);
    expect(mine!.payload.text).toMatch(/^Done\. /);
  });

  it("tells the person who asked when every channel then fails, as well as the operator", async () => {
    quiet();
    const box = await repaged({ page: workingPager(["Raven"]) });
    const wake = signalFrom(box.responder, box.address, "wake-others", { distress_id: box.attempt.id });
    box.deliver(wake);
    await vi.waitFor(() => expect(heard(box.published, box.responder, wake.id)).toHaveLength(2));
    const [first, after] = heard(box.published, box.responder, wake.id);
    expect(first!.payload.text).toMatch(/^Done\. /);
    // Told it was going out, so told it did not.
    expect(after!.payload.text).toBe(`Every channel failed paging Raven about ${pk8(box.operator)}. Nobody else has been woken.`);
    expect(after!.payload.responder.kind).toBe("node");
    await vi.waitFor(() =>
      expect(heard(box.published, box.operator, box.attempt.id).at(-1)!.payload.text).toBe(
        "No page could be sent -- every channel failed. Nobody has been woken.",
      ),
    );
  });

  it("widens every hold a page named, not only the one it carried, and names each operator", async () => {
    // A page names every operator the person holds who sent since their last page, and carries one id.
    // A wake from it ended the carried hold and left the others held by the person who asked alone.
    quiet();
    const raven = generateSecretKey();
    const box = await acknowledgedBox({ roster: (wren) => [onCallEntry("Wren", wren), onCallEntry("Raven", getPublicKey(raven))] });
    const a = box.operator;
    const { operator: b } = await holdAnother(box, box.responder);
    const clock = vi.spyOn(Date, "now");
    const at = (seconds: number) => clock.mockImplementation(() => real() + seconds * 1000);
    const send = async (operator: Uint8Array) => {
      const attempt = distressFrom(operator, box.pubkey);
      box.deliver(attempt);
      await vi.waitFor(() => expect(heard(box.published, operator, attempt.id).length).toBeGreaterThan(0));
      await new Promise((r) => setTimeout(r, 20));
      return attempt;
    };
    at(0);
    await send(a);
    at(10);
    await send(b);
    at(305);
    const a3 = await send(a); // held behind Wren's own interval, for her next page to name
    at(312);
    const b2 = await send(b);
    await vi.waitFor(() => expect(box.page).toHaveBeenCalledTimes(5));
    expect(box.page.mock.calls[4]![5], "the page carried B's attempt").toBe(b2.id);

    const wake = signalFrom(box.responder, box.address, "wake-others", { distress_id: b2.id });
    box.deliver(wake);
    await vi.waitFor(() => expect(box.page).toHaveBeenCalledTimes(7));
    const firsts = box.page.mock.calls.slice(5).map(([roster, , , distress, kind]) => [roster.map((e) => e.declaration.author.callsign), distress, kind]);
    expect(firsts).toHaveLength(2);
    expect(firsts).toEqual(
      expect.arrayContaining([
        [["Raven"], b2.id, "first"],
        [["Raven"], a3.id, "first"],
      ]),
    );
    await vi.waitFor(() => expect(heard(box.published, box.responder, wake.id)).toHaveLength(1));
    expect(heard(box.published, box.responder, wake.id)[0]!.payload.text).toBe(
      `Done. The hold on ${pk8(b)} has ended and the watch is paging Raven about them. ` +
        `Done. The hold on ${pk8(a)} has ended and the watch is paging Raven about them.`,
    );
    // A's next attempt joins the ladder the wake opened for it, rather than being answered from Wren's hold.
    at(320);
    const a4 = distressFrom(a, box.pubkey);
    box.deliver(a4);
    await vi.waitFor(() => expect(heard(box.published, a, a4.id).length).toBeGreaterThan(0));
    expect(heard(box.published, a, a4.id)[0]!.payload.responder.kind, "A was still held by Wren alone").toBe("node");
    expect(box.executor.ladders.get(a4.id)?.distressId).toBe(a3.id);
  });
});

describe("where it cannot widen, it changes nothing", () => {
  /** Whether anything the operator heard about these attempts said a ladder ran out: "Nobody is coming". */
  const exhausted = (box: Awaited<ReturnType<typeof repaged>>, ids: string[]) =>
    ids.some((id) => heard(box.published, box.operator, id).some((h) => h.payload.ladder === "exhausted"));

  it("when nobody else on call can be paged: the hold stands, its person is still paged, and the operator hears nothing new", async () => {
    // Before: the hold ended and a ladder opened that paged nobody. The operator's next attempts joined
    // it, the person who acknowledged them was never paged again, and the ladder ran out: "Nobody is coming".
    quiet();
    const box = await acknowledgedBox();
    const attempt = distressFrom(box.operator, box.pubkey);
    box.deliver(attempt);
    await vi.waitFor(() => expect(box.page).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(heard(box.published, box.operator, attempt.id).length).toBeGreaterThan(0));
    const toldBefore = heard(box.published, box.operator, attempt.id).length;
    const wake = signalFrom(box.responder, box.address, "wake-others", { distress_id: attempt.id });
    box.deliver(wake);

    await vi.waitFor(() => expect(heard(box.published, box.responder, wake.id)).toHaveLength(1));
    expect(heard(box.published, box.responder, wake.id)[0]!.payload.text).toBe(
      `Not done -- nobody else on call can be paged about ${pk8(box.operator)}. ` +
        "The hold stands, and you are still the one paged about them if they keep sending.",
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(heard(box.published, box.operator, attempt.id), "the operator was told something new").toHaveLength(toldBefore);
    expect(box.executor.ladders.get(attempt.id), "a ladder opened that could page nobody").toBeUndefined();

    // Past the re-page interval, the operator's next attempt is still answered from the hold, and Wren paged.
    vi.spyOn(Date, "now").mockImplementation(() => real() + 301_000);
    const next = distressFrom(box.operator, box.pubkey);
    box.deliver(next);
    await vi.waitFor(() => expect(box.page).toHaveBeenCalledTimes(3));
    expect(box.page.mock.calls[2]!.slice(3)).toEqual(["", "repeat", next.id]);
    await vi.waitFor(() => expect(heard(box.published, box.operator, next.id).length).toBeGreaterThan(0));
    expect(heard(box.published, box.operator, next.id)[0]!.payload.responder).toMatchObject({ kind: "human", callsign: "Wren" });
  });

  it("when the first-page budget is spent: the hold stands, its person is still paged, and no ladder ever runs out on them", async () => {
    const { error } = quiet();
    const box = await repaged({ over: { maxPagesPerWindow: 1 } });
    const toldBefore = heard(box.published, box.operator, box.attempt.id).length;
    const wake = signalFrom(box.responder, box.address, "wake-others", { distress_id: box.attempt.id });
    box.deliver(wake);

    await vi.waitFor(() => expect(heard(box.published, box.responder, wake.id)).toHaveLength(1));
    expect(heard(box.published, box.responder, wake.id)[0]!.payload.text).toBe(
      `Not done -- too many alerts at once, so the watch could not page anyone else about ${pk8(box.operator)}. ` +
        "The hold stands, and you are still the one paged about them if they keep sending.",
    );
    expect(error.mock.calls.flat().join("\n")).toMatch(/BUDGET SPENT -- refused by the first-page budget/);
    await new Promise((r) => setTimeout(r, 30));
    expect(box.page, "somebody was paged past the budget").toHaveBeenCalledTimes(2);
    expect(heard(box.published, box.operator, box.attempt.id)).toHaveLength(toldBefore);
    expect(box.executor.ladders.get(box.attempt.id)).toBeUndefined();

    // A paging window and more later -- long enough for any ladder to have run out -- Wren is paged again.
    vi.spyOn(Date, "now").mockImplementation(() => real() + 400_000);
    await new Promise((r) => setTimeout(r, 1_100));
    const next = distressFrom(box.operator, box.pubkey);
    box.deliver(next);
    await vi.waitFor(() => expect(box.page).toHaveBeenCalledTimes(3));
    expect(box.page.mock.calls[2]![0].map((e) => e.declaration.author.callsign)).toEqual(["Wren"]);
    expect(box.page.mock.calls[2]![4]).toBe("repeat");
    await vi.waitFor(() => expect(heard(box.published, box.operator, next.id).length).toBeGreaterThan(0));
    expect(heard(box.published, box.operator, next.id)[0]!.payload.responder.kind).toBe("human");
    expect(answering(box.published, next.id).length).toBeGreaterThan(0);
    expect(exhausted(box, [box.attempt.id, next.id]), "the operator was told nobody is coming").toBe(false);
  });

  it("when a ladder for them is already running: the attempt joins it, the hold stands behind it, and nobody is paged twice", async () => {
    quiet();
    const box = await repaged();
    // A ladder of theirs already paging the roster -- the state no other path leaves while a hold stands.
    const running = box.executor.ladders.open({
      distressId: "e".repeat(64),
      operator: getPublicKey(box.operator),
      oncall: [onCallEntry("Wren", getPublicKey(box.responder)), onCallEntry("Raven", getPublicKey(box.raven))].map((e) => e.declaration),
      hasEmergencyContact: false,
      now: nowS(),
    });
    expect(running.started).toBe(true);
    const wake = signalFrom(box.responder, box.address, "wake-others", { distress_id: box.attempt.id });
    box.deliver(wake);

    await vi.waitFor(() => expect(heard(box.published, box.responder, wake.id)).toHaveLength(1));
    expect(heard(box.published, box.responder, wake.id)[0]!.payload.text).toBe(
      `A ladder for ${pk8(box.operator)} was already running. Paging Wren, Raven.`,
    );
    expect(box.executor.ladders.get(box.attempt.id)?.distressId).toBe("e".repeat(64));
    await new Promise((r) => setTimeout(r, 30));
    expect(box.page, "the wake paged the roster again").toHaveBeenCalledTimes(2);
  });
});

describe("refused, logged, and the sender told why", () => {
  it("from a key not on the on-call roster -- and the hold stands", async () => {
    const { warn } = quiet();
    const box = await repaged();
    const stranger = generateSecretKey();
    const wake = signalFrom(stranger, box.address, "wake-others", { distress_id: box.attempt.id });
    box.deliver(wake);

    await vi.waitFor(() => expect(heard(box.published, stranger, wake.id)).toHaveLength(1));
    expect(heard(box.published, stranger, wake.id)[0]!.payload.text).toBe("Not done -- this key is not on the watch's on-call roster.");
    expect(warn.mock.calls.flat().join("\n")).toMatch(/\[wake\] REFUSED .* not on the on-call roster/);
    expect(box.page).toHaveBeenCalledTimes(2);

    const next = distressFrom(box.operator, box.pubkey);
    box.deliver(next);
    await vi.waitFor(() => expect(heard(box.published, box.operator, next.id).length).toBeGreaterThan(0));
    expect(heard(box.published, box.operator, next.id)[0]!.payload.responder.kind, "a stranger ended the hold").toBe("human");
  });

  it("about an attempt the hold never answered -- the acknowledged one included", async () => {
    const { warn } = quiet();
    const box = await repaged();
    for (const id of [box.first.id, "f".repeat(64)]) {
      const wake = signalFrom(box.responder, box.address, "wake-others", { distress_id: id });
      box.deliver(wake);
      await vi.waitFor(() => expect(heard(box.published, box.responder, wake.id)).toHaveLength(1));
      expect(heard(box.published, box.responder, wake.id)[0]!.payload.text).toBe(
        "Not done -- the watch did not answer that attempt with an earlier acknowledgement.",
      );
    }
    expect(warn.mock.calls.flat().join("\n")).toMatch(/not an attempt the watch answered from a hold/);
    expect(box.page).toHaveBeenCalledTimes(2);
    expect(box.executor.ladders.all()).toHaveLength(1);
  });

  it("once the hold has ended, saying where the watch is now", async () => {
    quiet();
    const box = await repaged();
    box.deliver(signalFrom(box.responder, box.address, "wake-others", { distress_id: box.attempt.id }));
    await vi.waitFor(() => expect(box.page).toHaveBeenCalledTimes(3));
    const again = signalFrom(box.responder, box.address, "wake-others", { distress_id: box.attempt.id });
    box.deliver(again);
    await vi.waitFor(() => expect(heard(box.published, box.responder, again.id)).toHaveLength(1));
    expect(heard(box.published, box.responder, again.id)[0]!.payload.text).toBe(
      `Not done -- the hold on ${pk8(box.operator)} had already ended. Where the watch is now: ` +
        "Wren asked the watch to page everyone about this one. Paging Raven.",
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(box.page, "one wake paged the roster twice").toHaveBeenCalledTimes(3);
  });

  it("once the hold has run its course -- a repeat page delivered late -- saying so, not that it was never held", async () => {
    // A repeat page may be held by the push service for half an hour. The attempt used to be forgotten
    // the moment its hold expired, and the person was told the watch had never answered it from a hold.
    quiet();
    const box = await repaged();
    vi.spyOn(Date, "now").mockImplementation(() => real() + 1_801_000);
    await new Promise((r) => setTimeout(r, 1_100)); // a sweep, at the later clock
    const late = signalFrom(box.responder, box.address, "wake-others", { distress_id: box.attempt.id });
    box.deliver(late);
    await vi.waitFor(() => expect(heard(box.published, box.responder, late.id)).toHaveLength(1));
    expect(heard(box.published, box.responder, late.id)[0]!.payload.text).toBe(
      `Not done -- the hold on ${pk8(box.operator)} had already ended.`,
    );
    expect(box.page).toHaveBeenCalledTimes(2);
  });

  it("signed by the watch's own key, even one listed on the roster", async () => {
    // The daemon and the agent beside it hold the watch key: a wake from it is nobody's.
    const { warn } = quiet();
    const watchSecret = generateSecretKey();
    const box = await repaged({
      watchSecret,
      roster: (wren) => [onCallEntry("Wren", wren), onCallEntry("Raven", getPublicKey(generateSecretKey())), onCallEntry("Console", getPublicKey(watchSecret))],
    });
    const wake = signalFrom(watchSecret, box.address, "wake-others", { distress_id: box.attempt.id });
    box.deliver(wake);
    await vi.waitFor(() => expect(heard(box.published, watchSecret, wake.id)).toHaveLength(1));
    expect(heard(box.published, watchSecret, wake.id)[0]!.payload.text).toBe(
      "Not done -- this is the watch's own key. Only a person on call can ask this.",
    );
    expect(warn.mock.calls.flat().join("\n")).toMatch(/\[wake\] REFUSED .* signed by the watch key, which is no person's/);
    expect(box.page).toHaveBeenCalledTimes(2);
    expect(box.executor.ladders.get(box.attempt.id)).toBeUndefined();
  });

  it("that names no attempt, or that cannot be read", async () => {
    const { warn } = quiet();
    const box = await repaged();
    const empty = signalFrom(box.responder, box.address, "wake-others", { distress_id: "not an id" });
    box.deliver(empty);
    await vi.waitFor(() => expect(heard(box.published, box.responder, empty.id)).toHaveLength(1));
    expect(heard(box.published, box.responder, empty.id)[0]!.payload.text).toBe("Not done -- it named no attempt.");

    const unreadable = finalizeEvent(
      {
        kind: KIND_SIGNAL,
        tags: [["p", box.pubkey], ["t", "wake-others"]],
        content: sealSignal(box.responder, [getPublicKey(generateSecretKey())], { distress_id: box.attempt.id }),
        created_at: nowS(),
      },
      box.responder,
    );
    box.deliver(unreadable);
    await vi.waitFor(() => expect(heard(box.published, box.responder, unreadable.id)).toHaveLength(1));
    expect(heard(box.published, box.responder, unreadable.id)[0]!.payload.text).toBe("Not done -- the watch could not read it.");
    expect(warn.mock.calls.flat().join("\n")).toMatch(/\[wake\] REFUSED .* could not be opened/);
    expect(box.page).toHaveBeenCalledTimes(2);
  });
});
