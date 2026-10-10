/**
 * The executor's own key (decided 2026-10-07, G3).
 *
 * The daemon holds the watch key, and the agent runs beside the daemon. A phone that ended a Distress
 * on any answer the watch key signed could be told "a person has it" by that process. So the executor
 * signs every response with a key only it holds, copies it under the watch key for phones handed the
 * watch before it named one, and opens the signals it acts on with its own key first
 * (`escalation.spec.md`, *The executor has a key of its own*).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { EscalationExecutor } from "../src/escalation/executor.js";
import { sealSignal } from "../src/shared/crypto.js";
import { KIND_SIGNAL } from "../src/shared/kinds.js";
import {
  acknowledgedBox,
  answering,
  build,
  cleanup,
  distressFrom,
  fakeConfig,
  fakePool,
  heard,
  logged,
  nowS,
  onCallEntry,
  quiet,
  signalFrom,
  workingPager,
} from "./helpers/executor.js";

afterEach(cleanup);

describe("every response, signed by the executor's own key and copied under the watch key", () => {
  it("sends a ladder's report from its own key first, then the watch key's copy naming it", async () => {
    quiet();
    const operator = generateSecretKey();
    const box = build({ ownKey: true, oncall: [onCallEntry("Wren", getPublicKey(generateSecretKey()))] });
    const distress = distressFrom(operator, box.pubkey);
    box.deliver(distress);

    await vi.waitFor(() => expect(answering(box.published, distress.id)).toHaveLength(2));
    const [mine, copy] = heard(box.published, operator, distress.id);
    expect(mine!.signer, "the report was not signed by the executor's own key").toBe(box.executorPubkey);
    expect(copy!.signer).toBe(box.pubkey);
    // Sealed by the key that signed it, so a phone opens each with its author's key, never another's.
    expect(mine!.payload.text).toBe("Paging Wren.");
    expect(mine!.payload.copy_of).toBeUndefined();
    expect(copy!.payload).toEqual({ ...mine!.payload, copy_of: mine!.event.id });
    // The same tags, so an older phone hears the copy exactly where it heard the watch before.
    expect(copy!.event.tags).toEqual(mine!.event.tags);
  });

  it("signs a person's acknowledgement with its own key: the only answer a phone handed that key ends on", async () => {
    quiet();
    const box = await acknowledgedBox({ ownKey: true });
    const said = heard(box.published, box.operator, box.first.id).filter((h) => h.payload.responder.kind === "human");
    expect(said.map((h) => h.signer)).toEqual([box.executorPubkey, box.pubkey]);
    expect(said[0]!.payload.responder.callsign).toBe("Wren");
    expect(said[1]!.payload.copy_of).toBe(said[0]!.event.id);
  });

  it("signs the hold's re-sent acknowledgement with its own key, naming both attempts in both sends", async () => {
    quiet();
    const box = await acknowledgedBox({ ownKey: true });
    const again = distressFrom(box.operator, box.pubkey);
    box.deliver(again);
    await vi.waitFor(() => expect(answering(box.published, again.id)).toHaveLength(2));
    const [mine, copy] = heard(box.published, box.operator, again.id);
    expect(mine!.signer).toBe(box.executorPubkey);
    expect(mine!.payload.responder.kind).toBe("human");
    expect(copy!.payload.copy_of).toBe(mine!.event.id);
    for (const h of [mine!, copy!]) {
      expect(h.event.tags.filter((t) => t[0] === "e").map((t) => t[1])).toEqual([again.id, box.first.id]);
    }
  });

  it("names its own key as the actor in its accountability log", async () => {
    quiet();
    const box = await acknowledgedBox({ ownKey: true });
    await vi.waitFor(() => expect(logged(box.logPath).some((e) => e.action === "escalated")).toBe(true));
    expect(logged(box.logPath).map((e) => e.actor.pubkey)).toEqual([box.executorPubkey]);
  });

  it("with no key of its own, signs every response with the watch key alone, as it always did", async () => {
    quiet();
    const operator = generateSecretKey();
    const box = build({ oncall: [onCallEntry("Wren")] });
    const distress = distressFrom(operator, box.pubkey);
    box.deliver(distress);
    await vi.waitFor(() => expect(answering(box.published, distress.id)).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 30));
    const said = heard(box.published, operator, distress.id);
    expect(said).toHaveLength(1);
    expect(said[0]!.signer).toBe(box.pubkey);
    expect(said[0]!.payload.copy_of).toBeUndefined();
  });

  it("treats the watch key handed over as its own key as no key at all", async () => {
    // A phone reads an executor key equal to the watch key as none (`executorOf`), so signing twice
    // with one key would only send every answer twice.
    quiet();
    const secretKey = generateSecretKey();
    const pubkey = getPublicKey(secretKey);
    const { pool, published, deliver } = fakePool();
    const executor = new EscalationExecutor({
      config: fakeConfig([onCallEntry("Wren")]), secretKey, pubkey, pool, page: workingPager(),
      executorKey: { secretKey, pubkey },
    });
    executor.start();
    try {
      const operator = generateSecretKey();
      const distress = distressFrom(operator, pubkey);
      deliver(distress);
      await vi.waitFor(() => expect(answering(published, distress.id)).toHaveLength(1));
      await new Promise((r) => setTimeout(r, 30));
      expect(answering(published, distress.id)).toHaveLength(1);
      expect(heard(published, operator, distress.id)[0]!.payload.copy_of).toBeUndefined();
    } finally {
      await executor.stop();
    }
  });

  it("says so when no relay takes its own key and only the watch key's copy went out", async () => {
    // A relay that limits new keys takes the copies and refuses the executor's own. A phone given the
    // executor key then hears only copies, and no Distress ends there, while the box looks healthy.
    const { error } = quiet();
    const operator = generateSecretKey();
    const box = build({ ownKey: true, oncall: [onCallEntry("Wren")] });
    box.relay.refuses = (e) => e.pubkey === box.executorPubkey;
    box.deliver(distressFrom(operator, box.pubkey));
    await vi.waitFor(() =>
      expect(error.mock.calls.flat().join("\n")).toMatch(/NO RELAY TOOK THE EXECUTOR'S OWN KEY -- only the watch key's copy went out/),
    );
    // The operator was told something -- the copy -- so this is not "could not report".
    expect(error.mock.calls.flat().join("\n")).not.toMatch(/COULD NOT REPORT/);
  });

  it("keeps a hold standing when only its own key was refused: the operator heard the copy", async () => {
    quiet();
    const box = await acknowledgedBox({ ownKey: true });
    box.relay.refuses = (e) => e.pubkey === box.executorPubkey;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const again = distressFrom(box.operator, box.pubkey);
    box.deliver(again);
    await vi.waitFor(() => expect(answering(box.published, again.id)).toHaveLength(2));
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.waitFor(() => expect(answering(box.published, again.id)).toHaveLength(4));
    vi.useRealTimers();
    const next = distressFrom(box.operator, box.pubkey);
    box.deliver(next);
    await vi.waitFor(() => expect(answering(box.published, next.id).length).toBeGreaterThan(0));
    expect(heard(box.published, box.operator, next.id)[0]!.payload.responder.kind, "the hold ended").toBe("human");
    expect(box.executor.ladders.all()).toHaveLength(1);
  });
});

describe("a relay that takes the executor's own and refuses the watch key's copy", () => {
  // Every phone handed the watch before it named the executor reads the copy and nothing else. A relay
  // with a rate limit takes the first event of the pair and refuses the second, a millisecond later.

  it("is said, and counts as the operator not told: every phone not handed the executor key heard nothing", async () => {
    const { error } = quiet();
    const operator = generateSecretKey();
    const box = build({ ownKey: true, oncall: [onCallEntry("Wren")] });
    box.relay.refuses = (e) => e.pubkey === box.pubkey;
    box.deliver(distressFrom(operator, box.pubkey));
    await vi.waitFor(() =>
      expect(error.mock.calls.flat().join("\n")).toMatch(/NO RELAY TOOK THE WATCH KEY'S COPY -- only the executor's own went out/),
    );
    expect(error.mock.calls.flat().join("\n")).toMatch(/COULD NOT REPORT paging TO OPERATOR -- no relay accepted the watch key's copy/);
  });

  it("ends a hold whose copies reached no relay, twice, so the operator's next attempt pages -- and records it unsent", async () => {
    quiet();
    const box = await acknowledgedBox({ ownKey: true, roster: (wren) => [onCallEntry("Wren", wren), onCallEntry("Raven", getPublicKey(generateSecretKey()))] });
    box.relay.refuses = (e) => e.pubkey === box.pubkey;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const again = distressFrom(box.operator, box.pubkey);
    box.deliver(again);
    await vi.waitFor(() => expect(answering(box.published, again.id)).toHaveLength(2));
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.waitFor(() => expect(answering(box.published, again.id)).toHaveLength(4));
    vi.useRealTimers();
    await vi.waitFor(() => expect(logged(box.logPath).filter((e) => e.action === "acked").map((e) => e.outcome)).toEqual(["ack-not-sent"]));

    const pagesBefore = box.page.mock.calls.length;
    const next = distressFrom(box.operator, box.pubkey);
    box.deliver(next);
    await vi.waitFor(() => expect(box.page.mock.calls.length).toBeGreaterThan(pagesBefore));
    const [roster, , , distress, kind] = box.page.mock.calls.at(-1)!;
    expect([distress, kind], "held for nobody who could read it, and the roster was not paged").toEqual([next.id, "first"]);
    expect(roster.map((e) => e.declaration.author.callsign)).toEqual(["Wren", "Raven"]);
    expect(box.executor.ladders.get(next.id)?.distressId).toBe(next.id);
  });
});

describe("the watch's own key, and the executor's, are nobody's", () => {
  it("refuses an acknowledgement signed by either, even where the roster lists it, so the executor never signs 'a person has it' for one", async () => {
    // A Stationkeeper lists the watch key to acknowledge from the box's console. The agent beside the
    // daemon holds that key: accepted, its acknowledgement had the executor sign a person's answer with
    // the one key a phone handed it trusts.
    const { warn } = quiet();
    const watchSecret = generateSecretKey();
    const operator = generateSecretKey();
    const box = build({
      ownKey: true,
      watchSecret,
      oncall: [onCallEntry("Console", getPublicKey(watchSecret)), onCallEntry("Wren", getPublicKey(generateSecretKey()))],
    });
    const distress = distressFrom(operator, box.pubkey);
    box.deliver(distress);
    await vi.waitFor(() => expect(box.page).toHaveBeenCalledTimes(1));
    box.deliver(signalFrom(watchSecret, box.address, "distress-ack", { distress_id: distress.id }));
    await vi.waitFor(() => expect(warn.mock.calls.flat().join("\n")).toMatch(/\[ack\] REFUSED .* signed by the watch key, which is no person's/));
    expect(box.executor.ladders.get(distress.id)?.state).toBe("paging");
    expect(heard(box.published, operator, distress.id).map((h) => h.payload.responder.kind)).not.toContain("human");
  });

  it("refuses one signed by the executor's own key", async () => {
    const { warn } = quiet();
    const operator = generateSecretKey();
    const box = build({ ownKey: true, oncall: [onCallEntry("Wren", getPublicKey(generateSecretKey()))] });
    const distress = distressFrom(operator, box.pubkey);
    box.deliver(distress);
    await vi.waitFor(() => expect(box.page).toHaveBeenCalledTimes(1));
    box.deliver(signalFrom(box.executorSecret, box.address, "distress-ack", { distress_id: distress.id }));
    await vi.waitFor(() => expect(warn.mock.calls.flat().join("\n")).toMatch(/\[ack\] REFUSED .* signed by the executor's own key/));
    expect(box.executor.ladders.get(distress.id)?.state).toBe("paging");
  });
});

describe("the signals it acts on, opened with its own key first", () => {
  it("accepts an acknowledgement sealed to its own key, as a phone handed it seals one", async () => {
    quiet();
    const responder = generateSecretKey();
    const operator = generateSecretKey();
    const box = build({ ownKey: true, oncall: [onCallEntry("Wren", getPublicKey(responder))] });
    const distress = distressFrom(operator, box.pubkey);
    box.deliver(distress);
    await vi.waitFor(() => expect(box.page).toHaveBeenCalledTimes(1));
    // Sealed to the executor's key alone: only its own key can open this one.
    box.deliver(
      finalizeEvent(
        {
          kind: KIND_SIGNAL,
          tags: [["p", box.pubkey], ["t", "distress-ack"]],
          content: sealSignal(responder, [box.executorPubkey], { distress_id: distress.id }),
          created_at: nowS(),
        },
        responder,
      ),
    );
    await vi.waitFor(() => expect(box.executor.ladders.get(distress.id)?.state).toBe("acknowledged"));
  });

  it("accepts one sealed to the holders and its own key, exactly as core seals it", async () => {
    quiet();
    const box = await acknowledgedBox({ ownKey: true });
    expect(box.executor.ladders.get(box.first.id)?.state).toBe("acknowledged");
  });

  it("still accepts one sealed to the watch key alone, from a phone handed the watch before it named the executor", async () => {
    quiet();
    const responder = generateSecretKey();
    const operator = generateSecretKey();
    const box = build({ ownKey: true, oncall: [onCallEntry("Wren", getPublicKey(responder))] });
    const distress = distressFrom(operator, box.pubkey);
    box.deliver(distress);
    await vi.waitFor(() => expect(box.page).toHaveBeenCalledTimes(1));
    box.deliver(
      finalizeEvent(
        {
          kind: KIND_SIGNAL,
          tags: [["p", box.pubkey], ["t", "distress-ack"]],
          content: sealSignal(responder, [box.pubkey], { distress_id: distress.id }),
          created_at: nowS(),
        },
        responder,
      ),
    );
    await vi.waitFor(() => expect(box.executor.ladders.get(distress.id)?.state).toBe("acknowledged"));
  });

  it("logs an acknowledgement it cannot open with either key as refused, never dropping it without a word", async () => {
    const { warn } = quiet();
    const responder = generateSecretKey();
    const operator = generateSecretKey();
    const box = build({ ownKey: true, oncall: [onCallEntry("Wren", getPublicKey(responder))] });
    const distress = distressFrom(operator, box.pubkey);
    box.deliver(distress);
    await vi.waitFor(() => expect(box.page).toHaveBeenCalledTimes(1));
    // Sealed to a watch key this box does not hold: a watch handed over again.
    const ack = finalizeEvent(
      {
        kind: KIND_SIGNAL,
        tags: [["p", box.pubkey], ["t", "distress-ack"]],
        content: sealSignal(responder, [getPublicKey(generateSecretKey())], { distress_id: distress.id }),
        created_at: nowS(),
      },
      responder,
    );
    box.deliver(ack);
    await vi.waitFor(() =>
      expect(warn.mock.calls.flat().join("\n")).toMatch(
        new RegExp(`\\[ack\\] REFUSED ${ack.id.slice(0, 8)} .* could not be opened with the executor's own key or the watch key`),
      ),
    );
    expect(box.executor.ladders.get(distress.id)?.state).toBe("paging");
  });

  it("never lets anything but a roster key's acknowledgement stop a ladder, with its own key or without", async () => {
    const { warn } = quiet();
    const operator = generateSecretKey();
    const box = build({ ownKey: true, oncall: [onCallEntry("Wren", getPublicKey(generateSecretKey()))] });
    const distress = distressFrom(operator, box.pubkey);
    box.deliver(distress);
    await vi.waitFor(() => expect(box.page).toHaveBeenCalledTimes(1));
    box.deliver(signalFrom(generateSecretKey(), box.address, "distress-ack", { distress_id: distress.id }));
    await vi.waitFor(() => expect(warn.mock.calls.flat().join(" ")).toMatch(/REFUSED .* not on the on-call roster/));
    expect(box.executor.ladders.get(distress.id)?.state).toBe("paging");
    expect(heard(box.published, operator, distress.id).map((h) => h.payload.responder.kind)).not.toContain("human");
  });
});

describe("a response one key could place on no relay, in the accountability log", () => {
  // Said in the executor's output since the key was built, and nowhere a reviewer reads. `answered`, about
  // whoever it was for, so `--review` counts none of them as an escalation, a held answer or a re-page --
  // and once per ladder, hold or wake answer, so a whole hold of retries is one entry, not fifty.
  const oneKey = (box: { logPath: string }) =>
    logged(box.logPath).filter((e) => e.outcome === "executor-key-refused" || e.outcome === "watch-key-refused");

  it("records the executor's own refused once for a ladder and the retries that join it, about the operator", async () => {
    quiet();
    const operator = generateSecretKey();
    const box = build({ ownKey: true, oncall: [onCallEntry("Wren", getPublicKey(generateSecretKey()))] });
    box.relay.refuses = (e) => e.pubkey === box.executorPubkey;
    const distress = distressFrom(operator, box.pubkey);
    box.deliver(distress);
    await vi.waitFor(() => expect(oneKey(box)).toHaveLength(1));
    for (let i = 0; i < 2; i++) {
      const retry = distressFrom(operator, box.pubkey);
      box.deliver(retry);
      await vi.waitFor(() => expect(answering(box.published, retry.id)).toHaveLength(2));
    }
    await new Promise((r) => setTimeout(r, 30));
    expect(oneKey(box), "one entry per retry, or none").toEqual([
      expect.objectContaining({
        action: "answered",
        outcome: "executor-key-refused",
        actor: expect.objectContaining({ pubkey: box.executorPubkey }),
        subject: expect.objectContaining({ pubkey: getPublicKey(operator) }),
      }),
    ]);
  });

  it("records the watch key's copy refused once per ladder, each about its own operator", async () => {
    quiet();
    const box = build({ ownKey: true, oncall: [onCallEntry("Wren", getPublicKey(generateSecretKey()))] });
    box.relay.refuses = (e) => e.pubkey === box.pubkey;
    const operators = [generateSecretKey(), generateSecretKey()];
    for (const operator of operators) {
      box.deliver(distressFrom(operator, box.pubkey));
      box.deliver(distressFrom(operator, box.pubkey));
    }
    await vi.waitFor(() => expect(oneKey(box)).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 30));
    expect(oneKey(box).map((e) => [e.action, e.outcome, e.subject?.pubkey])).toEqual(
      expect.arrayContaining(operators.map((o) => ["answered", "watch-key-refused", getPublicKey(o)])),
    );
    expect(oneKey(box)).toHaveLength(2);
  });

  it("records it beside a held acknowledgement's ack-not-sent, never instead of it", async () => {
    quiet();
    const box = await acknowledgedBox({ ownKey: true });
    box.relay.refuses = (e) => e.pubkey === box.pubkey;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const again = distressFrom(box.operator, box.pubkey);
    box.deliver(again);
    await vi.waitFor(() => expect(answering(box.published, again.id)).toHaveLength(2));
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.waitFor(() => expect(answering(box.published, again.id)).toHaveLength(4));
    vi.useRealTimers();
    await vi.waitFor(() => expect(logged(box.logPath).filter((e) => e.action === "acked").map((e) => e.outcome)).toEqual(["ack-not-sent"]));
    expect(oneKey(box).map((e) => [e.action, e.outcome, e.subject?.pubkey])).toEqual([
      ["answered", "watch-key-refused", getPublicKey(box.operator)],
    ]);
  });

  it("records an answer to wake-others that lost one key, about the person who asked", async () => {
    quiet();
    const box = await acknowledgedBox({ ownKey: true, roster: (wren) => [onCallEntry("Wren", wren), onCallEntry("Raven", getPublicKey(generateSecretKey()))] });
    const attempt = distressFrom(box.operator, box.pubkey);
    box.deliver(attempt);
    await vi.waitFor(() => expect(box.page).toHaveBeenCalledTimes(2));
    box.relay.refuses = (e) => e.pubkey === box.executorPubkey;
    const wake = signalFrom(box.responder, box.address, "wake-others", { distress_id: attempt.id });
    box.deliver(wake);
    await vi.waitFor(() => expect(heard(box.published, box.responder, wake.id).length).toBeGreaterThan(0));
    await vi.waitFor(() =>
      expect(oneKey(box).filter((e) => e.subject?.pubkey === getPublicKey(box.responder)).map((e) => e.outcome)).toEqual([
        "executor-key-refused",
      ]),
    );
  });
});
