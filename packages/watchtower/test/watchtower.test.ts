import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SimplePool } from "nostr-tools/pool";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { Event } from "nostr-tools/core";
import { WatchtowerDaemon } from "../src/daemon/watchtower.js";
import type { DaemonConfig } from "../src/daemon/config.js";
import { sealSignal, openSignal, openResponse } from "../src/shared/crypto.js";
import { KIND_SIGNAL, KIND_DISTRESS, KIND_RESPONSE, KIND_WATCH_STATE } from "../src/shared/kinds.js";
import type { ResponsePayload, WatchStatePayload } from "../src/shared/payloads.js";
import * as authorization from "../src/daemon/authorization.js";
import * as query from "../src/daemon/query.js";
import { AccountabilityLog } from "../src/shared/accountability.js";
import { verifyInclusion } from "@navcom/core";

/**
 * The one file with zero direct test coverage before this pass, despite
 * being where every other piece (board, validation, authorization,
 * crypto, the query timeout) actually gets wired together and dispatched.
 * A real, injectable fake SimplePool (see WatchtowerDaemonOptions.pool)
 * makes this possible without a network connection.
 */
function fakeConfig(
  overrides: Partial<DaemonConfig["watch"]> = {},
  allowedPubkeys: string[] = [],
  escalationLogPath: string | null = null,
): DaemonConfig {
  return {
    identity: { privkeyPath: "/dev/null" },
    relays: { urls: ["wss://fake.relay"] },
    watch: {
      routineIntervalDefault: 3600,
      overdueGrace: 1800,
      hardExpiry: 14400,
      heartbeatIntervalSeconds: 3600, // long, so it never fires mid-test
      sweepIntervalSeconds: 3600,
      queryTimeoutSeconds: 8,
      ...overrides,
    },
    authorization: { allowedPubkeys },
    // Tests that care about the log inject an AccountabilityLog directly; this path is
    // never opened, so a daemon built from fakeConfig records nothing.
    log: { path: "/dev/null", retentionDays: 90, drillStatePath: "/dev/null/nope", escalationLogPath },
  };
}

function fakePool() {
  const publishedEvents: Event[] = [];
  let onEvent: ((event: Event) => void) | undefined;
  const pool = {
    publish: (relays: string[], event: Event) => {
      publishedEvents.push(event);
      return relays.map(() => Promise.resolve("ok"));
    },
    subscribeMany: (_relays: string[], _filter: unknown, params: { onevent: (e: Event) => void }) => {
      onEvent = params.onevent;
      return { close: () => {} };
    },
    destroy: () => {},
  } as unknown as SimplePool;
  return {
    pool,
    publishedEvents,
    deliver: (event: Event) => onEvent?.(event),
  };
}

function buildDaemon(
  configOverrides: Partial<DaemonConfig["watch"]> = {},
  allowedPubkeys: string[] = [],
  log?: AccountabilityLog,
  escalationLogPath: string | null = null,
) {
  const secretKey = generateSecretKey();
  const pubkey = getPublicKey(secretKey);
  const { pool, publishedEvents, deliver } = fakePool();
  const daemon = new WatchtowerDaemon({
    config: fakeConfig(configOverrides, allowedPubkeys, escalationLogPath),
    secretKey,
    pubkey,
    pool,
    ...(log ? { log } : {}),
  });
  return { daemon, pubkey, secretKey, publishedEvents, deliver };
}

function signalEvent(
  operatorSecretKey: Uint8Array,
  watchtowerPubkey: string,
  type: string,
  payload: unknown,
): Event {
  const content = sealSignal(operatorSecretKey, [watchtowerPubkey], payload);
  return finalizeEvent(
    { kind: KIND_SIGNAL, tags: [["p", watchtowerPubkey], ["t", type]], content, created_at: Math.floor(Date.now() / 1000) },
    operatorSecretKey,
  );
}

function distressEvent(operatorSecretKey: Uint8Array, watchtowerPubkey: string, text: string | null): Event {
  const content = sealSignal(operatorSecretKey, [watchtowerPubkey], { text });
  return finalizeEvent(
    { kind: KIND_DISTRESS, tags: [["p", watchtowerPubkey]], content, created_at: Math.floor(Date.now() / 1000) },
    operatorSecretKey,
  );
}

async function waitForResponse(publishedEvents: Event[], fromIndex = 0): Promise<Event> {
  await vi.waitFor(() => {
    const found = publishedEvents.slice(fromIndex).find((e) => e.kind === KIND_RESPONSE);
    if (!found) throw new Error("no response published yet");
  });
  return publishedEvents.slice(fromIndex).find((e) => e.kind === KIND_RESPONSE)!;
}

let activeDaemons: WatchtowerDaemon[] = [];
async function started(
  configOverrides: Partial<DaemonConfig["watch"]> = {},
  allowedPubkeys: string[] = [],
  log?: AccountabilityLog,
  escalationLogPath: string | null = null,
) {
  const ctx = buildDaemon(configOverrides, allowedPubkeys, log, escalationLogPath);
  await ctx.daemon.start();
  activeDaemons.push(ctx.daemon);
  return ctx;
}

