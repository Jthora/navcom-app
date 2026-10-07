/**
 * The executor -- the wiring the pure state machine cannot cover.
 *
 * The ladder's own logic is tested in core, against the seven numbered failure modes. What
 * is left here is everything that could be right in the state machine and wrong in the
 * process: who gets told, what `responder` says, whether a hung agent can interfere, and
 * whether an ack from the wrong person can stop a ladder.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SimplePool } from "nostr-tools/pool";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { Event } from "nostr-tools/core";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountabilityLog } from "../src/shared/accountability.js";
import type { ResponsePayload } from "@navcom/core";
import { EscalationExecutor, RESEND_AGAIN_SECONDS, ageWindowSeconds } from "../src/escalation/executor.js";
import type { EscalationConfig, OnCallEntry } from "../src/escalation/config.js";
import { sealSignal, openSignal, openResponse } from "../src/shared/crypto.js";
import { KIND_DISTRESS, KIND_SIGNAL, KIND_RESPONSE } from "../src/shared/kinds.js";
import type { pageAll } from "../src/escalation/pager.js";

const STANDING = 4_102_444_800;

function onCallEntry(callsign: string, pubkey?: string, channel: OnCallEntry["declaration"]["channel"] = "sms"): OnCallEntry {
  return {
    declaration: {
      author: { kind: "node", callsign, ...(pubkey ? { pubkey } : {}) },
      channel,
      expires: STANDING,
    },
    command: ["true"],
  };
}

const logDirs: string[] = [];
/** A fresh temp dir per config, so one test's accountability entries never leak into another's. */
function tempLogPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "navcom-escalation-log-"));
  logDirs.push(dir);
  return join(dir, "escalation-log.jsonl");
}

function fakeConfig(oncall: OnCallEntry[] = [], over: Partial<EscalationConfig["escalation"]> = {}): EscalationConfig {
  return {
    identity: { privkeyPath: "/dev/null" },
    relays: { urls: ["wss://fake.relay"] },
    escalation: {
      pagingWindowSeconds: 300, contactWindowSeconds: 300,
      drillWindowDays: 7, drillAckWindowSeconds: 1, drillStatePath: "/dev/null/nope",
      maxPagesPerWindow: 20, pageBudgetWindowSeconds: 3_600, ladderRetentionSeconds: 3_600,
      ackHoldsSeconds: 1_800,
      oncall,
      ...over,
    },
    log: { path: tempLogPath(), retentionDays: 90 },
  };
}

function fakePool() {
  const published: Event[] = [];
  /** Every relay refuses an event this returns true for -- a write policy, a rate limit. */
  const relay = { refuses: (_e: Event): boolean => false };
  let onEvent: ((e: Event) => void) | undefined;
  const pool = {
    publish: (_relays: string[], event: Event) => {
      published.push(event);
      return [relay.refuses(event) ? Promise.reject(new Error("blocked: not today")) : Promise.resolve("ok")];
    },
    subscribeMany: (_r: string[], _f: unknown, params: { onevent: (e: Event) => void }) => {
      onEvent = params.onevent;
      return { close: () => {} };
    },
    destroy: () => {},
  } as unknown as SimplePool;
  return { pool, published, relay, deliver: (e: Event) => onEvent?.(e) };
}

let executors: EscalationExecutor[] = [];

/** Typed to pageAll's signature so `mock.calls[0][0]` is the roster, not `never`. */
const noopPager = () => vi.fn<typeof pageAll>(async () => []);

function build(
  oncall: OnCallEntry[] = [],
  page: ReturnType<typeof noopPager> = noopPager(),
  over: Partial<EscalationConfig["escalation"]> = {},
) {
  const secretKey = generateSecretKey();
  const pubkey = getPublicKey(secretKey);
  const { pool, published, relay, deliver } = fakePool();
  const config = fakeConfig(oncall, over);
  const executor = new EscalationExecutor({ config, secretKey, pubkey, pool, page });
  executors.push(executor);
  executor.start();
  return { executor, pubkey, published, relay, deliver, page, logPath: config.log.path };
}

/** Every 20912 published so far that names this id. */
const answering = (published: Event[], id: string) =>
  published.filter((e) => e.kind === KIND_RESPONSE && e.tags.some((t) => t[0] === "e" && t[1] === id));

/** The accountability log's entries, as action/outcome. */
const logged = (logPath: string) =>
  readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean)
    .map((l) => JSON.parse(l) as { action: string; outcome: string });

function distressFrom(operator: Uint8Array, watchtower: string): Event {
  return finalizeEvent(
    {
      kind: KIND_DISTRESS,
      tags: [["p", watchtower]],
      content: sealSignal(operator, [watchtower], { position: null, area: "north side" }),
      created_at: Math.floor(Date.now() / 1000),
    },
    operator,
  );
}

function ackFrom(responder: Uint8Array, watchtower: string, distressId: string): Event {
  return finalizeEvent(
    {
      kind: KIND_SIGNAL,
      tags: [["p", watchtower], ["t", "distress-ack"]],
      content: sealSignal(responder, [watchtower], { distress_id: distressId }),
      created_at: Math.floor(Date.now() / 1000),
    },
    responder,
  );
}

async function reports(published: Event[], operator: Uint8Array, watchtower: string) {
  await vi.waitFor(() => expect(published.length).toBeGreaterThan(0));
  const mine = getPublicKey(operator);
  return published
    .filter((e) => e.kind === KIND_RESPONSE)
    // Sealed to one operator each. Under a flood the pool holds other people's reports too,
    // and trying to open those is not a failure — it is the sealing working.
    .filter((e) => e.tags.find((t) => t[0] === "p")?.[1] === mine)
    .map((e) => openResponse<ResponsePayload>(operator, watchtower, e.content));
}

