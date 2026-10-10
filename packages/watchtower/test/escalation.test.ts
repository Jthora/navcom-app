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

/**
 * A pager whose every command exits zero, reported as `pageAll` reports it: one result per entry
 * that is not `console-open`. `fails` names callsigns whose channels exit non-zero instead.
 */
const workingPager = (fails: string[] = []) =>
  vi.fn<typeof pageAll>(async (roster) =>
    roster
      .filter((e) => e.declaration.channel !== "console-open")
      .map((e) => {
        const callsign = e.declaration.author.callsign ?? "unnamed";
        return fails.includes(callsign)
          ? { callsign, channel: e.declaration.channel, dispatched: false, error: "exit 1" }
          : { callsign, channel: e.declaration.channel, dispatched: true };
      }),
  );

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

/** The accountability log's entries, as action/outcome/subject. */
const logged = (logPath: string) =>
  readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean)
    .map((l) => JSON.parse(l) as { action: string; outcome: string; subject: { pubkey?: string; callsign?: string } | null });

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
   * attempt with the acknowledgement it already has, and wakes nobody on the roster but the person
   * who gave it.
   */
  async function acknowledged(
    opts: {
      page?: ReturnType<typeof noopPager>;
      /** The roster, given the key the person who acknowledges answers with. Wren alone by default. */
      oncall?: (wren: string) => OnCallEntry[];
      over?: Partial<EscalationConfig["escalation"]>;
    } = {},
  ) {
    const operator = generateSecretKey();
    const responder = generateSecretKey();
    const page = opts.page ?? workingPager();
    const ctx = build(opts.oncall?.(getPublicKey(responder)) ?? [onCallEntry("Wren", getPublicKey(responder))], page, opts.over);
    const first = distressFrom(operator, ctx.pubkey);
    ctx.deliver(first);
    await vi.waitFor(() => expect(page).toHaveBeenCalledTimes(1));
    ctx.deliver(ackFrom(responder, ctx.pubkey, first.id));
    await vi.waitFor(() => expect(ctx.executor.ladders.get(first.id)?.state).toBe("acknowledged"));
    return { ...ctx, operator, responder, page, first };
  }

  it("re-sends the acknowledgement to the new attempt, and pages the person who gave it and nobody else", async () => {
    const raven = getPublicKey(generateSecretKey());
    const { executor, pubkey, published, deliver, page, operator } = await acknowledged({
      oncall: (wren) => [onCallEntry("Wren", wren), onCallEntry("Raven", raven)],
    });

    // A fresh event, as the client signs one per attempt.
    const again = distressFrom(operator, pubkey);
    deliver(again);

    await vi.waitFor(() => expect(answering(published, again.id)).toHaveLength(1));
    await vi.waitFor(() => expect(page).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 100));
    expect(page, "paged once for the attempt, and only once").toHaveBeenCalledTimes(2);
    const [roster, message, , id, kind, attempt] = page.mock.calls[1]!;
    expect(roster.map((e) => e.declaration.author.callsign), "the roster was woken again for a Distress somebody is answering").toEqual(["Wren"]);
    // Not opening with "Distress": the first word is what is read at 3am, and this is not a new one.
    expect(message).toMatch(
      /^NavCom REPEAT -- an operator you acknowledged sent Distress again: [0-9a-f]{8} \(less than a minute after you acknowledged\)\. /,
    );
    expect(message).not.toMatch(/nobody else/i);
    // An acknowledgement naming this attempt finds no ladder, so a page offering one would be a lie.
    expect(id, "a one-tap acknowledgement that answers nothing").toBe("");
    // A repeat, carrying the attempt under its own placeholder: what "wake the others" names.
    expect(kind).toBe("repeat");
    expect(attempt).toBe(again.id);
    expect(executor.ladders.all(), "a new ladder opened").toHaveLength(1);

    const [reply] = answering(published, again.id);
    const payload = openResponse<ResponsePayload>(operator, pubkey, reply!.content);
    // Authored by the human who acknowledged: that is what ends the phone's retry.
    expect(payload.type).toBe("ack");
    expect(payload.responder.kind).toBe("human");
    expect(payload.responder.callsign).toBe("Wren");
    expect(payload.ladder).toBe("acknowledged");
    // Only what this process knows, whether the phone missed the answer or this is a new emergency
    // [review: D2, #0, relay paths R2]: when it was acknowledged, that the person who did is being
    // paged about this attempt, and when the watch treats an attempt as new -- with Raven on call, one
    // re-page interval from this page, when the next attempt widens to the roster (*Silence widens*).
    expect(payload.text).toBe(
      "Acknowledged less than a minute ago. The watch is paging Wren again about this one. " +
        "If your phone is still sending in 5 min, the watch treats it as new.",
    );
    // "Nobody else has been paged" is false wherever a keyless pager runs, which pages for a
    // Distress it cannot know was answered; "your phone sent another" called a new emergency a
    // duplicate; "has not escalated" stopped being the whole truth once the person is paged.
    expect(payload.text).not.toMatch(/is responding|nobody else|nobody has been told|paged nobody|sent another|not escalated/i);
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
      // Each send says what is true as it goes: the page was going out, and then it had -- and when
      // Wren can be paged again.
      expect(openResponse<ResponsePayload>(operator, pubkey, two!.content).text).toMatch(
        /^Acknowledged less than a minute ago\. Wren was paged again about this one less than a minute ago, and is paged again if your phone is still sending in 5 min\. /,
      );
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
      expect(page, "Wren, paged again about the attempt the hold answered, and the roster not").toHaveBeenCalledTimes(2);
      expect(page.mock.calls[1]![0].map((e) => e.declaration.author.callsign)).toEqual(["Wren"]);

      const next = distressFrom(operator, pubkey);
      deliver(next);
      await vi.waitFor(() => expect(page, "the hold went on paging nobody").toHaveBeenCalledTimes(3));
      expect(executor.ladders.get(next.id)?.distressId, "no ladder of its own").toBe(next.id);
    } finally {
      vi.useRealTimers();
    }
  });

  it("goes on holding when only the first send is refused, and wakes nobody but the person who acknowledged [review: relay paths, R2]", async () => {
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
      // Wren is paged once about the attempts, as decided; the roster, which ending the hold here
      // used to page, is not.
      expect(page).toHaveBeenCalledTimes(2);
      expect(page.mock.calls[1]![0].map((e) => e.declaration.author.callsign)).toEqual(["Wren"]);
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
      // Wren once, about the first of the three: the rest fall inside the paging window.
      expect(page).toHaveBeenCalledTimes(2);
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
    expect(page, "Wren, and nobody else").toHaveBeenCalledTimes(2);
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

  describe("the person who acknowledged, paged about it (decided 2026-10-07)", () => {
    /*
     * The hold's cost was that a genuinely new emergency from the same operator inside the window
     * was read as the old one and nobody was told -- not even the person who had answered. They are
     * paged now, through their own entries, and nobody else is. Somebody who cannot be paged is not
     * holding anything: the hold ends and the attempt is escalated as new, saying why.
     */
    const said = (published: Event[], operator: Uint8Array, watch: string, id: string) =>
      answering(published, id).map((e) => openResponse<ResponsePayload>(operator, watch, e.content));
    const real = Date.now.bind(Date);
    const expiring = (callsign: string, pubkey: string, inSeconds: number): OnCallEntry => {
      const entry = onCallEntry(callsign, pubkey);
      return { ...entry, declaration: { ...entry.declaration, expires: Math.floor(Date.now() / 1000) + inSeconds } };
    };

    it("pages every one of their own entries that can wake them, and nobody else's", async () => {
      const raven = getPublicKey(generateSecretKey());
      const { pubkey, deliver, page, operator } = await acknowledged({
        oncall: (wren) => [
          onCallEntry("Wren", wren, "sms"),
          onCallEntry("Raven", raven, "sms"),
          onCallEntry("Wren", wren, "push"),
          onCallEntry("Wren", wren, "console-open"),
        ],
      });
      deliver(distressFrom(operator, pubkey));
      await vi.waitFor(() => expect(page).toHaveBeenCalledTimes(2));
      expect(page.mock.calls[1]![0].map((e) => `${e.declaration.author.callsign} ${e.declaration.channel}`)).toEqual([
        "Wren sms",
        "Wren push",
      ]);
    });

    it("pages them once per paging window, and tells a later attempt inside it when", async () => {
      // A phone retries every 20 to 80 seconds. Paged on every one, the person who answered is the
      // one being worn out.
      const { pubkey, published, deliver, page, operator } = await acknowledged();
      deliver(distressFrom(operator, pubkey));
      await vi.waitFor(() => expect(page).toHaveBeenCalledTimes(2));

      const clock = vi.spyOn(Date, "now").mockImplementation(() => real() + 120_000);
      const later = distressFrom(operator, pubkey);
      deliver(later);
      await vi.waitFor(() => expect(said(published, operator, pubkey, later.id)).toHaveLength(1));
      expect(said(published, operator, pubkey, later.id)[0]!.text).toBe(
        "Acknowledged 2 min ago. Wren was paged again 2 min ago, and is paged again if your phone is still sending in 3 min. " +
          "If your phone is still sending in 28 min, the watch treats it as new.",
      );
      await new Promise((r) => setTimeout(r, 50));
      expect(page, "paged again inside the paging window").toHaveBeenCalledTimes(2);

      clock.mockImplementation(() => real() + 301_000);
      const after = distressFrom(operator, pubkey);
      deliver(after);
      await vi.waitFor(() => expect(page, "never paged again once the window had passed").toHaveBeenCalledTimes(3));
      expect(page.mock.calls[2]![0].map((e) => e.declaration.author.callsign)).toEqual(["Wren"]);
      expect(said(published, operator, pubkey, after.id)[0]!.text).toBe(
        "Acknowledged 5 min ago. The watch is paging Wren again about this one. If your phone is still sending in 25 min, the watch treats it as new.",
      );
    });

    it("says in its own output that it paged them only when it did", async () => {
      // The executor's output said "paging Wren alone" for every held attempt, before anything was
      // decided -- and most of them, inside the window, page nobody [review: hold decisions].
      const { pubkey, published, deliver, page, operator } = await acknowledged();
      const log = vi.spyOn(console, "log");
      deliver(distressFrom(operator, pubkey));
      await vi.waitFor(() => expect(page).toHaveBeenCalledTimes(2));
      const paging = log.mock.calls.map((c) => String(c[0]));

      log.mockClear();
      const inside = distressFrom(operator, pubkey);
      deliver(inside);
      await vi.waitFor(() => expect(said(published, operator, pubkey, inside.id)).toHaveLength(1));
      const lines = log.mock.calls.map((c) => String(c[0]));
      expect(lines.filter((l) => /paging Wren/.test(l)), "said it was paging somebody it did not").toEqual([]);
      expect(lines.some((l) => /Wren was paged about [0-9a-f]{8} \d+s ago -- not again/.test(l))).toBe(true);
      // And where it does page them, it says so, once.
      expect(paging.filter((l) => /^\[page\] paging Wren again/.test(l))).toHaveLength(1);
    });

    it("tells an attempt while the page is still going out that it is, and pages nobody again", async () => {
      let release: () => void = () => {};
      const working = workingPager();
      const page = vi.fn<typeof pageAll>(async (roster, ...rest) => {
        if (page.mock.calls.length === 2) await new Promise<void>((r) => (release = r));
        return working(roster, ...rest);
      });
      const { pubkey, published, deliver, operator } = await acknowledged({ page });
      deliver(distressFrom(operator, pubkey));
      await vi.waitFor(() => expect(page).toHaveBeenCalledTimes(2));

      const meanwhile = distressFrom(operator, pubkey);
      deliver(meanwhile);
      await vi.waitFor(() => expect(said(published, operator, pubkey, meanwhile.id)).toHaveLength(1));
      expect(said(published, operator, pubkey, meanwhile.id)[0]!.text).toBe(
        "Acknowledged less than a minute ago. The watch is paging Wren again. If your phone is still sending in 30 min, the watch treats it as new.",
      );
      expect(page).toHaveBeenCalledTimes(2);
      release();
    });

    it("records the page as contact with the person paged, not with the operator", async () => {
      const { pubkey, published, deliver, operator, responder, logPath } = await acknowledged();
      const again = distressFrom(operator, pubkey);
      deliver(again);
      await vi.waitFor(() => expect(answering(published, again.id)).toHaveLength(1));
      await vi.waitFor(() =>
        expect(logged(logPath).filter((e) => e.action === "contacted")).toEqual([
          expect.objectContaining({
            outcome: "contact-attempted",
            subject: expect.objectContaining({ pubkey: getPublicKey(responder), callsign: "Wren" }),
          }),
        ]),
      );
      // The operator reading their own record would be told the watch contacted them.
      const { log } = AccountabilityLog.open(logPath, 90);
      expect(log.about(getPublicKey(operator)).map((e) => e.action)).not.toContain("contacted");
    });

    it("escalates the attempt as new when every channel of theirs fails, and says so", async () => {
      const raven = getPublicKey(generateSecretKey());
      const { executor, pubkey, published, deliver, page, operator, responder, logPath } = await acknowledged({
        page: workingPager(["Wren"]),
        oncall: (wren) => [onCallEntry("Wren", wren), onCallEntry("Raven", raven)],
      });
      const again = distressFrom(operator, pubkey);
      deliver(again);

      // The roster, paged for this attempt with its own id, once Wren's page came back failed.
      await vi.waitFor(() => expect(page).toHaveBeenCalledTimes(3));
      expect(page.mock.calls[1]![0].map((e) => e.declaration.author.callsign)).toEqual(["Wren"]);
      expect(page.mock.calls[2]![0].map((e) => e.declaration.author.callsign)).toEqual(["Wren", "Raven"]);
      expect(page.mock.calls[2]![3]).toBe(again.id);
      expect(executor.ladders.get(again.id)?.distressId, "no ladder of its own").toBe(again.id);

      await vi.waitFor(() => expect(said(published, operator, pubkey, again.id)).toHaveLength(3));
      const [held, opened, corrected] = said(published, operator, pubkey, again.id);
      // Said while it went out, as "Paging Wren." is; corrected the moment it failed.
      expect(held!.responder.kind).toBe("human");
      expect(held!.text).toMatch(/^Acknowledged less than a minute ago\. The watch is paging Wren again about this one\. /);
      expect(opened!.responder.kind, "a machine's report read as a person").toBe("node");
      expect(opened!.ladder).toBe("paging");
      expect(opened!.text).toBe("Wren could not be paged again -- every channel failed. Paging Wren, Raven.");
      expect(corrected!.text).toBe("Paging Raven. Wren could not be reached -- their channel failed.");
      expect(logged(logPath).filter((e) => e.action === "contacted")).toEqual([
        expect.objectContaining({ outcome: "contact-failed", subject: expect.objectContaining({ pubkey: getPublicKey(responder) }) }),
      ]);

      // The hold is over: the next attempt joins the ladder, and is told where it is.
      const next = distressFrom(operator, pubkey);
      deliver(next);
      await vi.waitFor(() => expect(said(published, operator, pubkey, next.id)).toHaveLength(1));
      const [joined] = said(published, operator, pubkey, next.id);
      expect(joined!.responder.kind, "answered from a hold that had ended").toBe("node");
      expect(joined!.text).toBe("Paging Raven. Wren could not be reached -- their channel failed.");
      expect(executor.ladders.get(next.id)?.distressId).toBe(again.id);
      expect(page).toHaveBeenCalledTimes(3);
    });

    it("escalates the attempt as new when they are no longer on call, before anything is sent", async () => {
      const raven = getPublicKey(generateSecretKey());
      const { executor, pubkey, published, deliver, page, operator, logPath } = await acknowledged({
        oncall: (wren) => [expiring("Wren", wren, 60), onCallEntry("Raven", raven)],
      });
      vi.spyOn(Date, "now").mockImplementation(() => real() + 120_000);
      const again = distressFrom(operator, pubkey);
      deliver(again);

      await vi.waitFor(() => expect(said(published, operator, pubkey, again.id)).toHaveLength(2));
      const [held, opened] = said(published, operator, pubkey, again.id);
      expect(held!.responder.callsign).toBe("Wren");
      expect(held!.text).toBe(
        "Acknowledged 2 min ago. Wren could not be paged again -- no longer on call. The watch is paging Raven about this one.",
      );
      expect(opened!.responder.kind).toBe("node");
      expect(opened!.text).toBe("Wren could not be paged again -- no longer on call. Paging Raven.");
      await vi.waitFor(() => expect(page).toHaveBeenCalledTimes(2));
      expect(page.mock.calls[1]![3], "the roster was paged without the attempt's id").toBe(again.id);
      // Told Raven, and Wren's expired entry paged all the same [review: hold decisions].
      expect(page.mock.calls[1]![0].map((e) => e.declaration.author.callsign), "paged somebody the operator was told was not").toEqual(["Raven"]);
      expect(executor.ladders.get(again.id)?.distressId).toBe(again.id);
      expect(logged(logPath).filter((e) => e.action === "contacted")).toEqual([
        expect.objectContaining({ outcome: "contact-not-attempted" }),
      ]);
    });

    it("tells the operator nobody is coming when nobody else is on call either", async () => {
      const { executor, pubkey, published, deliver, page, operator, logPath } = await acknowledged({
        oncall: (wren) => [expiring("Wren", wren, 60)],
      });
      vi.spyOn(Date, "now").mockImplementation(() => real() + 120_000);
      const again = distressFrom(operator, pubkey);
      deliver(again);

      await vi.waitFor(() => expect(said(published, operator, pubkey, again.id)).toHaveLength(2));
      const [held, opened] = said(published, operator, pubkey, again.id);
      expect(held!.text).toBe(
        "Acknowledged 2 min ago. Wren could not be paged again -- no longer on call. Nobody on call can be paged about this one.",
      );
      expect(opened!.ladder).toBe("exhausted");
      expect(opened!.text).toBe(
        "Wren could not be paged again -- no longer on call. Couldn't reach anyone, and you have no emergency contact set. Nobody is coming.",
      );
      expect(executor.ladders.get(again.id)?.state).toBe("exhausted");
      expect(page).toHaveBeenCalledTimes(1);
      expect(logged(logPath).filter((e) => e.action === "escalated").map((e) => e.outcome)).toContain("escalation-reached-nobody");
    });

    it("escalates the attempt as new when they can only be reached at a console, and does not name them as paged", async () => {
      // console-open is not a channel anybody asleep hears [C40]. A ladder names a console-open entry
      // among those it pages and runs no command for it, so beside "only reachable at a console",
      // "Paging Wren, Raven." told the operator Wren both could not be paged and was being paged
      // [review: hold decisions].
      const raven = getPublicKey(generateSecretKey());
      const { pubkey, published, deliver, page, operator } = await acknowledged({
        oncall: (wren) => [onCallEntry("Wren", wren, "console-open"), onCallEntry("Raven", raven)],
      });
      const again = distressFrom(operator, pubkey);
      deliver(again);
      await vi.waitFor(() => expect(said(published, operator, pubkey, again.id)).toHaveLength(2));
      const [held, opened] = said(published, operator, pubkey, again.id);
      expect(held!.text).toBe(
        "Acknowledged less than a minute ago. Wren could not be paged again -- only reachable at a console. " +
          "The watch is paging Raven about this one.",
      );
      expect(opened!.text).toBe("Wren could not be paged again -- only reachable at a console. Paging Raven.");
      await vi.waitFor(() => expect(page).toHaveBeenCalledTimes(2));
      expect(page.mock.calls[1]![3]).toBe(again.id);
      // Raven is the one a command runs for.
      const ran = (await page.mock.results[1]!.value) as Awaited<ReturnType<typeof pageAll>>;
      expect(ran.map((r) => r.callsign)).toEqual(["Raven"]);

      // A later attempt joins that ladder and is told the same.
      const next = distressFrom(operator, pubkey);
      deliver(next);
      await vi.waitFor(() => expect(said(published, operator, pubkey, next.id)).toHaveLength(1));
      expect(said(published, operator, pubkey, next.id)[0]!.text).toBe(opened!.text);
    });

    it("pages them no more often than once in five minutes, however short the paging window", async () => {
      // A Stationkeeper who shortened the paging window to reach "nobody is coming" sooner, as the
      // example config invites. A phone resends every 80 seconds at its steadiest, so a 60-second
      // window paged the person who answered on every attempt for the whole hold, and spent the
      // watch's page budget doing it [review: hold decisions].
      const { pubkey, published, deliver, page, operator } = await acknowledged({ over: { pagingWindowSeconds: 60 } });
      const clock = vi.spyOn(Date, "now");
      for (const offset of [0, 80, 160, 240]) {
        clock.mockImplementation(() => real() + offset * 1000);
        const attempt = distressFrom(operator, pubkey);
        deliver(attempt);
        await vi.waitFor(() => expect(said(published, operator, pubkey, attempt.id)).toHaveLength(1));
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(page, "paged again on an attempt inside five minutes of the last page").toHaveBeenCalledTimes(2);

      clock.mockImplementation(() => real() + 301_000);
      const later = distressFrom(operator, pubkey);
      deliver(later);
      await vi.waitFor(() => expect(page).toHaveBeenCalledTimes(3));
      expect(page.mock.calls[2]![0].map((e) => e.declaration.author.callsign)).toEqual(["Wren"]);
    });

    it("pages them once per window for that operator, even when a newer acknowledgement has replaced the hold", async () => {
      // A hold ended -- every relay refused its answers -- and the next attempt opened a ladder that
      // paged the roster. The same person answered that one, and the operator's next attempt, seconds
      // later, paged them again: three pages inside one window [review: hold decisions].
      const { executor, pubkey, published, relay, deliver, page, operator, responder } = await acknowledged();
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        relay.refuses = (e) => e.kind === KIND_RESPONSE;
        const a = distressFrom(operator, pubkey);
        deliver(a);
        await vi.waitFor(() => expect(page).toHaveBeenCalledTimes(2));
        await vi.advanceTimersByTimeAsync(RESEND_AGAIN_SECONDS * 1000);
        await vi.waitFor(() => expect(answering(published, a.id)).toHaveLength(2));
        relay.refuses = () => false;

        // The hold is over: a ladder of its own, the roster paged.
        const b = distressFrom(operator, pubkey);
        deliver(b);
        await vi.waitFor(() => expect(page).toHaveBeenCalledTimes(3));
        expect(page.mock.calls[2]![3]).toBe(b.id);
        deliver(ackFrom(responder, pubkey, b.id));
        await vi.waitFor(() => expect(executor.ladders.get(b.id)?.state).toBe("acknowledged"));

        const c = distressFrom(operator, pubkey);
        deliver(c);
        await vi.waitFor(() => expect(said(published, operator, pubkey, c.id)).toHaveLength(1));
        await vi.advanceTimersByTimeAsync(50);
        expect(page, "paged again about the same operator inside one window").toHaveBeenCalledTimes(3);
        const [held] = said(published, operator, pubkey, c.id);
        expect(held!.responder.kind).toBe("human");
        expect(held!.text).toBe(
          "Acknowledged less than a minute ago. Wren was paged again less than a minute ago, and is paged again if your " +
            "phone is still sending in 5 min. If your phone is still sending in 30 min, the watch treats it as new.",
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("pages them again when the clock steps back past the page, failing toward paging", async () => {
      // Back past the page but not past the acknowledgement, so the hold stands. A page stamped in
      // the future held every page after it back for the rest of the hold.
      const { pubkey, published, deliver, page, operator } = await acknowledged();
      const clock = vi.spyOn(Date, "now").mockImplementation(() => real() + 60_000);
      deliver(distressFrom(operator, pubkey));
      await vi.waitFor(() => expect(page).toHaveBeenCalledTimes(2));

      clock.mockImplementation(() => real() + 30_000);
      const after = distressFrom(operator, pubkey);
      deliver(after);
      await vi.waitFor(() => expect(page, "a page stamped ahead of the clock held this one back").toHaveBeenCalledTimes(3));
      expect(page.mock.calls[2]![0].map((e) => e.declaration.author.callsign)).toEqual(["Wren"]);
      expect(said(published, operator, pubkey, after.id)[0]!.responder.kind, "the hold had ended").toBe("human");
    });

    it.each([
      ["every channel of theirs failed", ["Wren"], "sms"],
      ["they can only be reached at a console", [], "console-open"],
    ] as const)("holds nothing once it has escalated an attempt because %s, after that ladder runs out", async (_why, fails, channel) => {
      // Escalated as new is the hold over. Kept, it answered the operator's next attempt with the old
      // acknowledgement once the escalated ladder had run out, still inside the window: a phone in a
      // new emergency, told a person had it. Nothing tested this, because while that ladder is live
      // every later attempt joins it, hold or none [review: hold decisions].
      const raven = getPublicKey(generateSecretKey());
      const { executor, pubkey, published, deliver, operator } = await acknowledged({
        page: workingPager([...fails]),
        oncall: (wren) => [onCallEntry("Wren", wren, channel), onCallEntry("Raven", raven)],
      });
      const again = distressFrom(operator, pubkey);
      deliver(again);
      await vi.waitFor(() => expect(executor.ladders.get(again.id)?.distressId).toBe(again.id));

      // Nobody answers it, and it runs out five minutes on -- well inside the half hour.
      vi.spyOn(Date, "now").mockImplementation(() => real() + 301_000);
      await vi.waitFor(() => expect(executor.ladders.get(again.id)?.state).toBe("exhausted"), { timeout: 3_000 });

      const next = distressFrom(operator, pubkey);
      deliver(next);
      await vi.waitFor(() => expect(executor.ladders.get(next.id)?.distressId, "no ladder of its own").toBe(next.id));
      await new Promise((r) => setTimeout(r, 50));
      const replies = said(published, operator, pubkey, next.id);
      expect(replies.length).toBeGreaterThan(0);
      expect(replies.map((p) => p.responder.kind), "answered with an acknowledgement the hold had given up").not.toContain("human");
    });

    it("tells an attempt whose page failed where the ladder is, when another attempt opened one meanwhile", async () => {
      // The hold ran out while the page about one attempt was still going out, and the operator's next
      // attempt opened a ladder. When the page failed, the first attempt joined that ladder -- and its
      // last word, otherwise, was that the page was going out [review: hold decisions].
      const raven = getPublicKey(generateSecretKey());
      let fail: () => void = () => {};
      const working = workingPager();
      const page = vi.fn<typeof pageAll>(async (roster, ...rest) => {
        if (page.mock.calls.length !== 2) return working(roster, ...rest);
        await new Promise<void>((r) => (fail = r));
        return roster.map((e) => ({ callsign: e.declaration.author.callsign ?? "", channel: e.declaration.channel, dispatched: false, error: "exit 1" }));
      });
      const { executor, pubkey, published, deliver, operator } = await acknowledged({
        page,
        oncall: (wren) => [onCallEntry("Wren", wren), onCallEntry("Raven", raven)],
      });
      const clock = vi.spyOn(Date, "now").mockImplementation(() => real() + 1_790_000);
      const slow = distressFrom(operator, pubkey);
      deliver(slow);
      await vi.waitFor(() => expect(page).toHaveBeenCalledTimes(2));

      clock.mockImplementation(() => real() + 1_801_000);
      const next = distressFrom(operator, pubkey);
      deliver(next);
      await vi.waitFor(() => expect(page).toHaveBeenCalledTimes(3));
      expect(executor.ladders.get(next.id)?.distressId).toBe(next.id);

      fail();
      await vi.waitFor(() => expect(answering(published, slow.id)).toHaveLength(2));
      const last = answering(published, slow.id).at(-1)!;
      const told = openResponse<ResponsePayload>(operator, pubkey, last.content);
      expect(told.responder.kind).toBe("node");
      expect(told.ladder).toBe("paging");
      expect(last.tags.filter((t) => t[0] === "e").map((t) => t[1])).toEqual([slow.id, next.id]);
      expect(executor.ladders.get(slow.id)?.distressId).toBe(next.id);
      expect(page, "the roster paged twice for one emergency").toHaveBeenCalledTimes(3);
    });

    it("pages them with the page budget spent: a re-page takes nothing from it, and a spent one ends no hold", async () => {
      // Option E, decided 2026-10-07, replacing "escalates the attempt as new when the page budget is
      // spent". The budget bounds strangers, and a re-page needs a roster key's acknowledgement.
      const { executor, pubkey, published, deliver, page, operator, logPath } = await acknowledged({ over: { maxPagesPerWindow: 1 } });
      const again = distressFrom(operator, pubkey);
      deliver(again);
      await vi.waitFor(() => expect(page, "refused by the first-page budget").toHaveBeenCalledTimes(2));
      await vi.waitFor(() => expect(said(published, operator, pubkey, again.id)).toHaveLength(1));
      const [held] = said(published, operator, pubkey, again.id);
      expect(held!.responder.kind).toBe("human");
      expect(held!.text).toMatch(/^Acknowledged less than a minute ago\. The watch is paging Wren again about this one\. /);
      expect(executor.ladders.get(again.id), "the hold ended over the budget").toBeUndefined();
      await vi.waitFor(() =>
        expect(logged(logPath).filter((e) => e.action === "contacted")).toEqual([
          expect.objectContaining({ outcome: "contact-attempted" }),
        ]),
      );
    });

    it("opens nothing for a page that fails after the executor has stopped", async () => {
      let fail: () => void = () => {};
      const page = vi.fn<typeof pageAll>(async (roster) => {
        if (page.mock.calls.length === 2) {
          await new Promise<void>((r) => (fail = r));
          return roster.map((e) => ({ callsign: e.declaration.author.callsign ?? "", channel: e.declaration.channel, dispatched: false, error: "exit 1" }));
        }
        return roster.map((e) => ({ callsign: e.declaration.author.callsign ?? "", channel: e.declaration.channel, dispatched: true }));
      });
      const { executor, pubkey, published, deliver, operator } = await acknowledged({ page });
      const again = distressFrom(operator, pubkey);
      deliver(again);
      await vi.waitFor(() => expect(page).toHaveBeenCalledTimes(2));
      await executor.stop();
      fail();
      await new Promise((r) => setTimeout(r, 50));
      expect(executor.ladders.get(again.id), "a ladder opened by a stopped executor").toBeUndefined();
      expect(answering(published, again.id)).toHaveLength(1);
      expect(page).toHaveBeenCalledTimes(2);
    });
  });

  describe("a ladder still running for the operator comes before the hold (decided 2026-10-07)", () => {
    it("joins the attempt to that ladder rather than answering it from the hold, and pages nobody", async () => {
      // A late answer to a ladder that ran out, while a second ladder for the same operator is still
      // paging. Answered from the hold, the attempt was told a person had it while the roster was
      // still being paged, and named a ladder nobody was running.
      const operator = generateSecretKey();
      const responder = generateSecretKey();
      const page = workingPager();
      const { executor, pubkey, published, deliver } = build([onCallEntry("Wren", getPublicKey(responder))], page);
      const first = distressFrom(operator, pubkey);
      deliver(first);
      await vi.waitFor(() => expect(page).toHaveBeenCalledTimes(1));

      // Nobody answers, and the ladder runs out.
      const real = Date.now.bind(Date);
      vi.spyOn(Date, "now").mockImplementation(() => real() + 301_000);
      await vi.waitFor(() => expect(executor.ladders.get(first.id)?.state).toBe("exhausted"), { timeout: 3_000 });
      const second = distressFrom(operator, pubkey);
      deliver(second);
      await vi.waitFor(() => expect(page).toHaveBeenCalledTimes(2));
      expect(executor.ladders.get(second.id)?.state).toBe("paging");

      // Wren answers the first, late, from the page she got for it.
      deliver(ackFrom(responder, pubkey, first.id));
      await vi.waitFor(() => expect(executor.ladders.get(first.id)?.state).toBe("acknowledged"));

      const third = distressFrom(operator, pubkey);
      deliver(third);
      const [reply] = await vi.waitFor(() => {
        const found = answering(published, third.id);
        expect(found).toHaveLength(1);
        return found;
      });
      const payload = openResponse<ResponsePayload>(operator, pubkey, reply!.content);
      expect(payload.responder.kind, "answered from the hold while a ladder was paging").toBe("node");
      expect(payload.ladder).toBe("paging");
      expect(payload.text).toBe("Paging Wren.");
      expect(reply!.tags.filter((t) => t[0] === "e").map((t) => t[1])).toEqual([third.id, second.id]);
      expect(executor.ladders.get(third.id)?.distressId, "not joined to the ladder still running").toBe(second.id);
      await new Promise((r) => setTimeout(r, 50));
      expect(page, "the hold paged Wren alone while the roster was being paged").toHaveBeenCalledTimes(2);

      // Once that ladder is answered too, the hold is back -- on the newer answer.
      deliver(ackFrom(responder, pubkey, second.id));
      await vi.waitFor(() => expect(executor.ladders.get(second.id)?.state).toBe("acknowledged"));
      const fourth = distressFrom(operator, pubkey);
      deliver(fourth);
      const [held] = await vi.waitFor(() => {
        const found = answering(published, fourth.id);
        expect(found).toHaveLength(1);
        return found;
      });
      expect(openResponse<ResponsePayload>(operator, pubkey, held!.content).responder.kind).toBe("human");
      expect(held!.tags.filter((t) => t[0] === "e").map((t) => t[1])).toEqual([fourth.id, second.id]);
      await vi.waitFor(() => expect(page).toHaveBeenCalledTimes(3));
      expect(page.mock.calls[2]![0].map((e) => e.declaration.author.callsign)).toEqual(["Wren"]);
    });
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