afterEach(async () => {
  await Promise.all(activeDaemons.map((d) => d.stop()));
  activeDaemons = [];
  vi.restoreAllMocks();
});

describe("what the watch writes down", () => {
  // C33: watch actions are logged and reviewable by the operators they concern. Asserted
  // against a real file, because the value of this log is that it is on disk after a crash.
  let dir: string;
  let opened: AccountabilityLog;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "navcom-daemon-log-"));
    opened = AccountabilityLog.open(join(dir, "log.jsonl"), 90).log;
  });
  afterEach(() => {
    opened.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const outcomes = (pubkey: string) => opened.about(pubkey).map((e) => `${e.action}/${e.outcome}`);

  it("records taking the watch before it starts listening", async () => {
    await started({}, [], opened);
    // Subject is null: this is about the watch, not about an operator.
    expect(opened.all().map((e) => `${e.action}/${e.outcome}`)).toContain("took-watch/held");
  });

  it("records every acknowledgement against the operator it concerns", async () => {
    const { pubkey, deliver, publishedEvents } = await started({}, [], opened);
    const operator = generateSecretKey();
    const operatorPubkey = getPublicKey(operator);

    deliver(signalEvent(operator, pubkey, "on-station", { callsign: "Wren", area: "Downtown", expected_duration: 7200, routine_interval: null, share_position: false, position: null }));
    await waitForResponse(publishedEvents);

    expect(outcomes(operatorPubkey)).toContain("acked/acknowledged");
    // The area was on the wire and must not be in the record.
    expect(JSON.stringify(opened.all())).not.toContain("Downtown");
  });

  it("records an answer as unverified when it carried no provenance", async () => {
    const { pubkey, deliver, publishedEvents } = await started({}, [], opened);
    const operator = generateSecretKey();
    const operatorPubkey = getPublicKey(operator);

    deliver(signalEvent(operator, pubkey, "query", { text: "bed tonight, has a dog" }));
    await waitForResponse(publishedEvents);

    // The client renders this unverified; the log says the same, so the two accounts of
    // the same answer cannot drift apart.
    expect(outcomes(operatorPubkey)).toContain("answered/answered-unverified");
    // And the question itself is not in the record [C27].
    expect(JSON.stringify(opened.all())).not.toContain("dog");
  });

  it("records the contact it attempted on an overdue, and does not claim it landed", async () => {
    /*
     * This test used to assert the opposite, and that was correct at the time.
     *
     * `watch-state.spec.md` requires the node to attempt contact with an overdue operator.
     * It did not, so `agents.md`'s rule that inaction must be logged applied instead, and
     * this pinned `contact-not-attempted` in place — deliberately, with a comment saying it
     * should read badly until it stopped being true. It has now stopped being true.
     *
     * What replaces it is not `contact-made`. Publishing to a relay is not reaching a
     * person: the honest claim is that something was sent and its fate is unknown, which is
     * the same distinction `transport.ts` draws for a Distress that left the device.
     */
    const { pubkey, deliver, publishedEvents } = await started(
      { overdueGrace: 0, sweepIntervalSeconds: 0.01, hardExpiry: 100000 },
      [],
      opened,
    );
    const operator = generateSecretKey();
    const operatorPubkey = getPublicKey(operator);

    deliver(signalEvent(operator, pubkey, "on-station", { callsign: "Wren", area: "Downtown", expected_duration: 1, routine_interval: null, share_position: false, position: null }));
    await waitForResponse(publishedEvents);

    await vi.waitFor(() => {
      expect(outcomes(operatorPubkey)).toContain("contacted/contact-attempted");
    }, { timeout: 5000 });
    expect(outcomes(operatorPubkey)).toContain("marked-overdue/marked-overdue");
    // The overclaim this outcome exists to avoid.
    expect(outcomes(operatorPubkey)).not.toContain("contacted/contact-made");
    expect(outcomes(operatorPubkey)).not.toContain("contacted/contact-not-attempted");
  });

  it("does not claim an escalation outcome it cannot know (found in robustness audit)", async () => {
    // The daemon receives the 20911 but does not run the ladder -- a separate process, the
    // executor, does that and is the only party that knows the true outcome. This used to
    // write "escalation-not-attempted" here unconditionally, from before the ladder
    // existed; left in place after the ladder shipped, it permanently misrepresented every
    // Distress as unescalated even after a human acknowledged in seconds. See
    // shared/accountability.ts and the executor's own log.
    const { pubkey, deliver, publishedEvents } = await started({}, [], opened);
    const operator = generateSecretKey();
    const operatorPubkey = getPublicKey(operator);

    deliver(distressEvent(operator, pubkey, "help"));
    await waitForResponse(publishedEvents);

    expect(outcomes(operatorPubkey)).not.toContain("escalated/escalation-not-attempted");
    expect(outcomes(operatorPubkey)).not.toContain("escalated/escalation-reached-nobody");
  });

  it("publishes a root an operator can verify their own entries against", async () => {
    // The point of the whole exercise: C33 reviewable rather than promised. The operator
    // checks their entries against a root the watch published, holding sibling hashes and
    // nothing about anybody else.
    const { pubkey, deliver, publishedEvents } = await started({}, [], opened);
    const a = generateSecretKey();
    const b = generateSecretKey();

    deliver(signalEvent(a, pubkey, "on-station", { callsign: "Wren", area: "North", expected_duration: 7200, routine_interval: null, share_position: false, position: null }));
    await waitForResponse(publishedEvents);
    deliver(signalEvent(b, pubkey, "on-station", { callsign: "Raven", area: "South", expected_duration: 7200, routine_interval: null, share_position: false, position: null }));
    await waitForResponse(publishedEvents, 1);

    const review = opened.reviewFor(getPublicKey(a));
    expect(review.entries.length).toBeGreaterThan(0);
    for (const { entry, proof } of review.entries) {
      expect(verifyInclusion(entry, proof, review.root)).toBe(true);
    }
    // What the operator receives says nothing about the other operator.
    expect(JSON.stringify(review)).not.toContain(getPublicKey(b));
  });

  it("publishes a root that matches the log it has actually written", async () => {
    // A published root that drifted from the entries would be the most misleading value in
    // the system: a signed statement about a log that is not the log.
    //
    // Heartbeat forced short here on purpose. The root is a CHECKPOINT, republished on the
    // heartbeat rather than on every entry, so an entry written seconds ago is genuinely
    // not covered by the currently-published root -- see the next test.
    const { pubkey, deliver, publishedEvents } = await started({ heartbeatIntervalSeconds: 0.05 }, [], opened);
    const operator = generateSecretKey();

    deliver(signalEvent(operator, pubkey, "routine", {}));
    await waitForResponse(publishedEvents);

    await vi.waitFor(() => {
      const states = publishedEvents.filter((e) => e.kind === KIND_WATCH_STATE);
      const latest = JSON.parse(states[states.length - 1]!.content) as WatchStatePayload;
      expect(latest.log_root).not.toBeNull();
      expect(latest.log_root!.size).toBe(opened.all().length);
      expect(latest.log_root!.root).toBe(opened.root(latest.log_root!.at).root);
    });
  });

  it("does not cover an entry written since the last checkpoint, and says so by size", async () => {
    // Inherent to checkpointing, and the honest handling is that a proof carries the tree
    // size it was made against. An operator holding an older root can verify their entries
    // up to that size and no further -- rather than being told a fresh entry is unverifiable
    // when it is simply not yet committed to.
    const { pubkey, deliver, publishedEvents } = await started({}, [], opened);
    const operator = generateSecretKey();

    const states = () => publishedEvents.filter((e) => e.kind === KIND_WATCH_STATE);
    const publishedRoot = JSON.parse(states()[0]!.content) as WatchStatePayload;
    const sizeAtStart = publishedRoot.log_root!.size;

    deliver(signalEvent(operator, pubkey, "routine", {}));
    await waitForResponse(publishedEvents);

    await vi.waitFor(() => {
      expect(opened.all().length).toBeGreaterThan(sizeAtStart);
    });
    // The new entry exists, and the published checkpoint does not yet cover it.
    expect(publishedRoot.log_root!.size).toBe(sizeAtStart);
  });

  it("publishes no drill when the executor has never written one", async () => {
    // Null, a missing file and an unreadable one all mean the same thing to a client: this
    // watch has not demonstrated that it can raise anyone. publishableWatchState then
    // demotes automated-oncall, without anything here having to decide it.
    const { publishedEvents } = await started();
    const state = publishedEvents.find((e) => e.kind === KIND_WATCH_STATE)!;
    const payload = JSON.parse(state.content) as WatchStatePayload;
    expect(payload.last_drill).toBeNull();
  });

  it("publishes a null root when it keeps no log, rather than omitting the field", async () => {
    // "This watch commits to nothing" is a fact an operator should be able to read.
    const { publishedEvents } = await started();
    const state = publishedEvents.find((e) => e.kind === KIND_WATCH_STATE)!;
    const payload = JSON.parse(state.content) as WatchStatePayload;
    expect(payload).toHaveProperty("log_root");
    expect(payload.log_root).toBeNull();
  });

  it("answers a log-review with only the asker's own entries", async () => {
    const { pubkey, deliver, publishedEvents } = await started({}, [], opened);
    const a = generateSecretKey();
    const b = generateSecretKey();

    deliver(signalEvent(a, pubkey, "on-station", { callsign: "Wren", area: "North", expected_duration: 7200, routine_interval: null, share_position: false, position: null }));
    await waitForResponse(publishedEvents);
    deliver(signalEvent(b, pubkey, "on-station", { callsign: "Raven", area: "South", expected_duration: 7200, routine_interval: null, share_position: false, position: null }));
    await waitForResponse(publishedEvents, 1);

    const before = publishedEvents.length;
    deliver(signalEvent(a, pubkey, "log-review", {}));
    const responseEvent = await waitForResponse(publishedEvents, before);
    const payload = openResponse<ResponsePayload>(a, pubkey, responseEvent.content);

    expect(payload.type).toBe("log-review");
    expect(payload.review).toBeDefined();
    expect(payload.review!.entries.length).toBeGreaterThan(0);
    for (const { entry } of payload.review!.entries) {
      expect(entry.subject?.pubkey).toBe(getPublicKey(a));
    }
    // Nothing about the other operator crosses, not even in a sibling hash's neighbourhood.
    expect(JSON.stringify(payload.review)).not.toContain(getPublicKey(b));
  });

  it("hands back proofs that verify against the root it published", async () => {
    const { pubkey, deliver, publishedEvents } = await started({}, [], opened);
    const a = generateSecretKey();

    deliver(signalEvent(a, pubkey, "routine", {}));
    await waitForResponse(publishedEvents);

    const before = publishedEvents.length;
    deliver(signalEvent(a, pubkey, "log-review", {}));
    const responseEvent = await waitForResponse(publishedEvents, before);
    const { review } = openResponse<ResponsePayload>(a, pubkey, responseEvent.content);

    for (const { entry, proof } of review!.entries) {
      expect(verifyInclusion(entry, proof, review!.root)).toBe(true);
    }
  });

  it("includes the escalation executor's own log in a review, when configured (log-review merge)", async () => {
    const a = generateSecretKey();
    const aPubkey = getPublicKey(a);

    // A separate file, standing in for the executor's own accountability log -- written
    // directly here, the way the executor itself writes to it, entirely independent of
    // this daemon's own `opened` log.
    const escalationDir = mkdtempSync(join(tmpdir(), "navcom-escalation-log-"));
    const escalationPath = join(escalationDir, "escalation-log.jsonl");
    const escalationLog = AccountabilityLog.open(escalationPath, 90).log;
    escalationLog.record({
      at: 1_000,
      actor: { kind: "node", callsign: "escalation" },
      action: "escalated",
      subject: { kind: "human", pubkey: aPubkey },
      outcome: "escalation-reached-human",
    });
    escalationLog.close();

    try {
      const { pubkey, deliver, publishedEvents } = await started({}, [], opened, escalationPath);
      deliver(signalEvent(a, pubkey, "log-review", {}));
      const responseEvent = await waitForResponse(publishedEvents);
      const { review } = openResponse<ResponsePayload>(a, pubkey, responseEvent.content);

      expect(review?.escalation).toBeDefined();
      expect(review!.escalation!.entries.map((e) => e.entry.outcome)).toContain(
        "escalation-reached-human",
      );
      // Structurally sound on its own terms -- this device just has no way to have seen
      // this root published anywhere yet, which is a client-side concern (checkReview),
      // not something the wire response itself gets wrong.
      for (const { entry, proof } of review!.escalation!.entries) {
        expect(verifyInclusion(entry, proof, review!.escalation!.root)).toBe(true);
      }
    } finally {
      rmSync(escalationDir, { recursive: true, force: true });
    }
  });

  it("omits the escalation section entirely when no escalation log is configured", async () => {
    const { pubkey, deliver, publishedEvents } = await started({}, [], opened);
    const a = generateSecretKey();

    deliver(signalEvent(a, pubkey, "log-review", {}));
    const responseEvent = await waitForResponse(publishedEvents);
    const { review } = openResponse<ResponsePayload>(a, pubkey, responseEvent.content);

    expect(review?.escalation).toBeUndefined();
  });

  it("degrades gracefully when the configured escalation log path does not exist yet", async () => {
    // The executor hasn't written anything (or hasn't run at all yet) -- a real, common
    // state, not an error. AccountabilityLog.open() already handles a missing file as an
    // empty log; this asserts the daemon passes that through rather than treating it as a
    // failure and dropping the section.
    const escalationDir = mkdtempSync(join(tmpdir(), "navcom-escalation-log-unwritten-"));
    const escalationPath = join(escalationDir, "escalation-log.jsonl");
    try {
      const { pubkey, deliver, publishedEvents } = await started({}, [], opened, escalationPath);
      const a = generateSecretKey();

      deliver(signalEvent(a, pubkey, "log-review", {}));
      const responseEvent = await waitForResponse(publishedEvents);
      const { review } = openResponse<ResponsePayload>(a, pubkey, responseEvent.content);

      expect(review?.escalation).toBeDefined();
      expect(review!.escalation!.entries).toHaveLength(0);
    } finally {
      rmSync(escalationDir, { recursive: true, force: true });
    }
  });

  it("says plainly when it keeps no log, rather than answering with nothing", async () => {
    // A watch with no log and a watch with an empty log are different situations, and an
    // empty review would make them look identical.
    const { pubkey, deliver, publishedEvents } = await started();
    const a = generateSecretKey();

    deliver(signalEvent(a, pubkey, "log-review", {}));
    const responseEvent = await waitForResponse(publishedEvents);
    const payload = openResponse<ResponsePayload>(a, pubkey, responseEvent.content);

    expect(payload.review).toBeUndefined();
    expect(payload.text).toMatch(/keeps no accountability log/i);
  });

  it("keeps two operators with the same callsign apart", async () => {
    // Callsigns are not unique and there is no registry. Matching on the name in the
    // mechanism that holds the watch accountable would show one person another's record.
    const { pubkey, deliver, publishedEvents } = await started({}, [], opened);
    const a = generateSecretKey();
    const b = generateSecretKey();

    deliver(signalEvent(a, pubkey, "on-station", { callsign: "Raven", area: "North", expected_duration: 7200, routine_interval: null, share_position: false, position: null }));
    await waitForResponse(publishedEvents);
    deliver(signalEvent(b, pubkey, "on-station", { callsign: "Raven", area: "South", expected_duration: 7200, routine_interval: null, share_position: false, position: null }));
    await waitForResponse(publishedEvents, 1);

    await vi.waitFor(() => {
      expect(opened.about(getPublicKey(a))).toHaveLength(1);
      expect(opened.about(getPublicKey(b))).toHaveLength(1);
    });
  });
});