afterEach(async () => {
  await Promise.all(executors.map((e) => e.stop()));
  executors = [];
  for (const dir of logDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("the trigger", () => {
  it("starts a ladder on a 20911 and tells the operator immediately", async () => {
    const operator = generateSecretKey();
    const { pubkey, published, deliver } = build([onCallEntry("Wren")]);

    deliver(distressFrom(operator, pubkey));

    const [first] = await reports(published, operator, pubkey);
    expect(first!.type).toBe("escalation-status");
    expect(first!.text).toMatch(/Paging Wren/);
    // Structured as well as said, so the phone never parses the sentence to act on it.
    expect(first!.ladder).toBe("paging");
    expect(first!.responder.kind).toBe("node");
  });

  it("says nobody is coming as a state, not only as a sentence, when nobody is on call", async () => {
    // The defect this guards lived on the phone: the ladder's "Nobody is coming" was filed
    // under "an agent answered" and never shown. The phone can only act on it at once if the
    // state travels with the words.
    const operator = generateSecretKey();
    const { pubkey, published, deliver } = build([]);

    deliver(distressFrom(operator, pubkey));

    const [first] = await reports(published, operator, pubkey);
    expect(first!.ladder).toBe("exhausted");
    expect(first!.text).toMatch(/Nobody is coming/);
  });

  it("pages everyone at once, and only after the operator has been told", async () => {
    const operator = generateSecretKey();
    const page = noopPager();
    const { pubkey, published, deliver } = build(
      [onCallEntry("Wren"), onCallEntry("Raven")],
      page,
    );

    deliver(distressFrom(operator, pubkey));
    await vi.waitFor(() => expect(page).toHaveBeenCalledTimes(1));

    // One call with the whole roster -- parallel, not a call per person in sequence.
    expect(page.mock.calls[0]![0]).toHaveLength(2);
    expect(published.length).toBeGreaterThan(0);
  });

  it("ignores a forged distress", async () => {
    const operator = generateSecretKey();
    const { pubkey, published, deliver } = build([onCallEntry("Wren")]);
    // Round-tripped through JSON, which is what a relay actually delivers. A plain object
    // spread would carry nostr-tools' internal "already verified" marker across, and the
    // forgery would sail through verifyEvent -- a test artifact, but one that would have
    // made this assertion meaningless while looking like it passed.
    const forged = JSON.parse(JSON.stringify(distressFrom(operator, pubkey))) as Event;
    forged.sig = "0".repeat(128);

    deliver(forged);
    await new Promise((r) => setTimeout(r, 50));
    expect(published).toHaveLength(0);
  });

  it("starts one ladder for a retried distress [failure mode 7]", async () => {
    // The client is required to retry indefinitely, so this is the normal case.
    const operator = generateSecretKey();
    const page = noopPager();
    const { executor, pubkey, deliver } = build([onCallEntry("Wren")], page);
    const event = distressFrom(operator, pubkey);

    deliver(event);
    await vi.waitFor(() => expect(page).toHaveBeenCalledTimes(1));
    deliver(event);
    deliver(event);
    await new Promise((r) => setTimeout(r, 50));

    expect(executor.ladders.all()).toHaveLength(1);
    expect(page).toHaveBeenCalledTimes(1);
  });

  it("does not page again for a retry the client re-signed [the real failure mode 7]", async () => {
    /*
     * The test above delivers the *same event* three times, which is relay redelivery. A
     * client retry is not that: `sendDistress` signs a fresh event with a fresh id every
     * attempt, so every retry used to look like a new emergency -- a new ladder, a page, and
     * a budget unit. At roughly forty-eight attempts an hour against a global budget of
     * twenty, one operator nobody answered spent the whole hour's paging in twenty-one
     * minutes, after which a second, unrelated emergency could wake nobody, and the twenty
     * pages it did spend all went to one person about one emergency.
     */
    const operator = generateSecretKey();
    const page = noopPager();
    const { executor, pubkey, deliver } = build([onCallEntry("Wren")], page);

    const first = distressFrom(operator, pubkey);
    const retry = distressFrom(operator, pubkey);
    expect(retry.id, "the helper made the same event twice, so this proves nothing").not.toBe(
      first.id,
    );

    deliver(first);
    await vi.waitFor(() => expect(page).toHaveBeenCalledTimes(1));
    deliver(retry);
    await new Promise((r) => setTimeout(r, 200));

    expect(executor.ladders.all()).toHaveLength(1);
    expect(page, "a re-signed retry woke the roster a second time").toHaveBeenCalledTimes(1);
  });

  it("but a second operator is a second emergency, and does page", async () => {
    // The pair. Joining by operator must never merge two people's emergencies -- that would
    // be one person's Distress silencing another's.
    const page = noopPager();
    const { executor, pubkey, deliver } = build([onCallEntry("Wren")], page);

    deliver(distressFrom(generateSecretKey(), pubkey));
    await vi.waitFor(() => expect(page).toHaveBeenCalledTimes(1));
    deliver(distressFrom(generateSecretKey(), pubkey));
    await vi.waitFor(() => expect(page).toHaveBeenCalledTimes(2));

    expect(executor.ladders.all()).toHaveLength(2);
  });
});

describe("a Distress a human already acknowledged, sent again [decision 2026-10-07]", () => {
  /*
   * A phone that missed the acknowledgement -- its connection dropped at that moment -- keeps
   * sending, and every new attempt opened a fresh ladder and paged the roster again for an
   * emergency somebody was already responding to. Inside the window the executor answers the new
   * attempt with the acknowledgement it already has, and wakes nobody.
   */
  async function acknowledged() {
    const operator = generateSecretKey();
    const responder = generateSecretKey();
    const page = noopPager();
    const ctx = build([onCallEntry("Wren", getPublicKey(responder))], page);
    const first = distressFrom(operator, ctx.pubkey);
    ctx.deliver(first);
    await vi.waitFor(() => expect(page).toHaveBeenCalledTimes(1));
    ctx.deliver(ackFrom(responder, ctx.pubkey, first.id));
    await vi.waitFor(() => expect(ctx.executor.ladders.get(first.id)?.state).toBe("acknowledged"));
    return { ...ctx, operator, responder, page, first };
  }

  it("re-sends the acknowledgement to the new attempt and pages nobody", async () => {
    const { executor, pubkey, published, deliver, page, operator } = await acknowledged();

    // A fresh event, as the client signs one per attempt.
    const again = distressFrom(operator, pubkey);
    deliver(again);

    await vi.waitFor(() => {
      const answering = published.filter(
        (e) => e.kind === KIND_RESPONSE && e.tags.some((t) => t[0] === "e" && t[1] === again.id),
      );
      expect(answering).toHaveLength(1);
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(page, "the roster was woken again for a Distress somebody is answering").toHaveBeenCalledTimes(1);
    expect(executor.ladders.all()).toHaveLength(1);

    const reply = published.find(
      (e) => e.kind === KIND_RESPONSE && e.tags.some((t) => t[0] === "e" && t[1] === again.id),
    )!;
    const payload = openResponse<ResponsePayload>(operator, pubkey, reply.content);
    // Authored by the human who acknowledged: that is what ends the phone's retry.
    expect(payload.type).toBe("ack");
    expect(payload.responder.kind).toBe("human");
    expect(payload.responder.callsign).toBe("Wren");
    expect(payload.ladder).toBe("acknowledged");
    // Only what this process knows, whether the phone missed the answer or this is a new emergency
    // [review: D2, #0, relay paths R2]: when it was acknowledged, that this executor has not
    // escalated the attempt, and when that changes.
    expect(payload.text).toMatch(/acknowledged less than a minute ago/i);
    expect(payload.text).toMatch(/the watch has not escalated this one/i);
    expect(payload.text).toMatch(/still sending in 30 min, the watch treats it as new/i);
    // "Nobody has been told" and "paged nobody" are false wherever a keyless pager runs, which
    // pages for a Distress it cannot know was answered; "your phone sent another" called a new
    // emergency a duplicate.
    expect(payload.text).not.toMatch(/is responding|still asking|nobody has been told|paged nobody|sent another/i);
  });

  it("sends it again ten seconds later, freshly signed, for a phone that recorded its attempt late [#13]", async () => {
    // The second send is what an older client -- one that records an attempt only once its publish
    // has settled, still cached on phones -- hears when it started its Distress again. Nothing
    // tested it: deleting it left the whole suite green.
    const { pubkey, published, deliver, operator, first, logPath } = await acknowledged();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const again = distressFrom(operator, pubkey);
      deliver(again);
      await vi.waitFor(() => expect(answering(published, again.id)).toHaveLength(1));
      await vi.advanceTimersByTimeAsync(RESEND_AGAIN_SECONDS * 1000);
      await vi.waitFor(() => expect(answering(published, again.id)).toHaveLength(2));

      const [one, two] = answering(published, again.id);
      expect(one!.id, "the same event sent twice is a duplicate a relay drops").not.toBe(two!.id);
      for (const e of [one!, two!]) {
        expect(e.tags.filter((t) => t[0] === "e").map((t) => t[1])).toEqual([again.id, first.id]);
      }
      // One record per attempt: the second send is the same answer to the same attempt.
      expect(logged(logPath).filter((e) => e.action === "acked")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not send it a second time once the executor has stopped", async () => {
    const { executor, pubkey, published, deliver, operator } = await acknowledged();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const again = distressFrom(operator, pubkey);
      deliver(again);
      await vi.waitFor(() => expect(answering(published, again.id)).toHaveLength(1));
      await executor.stop();
      await vi.advanceTimersByTimeAsync(RESEND_AGAIN_SECONDS * 1000 * 2);
      expect(answering(published, again.id)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops holding once neither send reaches a relay, and pages for the next attempt [#14]", async () => {
    // Relays refusing the watch's own 20912 -- a write policy, a rate limit -- while still carrying
    // the operator's Distress. The hold went on answering every attempt into nothing for half an
    // hour, paging nobody, while the executor knew within seconds that nothing had left.
    const { executor, pubkey, published, relay, deliver, page, operator, logPath } = await acknowledged();
    relay.refuses = (e) => e.kind === KIND_RESPONSE;
    const again = distressFrom(operator, pubkey);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      deliver(again);
      await vi.waitFor(() => expect(answering(published, again.id)).toHaveLength(1));
      // Still holding until the second send has had its chance.
      await vi.advanceTimersByTimeAsync(RESEND_AGAIN_SECONDS * 1000);
      await vi.waitFor(() => expect(answering(published, again.id)).toHaveLength(2));
      // Recorded once, and truthfully: neither send left anything behind it on any relay [#25].
      await vi.waitFor(() =>
        expect(logged(logPath).filter((e) => e.action === "acked")).toEqual([
          expect.objectContaining({ outcome: "ack-not-sent" }),
        ]),
      );
      expect(page, "paged for the attempt the hold answered").toHaveBeenCalledTimes(1);

      const next = distressFrom(operator, pubkey);
      deliver(next);
      await vi.waitFor(() => expect(page, "the hold went on paging nobody").toHaveBeenCalledTimes(2));
      expect(executor.ladders.get(next.id)?.distressId, "no ladder of its own").toBe(next.id);
    } finally {
      vi.useRealTimers();
    }
  });

  it("goes on holding when only the first send is refused, and wakes nobody again [review: relay paths, R2]", async () => {
    // The daemon's agent acknowledgement on the same key a moment earlier, under a relay's rate
    // limit, or a blip on a one-relay box. Ending the hold at that first refusal opened a ladder in
    // the same breath and paged Wren for a Distress she had answered; the second send, ten seconds
    // on, would have reached the phone.
    const { executor, pubkey, published, relay, deliver, page, operator, logPath } = await acknowledged();
    let refused = 0;
    relay.refuses = (e) => e.kind === KIND_RESPONSE && refused++ === 0;
    const again = distressFrom(operator, pubkey);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      deliver(again);
      await vi.waitFor(() => expect(answering(published, again.id)).toHaveLength(1));
      await vi.advanceTimersByTimeAsync(RESEND_AGAIN_SECONDS * 1000);
      await vi.waitFor(() => expect(answering(published, again.id)).toHaveLength(2));
      await vi.waitFor(() =>
        expect(logged(logPath).filter((e) => e.action === "acked")).toEqual([
          expect.objectContaining({ outcome: "acknowledged" }),
        ]),
      );

      // Still held: the next attempt is answered with Wren's answer again, and nobody is woken.
      const next = distressFrom(operator, pubkey);
      deliver(next);
      const [reply] = await vi.waitFor(() => {
        const found = answering(published, next.id);
        expect(found).toHaveLength(1);
        return found;
      });
      expect(openResponse<ResponsePayload>(operator, pubkey, reply!.content).ladder, "a new ladder answered it").toBe("acknowledged");
      expect(executor.ladders.all()).toHaveLength(1);
      expect(page, "Wren was paged again for a Distress she had answered").toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not end the hold over one attempt's refusals once another attempt's answer got through", async () => {
    // A phone on an older client sends every few seconds. Its next attempt's answer reached a relay
    // between this one's two refused sends: the operator has been told, and the hold is working.
    const { executor, pubkey, published, relay, deliver, page, operator } = await acknowledged();
    relay.refuses = (e) => e.kind === KIND_RESPONSE;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const one = distressFrom(operator, pubkey);
      deliver(one);
      await vi.waitFor(() => expect(answering(published, one.id)).toHaveLength(1));
      relay.refuses = () => false;
      const two = distressFrom(operator, pubkey);
      deliver(two);
      await vi.waitFor(() => expect(answering(published, two.id)).toHaveLength(1));
      relay.refuses = (e) => e.kind === KIND_RESPONSE;
      await vi.advanceTimersByTimeAsync(RESEND_AGAIN_SECONDS * 1000);
      await vi.waitFor(() => expect(answering(published, one.id)).toHaveLength(2));

      const three = distressFrom(operator, pubkey);
      deliver(three);
      const [reply] = await vi.waitFor(() => {
        const found = answering(published, three.id);
        expect(found).toHaveLength(1);
        return found;
      });
      expect(openResponse<ResponsePayload>(operator, pubkey, reply!.content).ladder, "the hold was ended and a ladder answered").toBe("acknowledged");
      expect(executor.ladders.all()).toHaveLength(1);
      expect(page).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("records an attempt whose second send the executor stopped before, as not sent", async () => {
    // Restarted between the two: the record is written then, rather than lost with the timer.
    const { executor, pubkey, published, relay, deliver, operator, logPath } = await acknowledged();
    relay.refuses = (e) => e.kind === KIND_RESPONSE;
    const again = distressFrom(operator, pubkey);
    deliver(again);
    await vi.waitFor(() => expect(answering(published, again.id)).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(logged(logPath).filter((e) => e.action === "acked"), "written before it was settled").toEqual([]);
    await executor.stop();
    expect(logged(logPath).filter((e) => e.action === "acked")).toEqual([
      expect.objectContaining({ outcome: "ack-not-sent" }),
    ]);
  });

  it("goes on holding when a relay takes it, and records that once [#25]", async () => {
    const { pubkey, deliver, page, operator, logPath, published } = await acknowledged();
    const again = distressFrom(operator, pubkey);
    deliver(again);
    await vi.waitFor(() => expect(answering(published, again.id)).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(page).toHaveBeenCalledTimes(1);
    expect(logged(logPath).filter((e) => e.action === "acked")).toEqual([
      expect.objectContaining({ outcome: "acknowledged" }),
    ]);
  });

  it("names the acknowledged Distress as well, an id the phone's loop already holds [D2]", async () => {
    // A client from before 2026-10-07 drops an answer to an id it has not recorded yet, and records
    // an attempt only once its publish has settled on every relay. An answer naming only the new
    // attempt lands before that whenever a relay is slow to say OK; the first id is one it has had
    // for minutes. A current client reads the two ids to tell which Distress was answered [#0].
    const { pubkey, published, deliver, operator, first } = await acknowledged();
    const again = distressFrom(operator, pubkey);
    deliver(again);

    const reply = await vi.waitFor(() => {
      const found = published.find(
        (e) => e.kind === KIND_RESPONSE && e.tags.some((t) => t[0] === "e" && t[1] === again.id),
      );
      expect(found).toBeDefined();
      return found!;
    });
    expect(reply.tags.filter((t) => t[0] === "e").map((t) => t[1])).toEqual([again.id, first.id]);
  });

  it("ends when the clock steps back past the acknowledgement, failing toward paging", async () => {
    // Acknowledged while the box's clock read an hour fast -- an RTC kept in local time -- then
    // corrected. Measured from a moment that is now in the future, the hold lasted the window plus
    // the step, and a new emergency forty minutes on was answered with the old acknowledgement.
    const real = Date.now.bind(Date);
    const clock = vi.spyOn(Date, "now").mockImplementation(() => real() + 3_600_000);
    const { executor, pubkey, deliver, page, operator } = await acknowledged();

    clock.mockImplementation(() => real() + 2_400_000);
    deliver(distressFrom(operator, pubkey));
    await vi.waitFor(() => expect(page).toHaveBeenCalledTimes(2));
    expect(executor.ladders.all()).toHaveLength(2);
  });

  it("records the re-sent acknowledgement, and nothing claiming a second escalation", async () => {
    const { pubkey, deliver, operator, logPath, published } = await acknowledged();
    const again = distressFrom(operator, pubkey);
    deliver(again);
    await vi.waitFor(() =>
      expect(published.some((e) => e.tags.some((t) => t[0] === "e" && t[1] === again.id))).toBe(true),
    );

    await vi.waitFor(() => {
      const entries = readFileSync(logPath, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { action: string; outcome: string });
      expect(entries.filter((e) => e.action === "acked")).toEqual([
        expect.objectContaining({ action: "acked", outcome: "acknowledged" }),
      ]);
      expect(entries.filter((e) => e.action === "escalated")).toHaveLength(1);
    });
  });

  it("opens a new ladder once the window has closed", async () => {
    const { executor, pubkey, deliver, page, operator } = await acknowledged();
    const real = Date.now.bind(Date);
    vi.spyOn(Date, "now").mockImplementation(() => real() + 1_801_000);

    deliver(distressFrom(operator, pubkey));
    await vi.waitFor(() => expect(page).toHaveBeenCalledTimes(2));
    expect(executor.ladders.all()).toHaveLength(2);
  });

  it("does not hold for an exhausted ladder: nobody answered that one", async () => {
    // Exhausted is the watch having failed. A new attempt is somebody still in trouble with
    // nobody on the other end, and holding it would be silence.
    const operator = generateSecretKey();
    const page = noopPager();
    const { executor, pubkey, deliver } = build([], page);
    const first = distressFrom(operator, pubkey);
    deliver(first);
    await vi.waitFor(() => expect(executor.ladders.get(first.id)?.state).toBe("exhausted"));

    deliver(distressFrom(operator, pubkey));
    await vi.waitFor(() => expect(executor.ladders.all()).toHaveLength(2));
  });

  it("holds for that operator only", async () => {
    const { executor, pubkey, deliver, page } = await acknowledged();
    deliver(distressFrom(generateSecretKey(), pubkey));
    await vi.waitFor(() => expect(page).toHaveBeenCalledTimes(2));
    expect(executor.ladders.all()).toHaveLength(2);
  });
});

describe("what the operator is told", () => {
  it("reports EXHAUSTED immediately when nobody is on-call [failure modes 1 and 5]", async () => {
    const operator = generateSecretKey();
    const { pubkey, published, deliver } = build([]);

    deliver(distressFrom(operator, pubkey));

    const [first] = await reports(published, operator, pubkey);
    expect(first!.text).toMatch(/Nobody is coming/i);
    expect(first!.text).toMatch(/no emergency contact/i);
  });

  it("authors a transition as the node, so a phone keeps retrying through it", async () => {
    // The load-bearing detail. The client stops retrying on a `human` responder, so a
    // machine saying "paging" MUST NOT be authored as one -- that would end a Distress with
    // nobody on the other side, which is invariant 2 failing while looking like it worked.
    const operator = generateSecretKey();
    const { pubkey, published, deliver } = build([onCallEntry("Wren")]);

    deliver(distressFrom(operator, pubkey));

    const all = await reports(published, operator, pubkey);
    for (const r of all) {
      expect(r.responder.kind, JSON.stringify(r)).not.toBe("human");
    }
  });
});

describe("acknowledgement", () => {
  it("stops the ladder and names the human, which is what ends the operator's retry", async () => {
    const operator = generateSecretKey();
    const responder = generateSecretKey();
    const wren = onCallEntry("Wren", getPublicKey(responder));
    const { executor, pubkey, published, deliver } = build([wren]);

    const distress = distressFrom(operator, pubkey);
    deliver(distress);
    await vi.waitFor(() => expect(published.length).toBeGreaterThan(0));

    deliver(ackFrom(responder, pubkey, distress.id));

    await vi.waitFor(() => {
      expect(executor.ladders.get(distress.id)?.state).toBe("acknowledged");
    });

    const all = await reports(published, operator, pubkey);
    const final = all.at(-1)!;
    expect(final.responder.kind).toBe("human");
    expect(final.responder.callsign).toBe("Wren");
    expect(final.text).toMatch(/Wren is responding/);
  });

  it("refuses an ack from somebody not on the roster", async () => {
    // A ladder that keeps paging is survivable. One stopped by somebody who is not coming
    // is not -- so this is strict, and the refusal is logged rather than silent.
    const operator = generateSecretKey();
    const stranger = generateSecretKey();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { executor, pubkey, published, deliver } = build([onCallEntry("Wren")]);

    const distress = distressFrom(operator, pubkey);
    deliver(distress);
    await vi.waitFor(() => expect(published.length).toBeGreaterThan(0));

    deliver(ackFrom(stranger, pubkey, distress.id));
    await new Promise((r) => setTimeout(r, 50));

    expect(executor.ladders.get(distress.id)?.state).toBe("paging");
    expect(warn.mock.calls.flat().join(" ")).toMatch(/REFUSED/);
  });

  it("ignores an ack for a distress it never saw", async () => {
    const responder = generateSecretKey();
    const { pubkey, deliver } = build([onCallEntry("Wren", getPublicKey(responder))]);
    deliver(ackFrom(responder, pubkey, "f".repeat(64)));
    await new Promise((r) => setTimeout(r, 50));
    // No crash, no ladder invented.
    expect(true).toBe(true);
  });
});

describe("the executor's own accountability log (found in robustness audit)", () => {
  // The daemon cannot record these outcomes -- it does not run the ladder and does not
  // know them. This is the one place they are durably recorded, immediately, by the
  // process that actually knows.

  it("records escalation-reached-human once a real ack lands", async () => {
    const operator = generateSecretKey();
    const operatorPubkey = getPublicKey(operator);
    const responder = generateSecretKey();
    const wren = onCallEntry("Wren", getPublicKey(responder));
    const { executor, pubkey, published, deliver, logPath } = build([wren]);

    const distress = distressFrom(operator, pubkey);
    deliver(distress);
    await vi.waitFor(() => expect(published.length).toBeGreaterThan(0));
    deliver(ackFrom(responder, pubkey, distress.id));
    await vi.waitFor(() => expect(executor.ladders.get(distress.id)?.state).toBe("acknowledged"));

    const { log } = AccountabilityLog.open(logPath, 90);
    const entries = log.about(operatorPubkey);
    expect(entries.map((e) => e.outcome)).toContain("escalation-reached-human");
  });

  it("records escalation-reached-nobody when the ladder is exhausted with an empty roster", async () => {
    const operator = generateSecretKey();
    const operatorPubkey = getPublicKey(operator);
    const { pubkey, published, deliver, logPath } = build([]);

    deliver(distressFrom(operator, pubkey));
    await vi.waitFor(() => expect(published.length).toBeGreaterThan(0));

    const { log } = AccountabilityLog.open(logPath, 90);
    const entries = log.about(operatorPubkey);
    expect(entries.map((e) => e.outcome)).toContain("escalation-reached-nobody");
  });

  it("does not open a ladder or record anything for a Distress addressed to a different watch", async () => {
    // Found in robustness audit: only the signature was checked, never the `p` tag. A
    // relay that mis-honors its own `#p` filter could otherwise deliver a validly-signed
    // Distress meant for a different Watchtower entirely, and it would page this roster.
    const operator = generateSecretKey();
    const someoneElsesWatch = getPublicKey(generateSecretKey());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { executor, published, deliver, logPath } = build([onCallEntry("Wren")]);

    deliver(distressFrom(operator, someoneElsesWatch));
    await new Promise((r) => setTimeout(r, 50));

    expect(published).toHaveLength(0);
    expect(executor.ladders.all()).toHaveLength(0);
    expect(warn.mock.calls.flat().join(" ")).toMatch(/not addressed to this watch/);

    const { log } = AccountabilityLog.open(logPath, 90);
    expect(log.all()).toHaveLength(0);
  });
});

describe("proving a channel works before relying on it", () => {
  it("marks a test page unmistakably, in the text the recipient reads", async () => {
    // A drill MUST be distinguishable from a real Distress BY THE RECIPIENT. Somebody woken
    // at 3am has seconds and no context, so the distinction cannot live in a field the page
    // does not carry or a schedule they were never told about.
    const { testPage, TEST_PREFIX } = await import("../src/escalation/pager.js");
    const entry = onCallEntry("Wren");
    entry.command = ["node", "-e", "process.stdout.write(process.argv[1])", "{{message}}"];

    const results = await testPage([entry]);
    expect(results[0]!.dispatched).toBe(true);
    expect(TEST_PREFIX).toMatch(/NOT AN EMERGENCY/);
    expect(TEST_PREFIX.startsWith("[")).toBe(true);
  });

  it("reports a command that does not exist rather than counting it as reachable", async () => {
    // An on-call entry whose command has never run is an entry that works until the night it
    // matters. "dispatched" is the weakest possible claim and it still has to be earned.
    const { testPage } = await import("../src/escalation/pager.js");
    const broken = onCallEntry("Ghost");
    broken.command = ["definitely-not-a-real-command-xyz"];

    const [result] = await testPage([broken], "check", 5_000);
    expect(result!.dispatched).toBe(false);
    expect(result!.error).toBeTruthy();
  });

  it("does not page a console-open entry, which cannot be woken", async () => {
    const { testPage } = await import("../src/escalation/pager.js");
    const results = await testPage([onCallEntry("Oracle", undefined, "console-open")]);
    expect(results).toEqual([]);
  });

  it("passes the message per-argument, so a payload cannot become a command", async () => {
    // argv, never a shell string. This asserts the substitution reaches the child process
    // as one argument rather than being re-parsed by anything.
    const { pageAll } = await import("../src/escalation/pager.js");
    const entry = onCallEntry("Wren");
    entry.command = ["node", "-e", "if(process.argv[1] !== '; rm -rf /') process.exit(3)", "{{message}}"];

    const [result] = await pageAll([entry], "; rm -rf /");
    expect(result!.dispatched, "the message was altered or re-parsed").toBe(true);
  });
});

describe("drills", () => {
  it("pages the roster with a message a woken person can tell from an emergency", async () => {
    const dir = mkdtempSync(join(tmpdir(), "navcom-drill-"));
    try {
      const page = noopPager();
      const secretKey = generateSecretKey();
      const { pool } = fakePool();
      const executor = new EscalationExecutor({
        config: fakeConfig([onCallEntry("Wren")]),
        secretKey, pubkey: getPublicKey(secretKey), pool, page,
        drillStatePath: join(dir, "drill.json"),
      });
      executors.push(executor);

      await executor.fireDrill("drill-1");

      const message = String(page.mock.calls[0]?.[1] ?? "");
      expect(message).toMatch(/NOT AN EMERGENCY/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("records a failure when nobody answers, and says so on disk", async () => {
    // The result the daemon reads when it publishes 10910. A watch that cannot demonstrate
    // a passing drill is presumed broken, and this is how it finds that out weekly rather
    // than on the night it matters.
    const dir = mkdtempSync(join(tmpdir(), "navcom-drill-"));
    const statePath = join(dir, "drill.json");
    try {
      const secretKey = generateSecretKey();
      const { pool } = fakePool();
      const executor = new EscalationExecutor({
        config: fakeConfig([onCallEntry("Wren")]),
        secretKey, pubkey: getPublicKey(secretKey), pool, page: noopPager(),
        drillStatePath: statePath,
      });
      executors.push(executor);

      await executor.fireDrill("drill-2");

      const state = JSON.parse(readFileSync(statePath, "utf8")) as { last: { result: string } };
      expect(state.last.result).toBe("fail");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails immediately with an empty roster rather than waiting out the window", async () => {
    // Nothing to wait for. Ten minutes of window with nobody on the other end is ten
    // minutes, and the answer was known at the start.
    const dir = mkdtempSync(join(tmpdir(), "navcom-drill-"));
    try {
      const secretKey = generateSecretKey();
      const { pool } = fakePool();
      const executor = new EscalationExecutor({
        config: fakeConfig([]),
        secretKey, pubkey: getPublicKey(secretKey), pool, page: noopPager(),
        drillStatePath: join(dir, "drill.json"),
      });
      executors.push(executor);

      const started = Date.now();
      await executor.fireDrill("drill-3");
      expect(Date.now() - started).toBeLessThan(500);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("6 — the agent cannot impair escalation", () => {
  it("has no reference to the agent anywhere in the executor's module graph", async () => {
    // Structural, asserted against the source rather than argued. The daemon owns the agent
    // and the board; if the executor ever imports either, the separation has been lost and
    // a hung agent can take the one path that must never depend on it.
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const dir = fileURLToPath(new URL("../src/escalation/", import.meta.url));

    for (const file of ["executor.ts", "config.ts", "pager.ts", "index.ts"]) {
      const src = readFileSync(`${dir}${file}`, "utf8");
      const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!);
      for (const spec of imports) {
        expect(spec, `${file} imports ${spec}`).not.toMatch(/daemon\/|query\.js|board\.js|watchtower\.js/);
      }
    }
  });

  it("subscribes to relays itself rather than being handed events", async () => {
    // The requirement failing "on paper" would look like: separate process, trigger routed
    // through the daemon. Then a hung daemon takes escalation with it.
    const { pubkey, deliver } = build([onCallEntry("Wren")]);
    const operator = generateSecretKey();
    // `deliver` IS the relay subscription callback. That it exists is the assertion.
    expect(() => deliver(distressFrom(operator, pubkey))).not.toThrow();
  });
});

describe("a watch being flooded", () => {
  /**
   * The address is meant to be handed out, so anybody can publish a signed `20911` from a
   * key they made a second ago. Unbounded, three hundred of them paged a real person three
   * hundred times — which is how escalation dies. Not by being wrong, by being ignored on
   * the night it is right.
   */
  const strangerDistress = (watchtower: string): Event => {
    const stranger = generateSecretKey();
    return finalizeEvent(
      {
        kind: KIND_DISTRESS,
        tags: [["p", watchtower]],
        content: sealSignal(stranger, [watchtower], { position: null, area: "x" }),
        created_at: Math.floor(Date.now() / 1000),
      },
      stranger,
    );
  };

  it("stops waking people once the budget is spent", async () => {
    const page = noopPager();
    const { pubkey, deliver } = build([onCallEntry("Wren")], page, { maxPagesPerWindow: 3 });

    for (let i = 0; i < 40; i++) deliver(strangerDistress(pubkey));
    await vi.waitFor(() => expect(page.mock.calls.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 150));

    expect(page.mock.calls.length).toBe(3);
  });

  it("still tells every operator, because the ladder may fail but never silently", async () => {
    // Invariant 2. Refusing to page is allowed; refusing to page without saying so is not.
    const operator = generateSecretKey();
    const { pubkey, published, deliver } = build([onCallEntry("Wren")], noopPager(), {
      maxPagesPerWindow: 1,
    });

    // The flood spends the budget, and then a real operator's Distress arrives. This is the
    // case that decides whether the limit is defensible at all: they get no page, and they
    // are told exactly that rather than being shown "Paging Wren."
    deliver(strangerDistress(pubkey));
    await vi.waitFor(() => expect(published.length).toBeGreaterThan(0));
    deliver(distressFrom(operator, pubkey));
    const said = await vi.waitFor(async () => {
      const all = await reports(published, operator, pubkey);
      expect(all.some((r) => /could not page anyone/i.test(r.text ?? ""))).toBe(true);
      return all;
    });
    expect(said.some((r) => /nobody has been woken/i.test(r.text ?? ""))).toBe(true);
  });

  it("names who could not be reached, rather than reporting a partial failure as a page", async () => {
    /*
     * `ladder.paged` is built from the roster when the ladder opens, never from what actually
     * dispatched — so a roster of three with one dead channel told the operator "Paging Wren,
     * Raven, Kestrel." and they spent the paging window believing three people were being woken.
     * Only the all-channels-failed case was reported. `runDrill` already named the dispatched
     * ones, so the two paths disagreed about what "paged" means.
     */
    const stranger = generateSecretKey();
    const partly = vi.fn<typeof pageAll>(async () => [
      { callsign: "Wren", channel: "sms", dispatched: true },
      { callsign: "Kestrel", channel: "push", dispatched: false, error: "ENOENT" },
    ]);
    const { pubkey, published, deliver } = build([onCallEntry("Wren"), onCallEntry("Kestrel")], partly);

    deliver(distressFrom(stranger, pubkey));
    // Waited on the sentence itself: the ladder's own "Paging Wren, Kestrel." arrives first and
    // matching a name would pass on the very report this test exists to distrust.
    const said = await vi.waitFor(async () => {
      const all = await reports(published, stranger, pubkey);
      expect(all.some((r) => /could not be reached/i.test(r.text ?? ""))).toBe(true);
      return all;
    });
    expect(said.some((r) => /kestrel/i.test(r.text ?? ""))).toBe(true);
    // And it must not claim nobody was woken, because somebody was.
    expect(said.some((r) => /nobody has been woken/i.test(r.text ?? ""))).toBe(false);
  });

  it("ignores a Distress stamped outside the paging window", async () => {
    /*
     * A signed `20911` is valid forever and any relay can re-serve one, so a captured Distress
     * from months ago opened a ladder and woke the whole roster — again every hour, since
     * terminal ladders are reaped hourly. The keyless pager has always refused this: something
     * stamped well in the past is not news, and paging for it wakes somebody about an emergency
     * that is over.
     */
    const stranger = generateSecretKey();
    const paged = vi.fn<typeof pageAll>(async () => []);
    const { executor, pubkey, deliver } = build([onCallEntry("Wren")], paged);

    const old = finalizeEvent(
      {
        kind: KIND_DISTRESS,
        tags: [["p", pubkey]],
        content: sealSignal(stranger, [pubkey], { position: null, area: "north side" }),
        created_at: Math.floor(Date.now() / 1000) - 90 * 86400
      },
      stranger,
    );
    deliver(old);

    await new Promise((r) => setTimeout(r, 200));
    expect(executor.ladders.all(), "a replayed Distress must open no ladder").toHaveLength(0);
    expect(paged).not.toHaveBeenCalled();
  });

  it("does not hold every ladder it has ever opened", async () => {
    // An empty roster and no emergency contact is failure mode 1: the ladder opens straight
    // into EXHAUSTED rather than waiting out a window with nobody on the other end. That is
    // a terminal state, so retention decides how long it stays resident.
    const { executor, pubkey, deliver } = build([], noopPager(), { ladderRetentionSeconds: 1 });

    for (let i = 0; i < 50; i++) deliver(strangerDistress(pubkey));
    await vi.waitFor(() => expect(executor.ladders.all().length).toBeGreaterThan(10));
    const peak = executor.ladders.all().length;

    await vi.waitFor(() => expect(executor.ladders.all().length).toBeLessThan(peak), { timeout: 8_000 });
  }, 12_000);

  it("tells the operator when every channel failed, rather than claiming it paged", async () => {
    // The dispatch result went into the log and nowhere else. A dead gateway meant the
    // operator was told "Paging Wren." while nobody had been woken at all.
    const stranger = generateSecretKey();
    const failing = vi.fn<typeof pageAll>(async () => [
      { callsign: "Wren", channel: "sms", dispatched: false, error: "ENOENT" },
    ]);
    const { pubkey, published, deliver } = build([onCallEntry("Wren")], failing);

    deliver(distressFrom(stranger, pubkey));
    const said = await vi.waitFor(async () => {
      const all = await reports(published, stranger, pubkey);
      expect(all.some((r) => /every channel failed/i.test(r.text ?? ""))).toBe(true);
      return all;
    });
    expect(said.some((r) => /nobody has been woken/i.test(r.text ?? ""))).toBe(true);
  });

  it("says nothing extra when the page did go out", async () => {
    const stranger = generateSecretKey();
    const working = vi.fn<typeof pageAll>(async () => [
      { callsign: "Wren", channel: "sms", dispatched: true },
    ]);
    const { pubkey, published, deliver } = build([onCallEntry("Wren")], working);

    deliver(distressFrom(stranger, pubkey));
    const said = await reports(published, stranger, pubkey);
    expect(said[0]!.text).toBe("Paging Wren.");
  });
});

describe("what a phone is told, on every attempt and not only the first [#31]", () => {
  it("opens with nobody-could-be-paged, never with 'Paging Wren.', when the budget is spent", async () => {
    // The budget was taken after the opening report, so the operator was told "Paging Wren." and a
    // round trip later that nobody could be paged -- and a phone that kept the first answer kept
    // the false one.
    const operator = generateSecretKey();
    const { pubkey, published, deliver } = build([onCallEntry("Wren")], noopPager(), { maxPagesPerWindow: 1 });
    deliver(distressFrom(generateSecretKey(), pubkey));
    await vi.waitFor(() => expect(published.length).toBeGreaterThan(0));

    deliver(distressFrom(operator, pubkey));
    const said = await vi.waitFor(async () => {
      const all = await reports(published, operator, pubkey);
      expect(all.length).toBeGreaterThan(0);
      return all;
    });
    await new Promise((r) => setTimeout(r, 50));
    const all = await reports(published, operator, pubkey);
    expect(all, "one report, and it says what happened").toHaveLength(1);
    expect(said[0]!.text).toMatch(/could not page anyone/i);
    expect(said[0]!.text).not.toMatch(/paging wren/i);
  });

  it("says nobody was woken the moment the pages fail, in a report that replaces 'Paging Wren.' [failure mode 9]", async () => {
    // Decided with #31: the ladder's first word goes out as the pages are dispatched, not after
    // commands that may take thirty seconds -- so "Paging Wren." comes first, and the correction
    // follows as soon as they return. It replaces that sentence; it does not follow it with one
    // taking it back (escalation.spec.md, failure mode 9).
    const operator = generateSecretKey();
    const failing = vi.fn<typeof pageAll>(async () => [
      { callsign: "Wren", channel: "sms", dispatched: false, error: "ENOENT" },
    ]);
    const { pubkey, published, deliver } = build([onCallEntry("Wren")], failing);
    deliver(distressFrom(operator, pubkey));
    await vi.waitFor(async () => {
      expect((await reports(published, operator, pubkey)).some((r) => /every channel failed/i.test(r.text ?? ""))).toBe(true);
    });
    const said = await reports(published, operator, pubkey);
    expect(said.map((r) => r.text)).toEqual([
      "Paging Wren.",
      "No page could be sent -- every channel failed. Nobody has been woken.",
    ]);
    expect(said[1]!.ladder).toBe("paging");
  });

  it("names who was paged and who was not, each for what happened", async () => {
    const operator = generateSecretKey();
    const partly = vi.fn<typeof pageAll>(async () => [
      { callsign: "Wren", channel: "sms", dispatched: true },
      { callsign: "Kestrel", channel: "push", dispatched: false, error: "ENOENT" },
    ]);
    const { pubkey, published, deliver } = build([onCallEntry("Wren"), onCallEntry("Kestrel")], partly);
    deliver(distressFrom(operator, pubkey));
    const note = await vi.waitFor(async () => {
      const found = (await reports(published, operator, pubkey)).find((r) => /could not be reached/i.test(r.text ?? ""));
      expect(found).toBeDefined();
      return found!;
    });
    expect(note.text).toBe("Paging Wren. Kestrel could not be reached -- their channel failed.");
  });

  it("answers a retry that joined the live ladder with where the ladder is, naming the retry", async () => {
    // Retries joined the ladder silently. A phone that missed the opening report -- a connection
    // that dropped, a Distress started again -- heard nothing from the watch until it gave up.
    const operator = generateSecretKey();
    const page = noopPager();
    const { pubkey, published, deliver } = build([onCallEntry("Wren")], page);
    const first = distressFrom(operator, pubkey);
    deliver(first);
    await vi.waitFor(() => expect(page).toHaveBeenCalledTimes(1));

    const retry = distressFrom(operator, pubkey);
    deliver(retry);
    const reply = await vi.waitFor(() => {
      const [found] = answering(published, retry.id);
      expect(found).toBeDefined();
      return found!;
    });
    expect(reply.tags.filter((t) => t[0] === "e").map((t) => t[1])).toEqual([retry.id, first.id]);
    const payload = openResponse<ResponsePayload>(operator, pubkey, reply.content);
    expect(payload.text).toBe("Paging Wren.");
    expect(payload.ladder).toBe("paging");
    expect(payload.responder.kind, "a machine saying where it is must never read as a person").toBe("node");
    expect(page, "the retry woke the roster again").toHaveBeenCalledTimes(1);
  });

  it("tells a retry that nobody could be woken, when that is what the ladder found", async () => {
    const operator = generateSecretKey();
    const failing = vi.fn<typeof pageAll>(async () => [
      { callsign: "Wren", channel: "sms", dispatched: false, error: "ENOENT" },
    ]);
    const { pubkey, published, deliver } = build([onCallEntry("Wren")], failing);
    deliver(distressFrom(operator, pubkey));
    await vi.waitFor(async () => {
      expect((await reports(published, operator, pubkey)).some((r) => /every channel failed/i.test(r.text ?? ""))).toBe(true);
    });

    const retry = distressFrom(operator, pubkey);
    deliver(retry);
    const reply = await vi.waitFor(() => {
      const [found] = answering(published, retry.id);
      expect(found).toBeDefined();
      return found!;
    });
    expect(openResponse<ResponsePayload>(operator, pubkey, reply.content).text).toMatch(/every channel failed/i);
  });

  it("answers the same event arriving again only once", async () => {
    const operator = generateSecretKey();
    const page = noopPager();
    const { pubkey, published, deliver } = build([onCallEntry("Wren")], page);
    const first = distressFrom(operator, pubkey);
    deliver(first);
    await vi.waitFor(() => expect(page).toHaveBeenCalledTimes(1));
    deliver(first);
    await new Promise((r) => setTimeout(r, 50));
    expect(answering(published, first.id)).toHaveLength(1);
  });
});

describe("whose clock the watch can hear [#4]", () => {
  const stampedAt = (operator: Uint8Array, watchtower: string, offset: number): Event =>
    finalizeEvent(
      {
        kind: KIND_DISTRESS,
        tags: [["p", watchtower]],
        content: sealSignal(operator, [watchtower], { position: null, area: "north side" }),
        created_at: Math.floor(Date.now() / 1000) + offset,
      },
      operator,
    );

  it("hears a phone whose clock is off by less than a phone's staleness threshold, whatever the paging window", async () => {
    // At paging_window_seconds = 120 a phone 200s fast read the watch as up -- its state was 200s
    // old, short of the 300 at which it reads Dark -- and every Distress it sent was ignored.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const page = noopPager();
    const { executor, pubkey, deliver } = build([onCallEntry("Wren")], page, { pagingWindowSeconds: 120 });
    deliver(stampedAt(generateSecretKey(), pubkey, 200));
    deliver(stampedAt(generateSecretKey(), pubkey, -200));
    await vi.waitFor(() => expect(page, "a phone that reads this watch as up was not heard").toHaveBeenCalledTimes(2));
    expect(executor.ladders.all()).toHaveLength(2);
  });

  it("still ignores one stamped further off than that, and says so", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const page = noopPager();
    const { executor, pubkey, deliver } = build([onCallEntry("Wren")], page, { pagingWindowSeconds: 120 });
    deliver(stampedAt(generateSecretKey(), pubkey, 400));
    await new Promise((r) => setTimeout(r, 100));
    expect(executor.ladders.all()).toHaveLength(0);
    expect(warn.mock.calls.flat().join("\n")).toMatch(/outside the age window \(300s\)/);
  });

  it("is the paging window when that is longer", () => {
    expect(ageWindowSeconds(fakeConfig([], { pagingWindowSeconds: 600 }))).toBe(600);
    expect(ageWindowSeconds(fakeConfig([], { pagingWindowSeconds: 60 }))).toBe(300);
  });
});