describe("WatchtowerDaemon.start()", () => {
  it("publishes an unencrypted watch-state event with state: automated", async () => {
    const { publishedEvents } = await started();
    const watchState = publishedEvents.find((e) => e.kind === KIND_WATCH_STATE);
    expect(watchState).toBeDefined();
    const payload = JSON.parse(watchState!.content) as WatchStatePayload;
    expect(payload.state).toBe("automated");
    expect(payload.holder_kind).toBe("agent");
    // oncall is a list of authored declarations now, so a count can never exceed
    // its evidence. Empty is the honest value: nobody has declared themselves on-call.
    expect(payload.oncall).toEqual([]);
  });
});

describe("what an overdue operator costs them, publicly", () => {
  // This suite used to pin the opposite behaviour, and the change is deliberate.
  //
  // External review had caught that "notify whoever holds watch on the overdue transition"
  // is an already-specified requirement, and that routing it through a third-party channel
  // would leak operator activity to that third party. The answer at the time was an
  // aggregate `overdue_count` on kind 10910 -- public, but identity-free.
  //
  // It was still an unencrypted announcement that *somebody* was overdue, to anybody
  // subscribed, and the field's own comment said to drop it once a Console existed, because
  // a Console reads the board and needs no public field. The watch is now a mode of the app
  // and does exactly that. So the requirement is met by whoever holds watch looking at their
  // own board, and nothing about an overdue operator is published at all.
  // That the transition IS written to the log is asserted in "what the watch writes down",
  // which has a real log file to check against. This suite is about what leaves the box.

  it("publishes nothing at all about them -- not a name, not an area, not a count", async () => {
    vi.useFakeTimers();
    try {
      const { daemon, publishedEvents } = await started({ overdueGrace: 1, sweepIntervalSeconds: 1 });
      const operatorPubkey = getPublicKey(generateSecretKey());
      daemon.board.onStation({
        operator: operatorPubkey, callsign: "a-very-identifying-callsign", area: "very-specific-district",
        expectedDurationSeconds: 1, routineIntervalSeconds: null, position: null, now: Math.floor(Date.now() / 1000),
        signalId: "e".repeat(64),
      });

      await vi.advanceTimersByTimeAsync(5000);

      const watchStates = publishedEvents.filter((e) => e.kind === KIND_WATCH_STATE);
      for (const e of watchStates) {
        expect(e.content).not.toContain("a-very-identifying-callsign");
        expect(e.content).not.toContain("very-specific-district");
        expect(e.content).not.toContain(operatorPubkey);
        // The count is gone with the rest. A watcher correlating timing learned something
        // from it, and that is the Doxxer's method.
        expect(e.content).not.toContain("overdue");
      }

      /*
       * The overdue contact is the one thing that now DOES leave the box on an overdue, so
       * this test has to cover it or its title promises more than it checks.
       *
       * It is addressed to the operator and sealed to them. What an observer gets is the
       * same `p`/`e` shape every ack has — never the callsign, the area, or the word.
       */
      for (const e of publishedEvents.filter((x) => x.kind === KIND_RESPONSE)) {
        expect(e.content).not.toContain("a-very-identifying-callsign");
        expect(e.content).not.toContain("very-specific-district");
        expect(e.content).not.toContain("overdue");
        expect(JSON.stringify(e.tags)).not.toContain("overdue");
      }
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("contacting an overdue operator", () => {
  /*
   * `watch-state.spec.md`: on crossing overdue grace the node MUST mark the entry, make it
   * visible to whoever holds watch, **and attempt contact with the operator**. The third
   * logged `contact-not-attempted` for months behind a comment saying it should read badly
   * until it stopped being true.
   */
  it("sends the operator a nudge, sealed to them, naming their own sign-on", async () => {
    vi.useFakeTimers();
    try {
      const { daemon, pubkey, publishedEvents } = await started({ overdueGrace: 1, sweepIntervalSeconds: 1 });
      const operator = generateSecretKey();
      const operatorPubkey = getPublicKey(operator);
      const signalId = "e".repeat(64);
      daemon.board.onStation({
        operator: operatorPubkey, callsign: "Wren", area: "downtown",
        expectedDurationSeconds: 1, routineIntervalSeconds: null, position: null,
        now: Math.floor(Date.now() / 1000), signalId,
      });

      await vi.advanceTimersByTimeAsync(5000);

      const contacts = publishedEvents
        .filter((e) => e.kind === KIND_RESPONSE)
        .map((e) => ({ e, p: openResponse<ResponsePayload>(operator, pubkey, e.content) }))
        .filter(({ p }) => p.type === "contact");

      expect(contacts.length).toBeGreaterThan(0);
      const { e, p } = contacts[0]!;
      // Addressed to the operator and to nobody else, about their own sign-on.
      expect(e.tags).toContainEqual(["p", operatorPubkey]);
      expect(e.tags).toContainEqual(["e", signalId]);
      // Identified as an agent [invariant 5], and flat rather than alarming.
      expect(p.responder.kind).toBe("agent");
      expect(p.text).toMatch(/past the time you gave/i);
      expect(p.text).not.toMatch(/are you (ok|okay|alright)/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never pages, escalates, or tells anybody else", async () => {
    // The line invariant 3 draws. Contacting the person is consulting the only individual
    // who knows; raising somebody else on a missed window is inferring duress from silence.
    vi.useFakeTimers();
    try {
      const { daemon, pubkey, publishedEvents } = await started({ overdueGrace: 1, sweepIntervalSeconds: 1 });
      const operator = generateSecretKey();
      const operatorPubkey = getPublicKey(operator);
      daemon.board.onStation({
        operator: operatorPubkey, callsign: "Wren", area: "downtown",
        expectedDurationSeconds: 1, routineIntervalSeconds: null, position: null,
        now: Math.floor(Date.now() / 1000), signalId: "e".repeat(64),
      });

      await vi.advanceTimersByTimeAsync(5000);

      // Every response published is addressed to the overdue operator themselves. Nothing
      // goes to a third party, and no distress-shaped event is emitted at all.
      for (const e of publishedEvents.filter((x) => x.kind === KIND_RESPONSE)) {
        expect(e.tags.filter((t) => t[0] === "p").map((t) => t[1])).toEqual([operatorPubkey]);
      }
      expect(publishedEvents.some((e) => e.kind === KIND_DISTRESS)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("on-station dispatch", () => {
  it("adds the operator to the board and acks", async () => {
    const { daemon, pubkey, deliver, publishedEvents } = await started();
    const operator = generateSecretKey();
    const operatorPubkey = getPublicKey(operator);

    deliver(signalEvent(operator, pubkey, "on-station", {
      area: "district-7", expected_duration: 7200, routine_interval: null, share_position: false, position: null,
    }));

    const responseEvent = await waitForResponse(publishedEvents);
    const payload = openResponse<ResponsePayload>(operator, pubkey, responseEvent.content);
    expect(payload.type).toBe("ack");
    expect(daemon.board.get(operatorPubkey)?.status).toBe("active");
    expect(daemon.board.get(operatorPubkey)?.area).toBe("district-7");
  });

  it("responds with a clear error-ack instead of crashing on a malformed payload", async () => {
    // The exact bug the 15-pass review found and fixed: a malformed
    // expected_duration used to reach an uncaught RangeError deep
    // inside Board.onStation(), and the operator got nothing back at
    // all. This is the daemon-level regression test for that fix,
    // distinct from validate.test.ts's unit-level coverage of the
    // validator itself.
    const { daemon, pubkey, deliver, publishedEvents } = await started();
    const operator = generateSecretKey();

    deliver(signalEvent(operator, pubkey, "on-station", {
      area: "district-7", expected_duration: "not-a-number", routine_interval: null, share_position: false, position: null,
    }));

    const responseEvent = await waitForResponse(publishedEvents);
    const payload = openResponse<ResponsePayload>(operator, pubkey, responseEvent.content);
    expect(payload.type).toBe("ack");
    expect(payload.text).toMatch(/expected_duration/);
    expect(daemon.board.size).toBe(0); // never made it onto the board
  });
});

describe("query dispatch", () => {
  it("returns an answer with responder_kind and null provenance (renders unverified)", async () => {
    const { pubkey, deliver, publishedEvents } = await started();
    const operator = generateSecretKey();

    deliver(signalEvent(operator, pubkey, "query", { text: "bed tonight, has a dog" }));

    const responseEvent = await waitForResponse(publishedEvents);
    const payload = openResponse<ResponsePayload>(operator, pubkey, responseEvent.content);
    expect(payload.type).toBe("answer");
    expect(payload.responder.kind).toBe("agent");
    expect(payload.provenance).toBeNull();
  });

  it("times out and returns a clear error-ack instead of hanging when answerQuery() is slow", async () => {
    vi.spyOn(query, "answerQuery").mockImplementation(
      () => new Promise(() => {}), // never resolves
    );
    const { pubkey, deliver, publishedEvents } = await started({ queryTimeoutSeconds: 0.05 });
    const operator = generateSecretKey();

    deliver(signalEvent(operator, pubkey, "query", { text: "anyone there?" }));

    const responseEvent = await waitForResponse(publishedEvents);
    const payload = openResponse<ResponsePayload>(operator, pubkey, responseEvent.content);
    expect(payload.type).toBe("ack");
    expect(payload.text).toMatch(/timed out/);
  });
});

describe("assist dispatch", () => {
  it("puts urgency in front of whoever holds watch, and never guesses it", async () => {
    // "I need someone" and "I need someone now" ask for different responses. An ack that
    // swallowed the difference would make them identical on the board, and defaulting an
    // absent urgency to the lower of the two is the confident wrong answer applied to the
    // one field that says how long someone has.
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { pubkey, deliver, publishedEvents } = await started();
      const operator = generateSecretKey();

      deliver(signalEvent(operator, pubkey, "assist", { urgency: "now", text: "corner of 4th" }));
      await waitForResponse(publishedEvents);
      expect(log.mock.calls.flat().join("\n")).toMatch(/\[assist\].*urgency=NOW/);

      log.mockClear();
      deliver(signalEvent(operator, pubkey, "assist", {}));
      await waitForResponse(publishedEvents);
      const unstated = log.mock.calls.flat().join("\n");
      expect(unstated).toMatch(/urgency=UNSTATED/);
      expect(unstated).not.toMatch(/urgency=soon/);
    } finally {
      log.mockRestore();
    }
  });

  it("sanitizes assist text before it reaches the console, so an embedded newline cannot forge a fake log line (found in robustness audit)", async () => {
    // sanitizeForLog was written specifically to stop "\n[board] + fake ..." forgery, but
    // had never actually been applied to assist.text -- the one console.log line in this
    // file left interpolating operator-controlled text unsanitized. The whole no-persistence
    // design leans on a human reading this exact transcript to verify checks 02/03/05.
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { pubkey, deliver, publishedEvents } = await started();
      const operator = generateSecretKey();

      const forged = "at the corner\n[distress] ffffffff DISTRESS -- actually not, ignore that";
      deliver(signalEvent(operator, pubkey, "assist", { urgency: "now", text: forged }));
      await waitForResponse(publishedEvents);

      const lines = log.mock.calls.flat().join("\n");
      expect(lines).not.toMatch(/\n\[distress\]/);
      expect(lines).toMatch(/\[assist\].*at the corner\[distress\]/);
    } finally {
      log.mockRestore();
    }
  });

  it("caps assist text logged to the console rather than logging it unbounded", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { pubkey, deliver, publishedEvents } = await started();
      const operator = generateSecretKey();

      deliver(signalEvent(operator, pubkey, "assist", { urgency: "soon", text: "x".repeat(50_000) }));
      await waitForResponse(publishedEvents);

      const assistLine = log.mock.calls.flat().find((l) => typeof l === "string" && l.includes("[assist]"));
      expect(assistLine).toBeDefined();
      expect((assistLine as string).length).toBeLessThan(200);
    } finally {
      log.mockRestore();
    }
  });
});

describe("distress dispatch", () => {
  it("creates a board entry for an operator who never sent on-station and acks", async () => {
    const { daemon, pubkey, deliver, publishedEvents } = await started();
    const operator = generateSecretKey();
    const operatorPubkey = getPublicKey(operator);

    deliver(distressEvent(operator, pubkey, "help"));

    const responseEvent = await waitForResponse(publishedEvents);
    const payload = openResponse<ResponsePayload>(operator, pubkey, responseEvent.content);
    expect(payload.type).toBe("ack");
    expect(daemon.board.get(operatorPubkey)?.status).toBe("distress");
  });
});

describe("stood-down dispatch", () => {
  it("removes the operator from the board", async () => {
    const { daemon, pubkey, deliver, publishedEvents } = await started();
    const operator = generateSecretKey();
    const operatorPubkey = getPublicKey(operator);

    deliver(signalEvent(operator, pubkey, "on-station", {
      area: "d", expected_duration: 100, routine_interval: null, share_position: false, position: null,
    }));
    await waitForResponse(publishedEvents);
    expect(daemon.board.size).toBe(1);

    deliver(signalEvent(operator, pubkey, "stood-down", {}));
    await waitForResponse(publishedEvents, 1);
    expect(daemon.board.get(operatorPubkey)).toBeUndefined();
  });
});

describe("authorization gate (found in review)", () => {
  it("silently drops a signal from an unauthorized operator -- no response, no board mutation", async () => {
    vi.spyOn(authorization, "isAuthorizedOperator").mockReturnValue(false);
    const { daemon, pubkey, deliver, publishedEvents } = await started();
    const operator = generateSecretKey();

    deliver(signalEvent(operator, pubkey, "on-station", {
      area: "d", expected_duration: 100, routine_interval: null, share_position: false, position: null,
    }));

    // Give any (incorrect) async handling a chance to run before asserting nothing happened.
    await new Promise((r) => setTimeout(r, 20));
    expect(publishedEvents.filter((e) => e.kind === KIND_RESPONSE)).toHaveLength(0);
    expect(daemon.board.size).toBe(0);
  });

  it("processes signals normally when authorized (Session One's default)", async () => {
    const { daemon, pubkey, deliver, publishedEvents } = await started();
    const operator = generateSecretKey();

    deliver(signalEvent(operator, pubkey, "on-station", {
      area: "d", expected_duration: 100, routine_interval: null, share_position: false, position: null,
    }));

    await waitForResponse(publishedEvents);
    expect(daemon.board.size).toBe(1);
  });

  // ADDED (Stage 2, allowlist): end-to-end confirmation against the REAL
  // isAuthorizedOperator() with a real, non-empty allowedPubkeys list --
  // the two tests above only exercise the mocked/default-empty paths.
  it("processes a signal from an operator ON a real configured allowlist", async () => {
    const operator = generateSecretKey();
    const operatorPubkey = getPublicKey(operator);
    const { daemon, pubkey, deliver, publishedEvents } = await started({}, [operatorPubkey]);

    deliver(signalEvent(operator, pubkey, "on-station", {
      area: "d", expected_duration: 100, routine_interval: null, share_position: false, position: null,
    }));

    await waitForResponse(publishedEvents);
    expect(daemon.board.size).toBe(1);
  });

  it("silently drops a signal from an operator NOT on a real configured allowlist", async () => {
    const someoneElsesPubkey = getPublicKey(generateSecretKey());
    const { daemon, pubkey, deliver, publishedEvents } = await started({}, [someoneElsesPubkey]);
    const operator = generateSecretKey(); // not on the allowlist

    deliver(signalEvent(operator, pubkey, "on-station", {
      area: "d", expected_duration: 100, routine_interval: null, share_position: false, position: null,
    }));

    await new Promise((r) => setTimeout(r, 20));
    expect(publishedEvents.filter((e) => e.kind === KIND_RESPONSE)).toHaveLength(0);
    expect(daemon.board.size).toBe(0);
  });
});

describe("bad signature", () => {
  it("is dropped without a response", async () => {
    // Found while writing this test: nostr-tools' finalizeEvent() marks
    // its own output as pre-verified via a hidden Symbol
    // (verifiedSymbol), and verifyEvent() trusts that cached flag
    // without re-checking. Object-spreading a finalizeEvent() result
    // (`{ ...event, sig: "bad" }`) silently COPIES that cached "true"
    // along with it, so verifyEvent on the "tampered" copy would return
    // the stale cached result instead of actually re-verifying -- not a
    // real daemon vulnerability (a relay-delivered event is always a
    // fresh JSON.parse() result, which can never carry a JS Symbol in
    // the first place), but a real trap for constructing this exact
    // test. JSON.parse(JSON.stringify(...)) strips the symbol, matching
    // what a genuine relay delivery actually looks like.
    const { daemon, pubkey, deliver, publishedEvents } = await started();
    const operator = generateSecretKey();
    const signed = signalEvent(operator, pubkey, "on-station", {
      area: "d", expected_duration: 100, routine_interval: null, share_position: false, position: null,
    });
    const tampered: Event = JSON.parse(JSON.stringify(signed));
    tampered.sig = "0".repeat(128);

    deliver(tampered);

    await new Promise((r) => setTimeout(r, 20));
    expect(publishedEvents.filter((e) => e.kind === KIND_RESPONSE)).toHaveLength(0);
    expect(daemon.board.size).toBe(0);
  });

  it("tampered content with a now-stale id/sig is also caught (id no longer matches content)", async () => {
    const { daemon, pubkey, deliver, publishedEvents } = await started();
    const operator = generateSecretKey();
    const signed = signalEvent(operator, pubkey, "on-station", {
      area: "d", expected_duration: 100, routine_interval: null, share_position: false, position: null,
    });
    const tampered: Event = JSON.parse(JSON.stringify(signed));
    tampered.content = tampered.content + "tampered";

    deliver(tampered);

    await new Promise((r) => setTimeout(r, 20));
    expect(publishedEvents.filter((e) => e.kind === KIND_RESPONSE)).toHaveLength(0);
    expect(daemon.board.size).toBe(0);
  });
});

describe("validly-signed but undecryptable content", () => {
  it("is dropped without a response (distinct from a bad signature -- passes verifyEvent, fails at decrypt)", async () => {
    // A genuinely different failure mode from the "bad signature" tests
    // above: a real, validly-signed event (this one legitimately passes
    // verifyEvent) whose content simply isn't valid NIP-44 ciphertext --
    // a buggy client, not tampering in transit.
    const { daemon, pubkey, deliver, publishedEvents } = await started();
    const operator = generateSecretKey();
    const event = finalizeEvent(
      { kind: KIND_SIGNAL, tags: [["p", pubkey], ["t", "on-station"]], content: "not valid nip44 ciphertext", created_at: Math.floor(Date.now() / 1000) },
      operator,
    );

    deliver(event);

    await new Promise((r) => setTimeout(r, 20));
    expect(publishedEvents.filter((e) => e.kind === KIND_RESPONSE)).toHaveLength(0);
    expect(daemon.board.size).toBe(0);
  });
});
