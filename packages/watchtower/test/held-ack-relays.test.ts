/**
 * The held acknowledgement, heard by a phone's own retry loop.
 *
 * The hold exists for a phone that missed the acknowledgement and keeps sending (decided
 * 2026-10-07). Whether it works is not whether the executor publishes the right thing; it is
 * whether the phone's loop hears it, and hears it as what it is. So these run the loops
 * themselves -- the current one from `@navcom/core`, and the one phones cached before
 * 2026-10-07 (`fixtures/older-client-loop.ts`) -- on a real `SimplePool`, against relays on
 * 127.0.0.1: one that answers, and one that takes everything and answers nothing.
 *
 * The two loops need different things from the executor [review: relay paths, #13]:
 *
 * - **The current loop** records an attempt before sending it and listens for the whole Distress,
 *   so it hears the first re-send. It reads the two `e` tags to tell an answer to this Distress
 *   from an answer to an earlier one, and only the first ends it [#0]
 * - **The older loop** records an attempt only once the publish has settled on every relay -- up to
 *   4.4 seconds with a hung one -- and drops an answer naming an attempt it has not recorded. A
 *   phone running it that started its Distress again is reached only by the second send, ten
 *   seconds on. Deleting the second send left this suite green before these existed
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { SimplePool } from "nostr-tools/pool";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { Event } from "nostr-tools/core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sendDistressUntilAcknowledged, watchtowerAt, type DistressPhase, type ResponsePayload } from "@navcom/core";
import { EscalationExecutor } from "../src/escalation/executor.js";
import type { EscalationConfig } from "../src/escalation/config.js";
import type { pageAll } from "../src/escalation/pager.js";
import { nodePool } from "../src/shared/nostr-node.js";
import { sealSignal } from "../src/shared/crypto.js";
import { KIND_DISTRESS, KIND_RESPONSE, KIND_SIGNAL } from "../src/shared/kinds.js";
import { olderClientLoop } from "./fixtures/older-client-loop.js";
import { startRelay, eventually, type LocalRelay } from "./helpers/local-relay.js";

const STANDING = 4_102_444_800;
const nowS = () => Math.floor(Date.now() / 1000);

const dirs: string[] = [];
const relays: LocalRelay[] = [];
const executors: EscalationExecutor[] = [];
const pools: SimplePool[] = [];
const aborts: AbortController[] = [];

afterEach(async () => {
  for (const a of aborts.splice(0)) a.abort();
  await Promise.all(executors.splice(0).map((e) => e.stop()));
  for (const p of pools.splice(0)) p.destroy();
  await Promise.all(relays.splice(0).map((r) => r.close()));
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function config(url: string, wren: string, over: Partial<EscalationConfig["escalation"]> = {}): EscalationConfig {
  const dir = mkdtempSync(join(tmpdir(), "navcom-held-"));
  dirs.push(dir);
  return {
    identity: { privkeyPath: "/dev/null" },
    relays: { urls: [url] },
    escalation: {
      pagingWindowSeconds: 300, contactWindowSeconds: 300, drillWindowDays: 7,
      drillAckWindowSeconds: 600, drillStatePath: join(dir, "drill.json"),
      maxPagesPerWindow: 20, pageBudgetWindowSeconds: 3_600, ladderRetentionSeconds: 3_600,
      ackHoldsSeconds: 1_800,
      oncall: [
        {
          declaration: { author: { kind: "node", callsign: "Wren", pubkey: wren }, channel: "sms", expires: STANDING },
          command: ["true"],
        },
      ],
      ...over,
    },
    log: { path: join(dir, "escalation-log.jsonl"), retentionDays: 90 },
  };
}

function ackFrom(responder: Uint8Array, watchtower: string, distressId: string): Event {
  return finalizeEvent(
    {
      kind: KIND_SIGNAL,
      tags: [["p", watchtower], ["t", "distress-ack"]],
      content: sealSignal(responder, [watchtower], { distress_id: distressId }),
      created_at: nowS(),
    },
    responder,
  );
}

/**
 * A watch on relay `fast`, whose one on-call person answers every page a moment after it lands --
 * straight onto the relay, as her phone would. With `dropFirstAnswer`, the relay refuses the
 * report of her first answer, as a connection dropping at that moment loses it for the phone.
 * With `wrenAnswers: false` she answers only when the test says, and `refuseResponses(n)` makes
 * the relay refuse the next `n` answers the watch publishes.
 */
async function watch(
  opts: { dropFirstAnswer?: boolean; wrenAnswers?: boolean; over?: Partial<EscalationConfig["escalation"]> } = {},
) {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  const fast = await startRelay();
  const hung = await startRelay();
  hung.hang = true;
  relays.push(fast, hung);

  const wren = generateSecretKey();
  const secretKey = generateSecretKey();
  const pubkey = getPublicKey(secretKey);
  let refusing = 0;
  fast.refuseEvent = (event) => {
    if (refusing === 0 || event.kind !== KIND_RESPONSE) return null;
    refusing--;
    return "blocked: lost on the way";
  };
  let answered = 0;
  const page = vi.fn<typeof pageAll>(async (_roster, _message, _url, distressId) => {
    if (opts.wrenAnswers !== false) {
      setTimeout(() => {
        if (opts.dropFirstAnswer && answered === 0) refusing = 1;
        answered++;
        fast.deliver(ackFrom(wren, pubkey, distressId!));
      }, 300);
    }
    return [{ callsign: "Wren", channel: "sms", dispatched: true }];
  });
  const executor = new EscalationExecutor({ config: config(fast.url, getPublicKey(wren), opts.over), secretKey, pubkey, page });
  executors.push(executor);
  executor.start();
  await eventually(() => expect(fast.openSubs()).toBe(1));
  return {
    fast, hung, executor, pubkey, page,
    /** Wren answers the page she got, which carried `distressId`. */
    wrenAnswers: (distressId: string) => fast.deliver(ackFrom(wren, pubkey, distressId)),
    refuseResponses: (n: number) => { refusing = n; },
  };
}

/** A phone's loop, started and left running: the current one, or the older one. */
function running(
  operator: Uint8Array,
  relaysFor: string[],
  watchtower: string,
  loop: "current" | "older" = "current",
  ackWindowMs = 2_000,
) {
  const pool = nodePool();
  pools.push(pool);
  const abort = new AbortController();
  aborts.push(abort);
  const phases: DistressPhase[] = [];
  let attempts = 0;
  const started = Date.now();
  const onPhase = (p: { phase: string }) => {
    phases.push(p as DistressPhase);
    if (p.phase === "sending") attempts++;
  };
  const opts = { ackWindowMs, backoffMs: 500, maxBackoffMs: 500, signal: abort.signal, onPhase };
  const payload = { position: null, area: "north side" };
  const done: Promise<ResponsePayload | null> = (
    loop === "current"
      ? sendDistressUntilAcknowledged(pool, relaysFor, operator, getPublicKey(operator), watchtowerAt(watchtower), payload, opts)
      : olderClientLoop(pool, relaysFor, operator, getPublicKey(operator), watchtowerAt(watchtower), payload, opts)
  ).catch(() => null);
  const texts = (phase: string) =>
    phases.filter((p) => p.phase === phase).map((p) => ("response" in p ? p.response.text : null));
  return { abort, phases, done, started, texts, attempts: () => attempts };
}

/** A phone's loop on both relays -- the current one, or the older one. Resolves at the answer or the deadline. */
async function phone(
  operator: Uint8Array,
  relaysFor: string[],
  watchtower: string,
  deadlineMs: number,
  loop: "current" | "older" = "current",
  ackWindowMs = 2_000,
) {
  const run = running(operator, relaysFor, watchtower, loop, ackWindowMs);
  const deadline = new Promise<null>((r) => setTimeout(() => r(null), deadlineMs));
  const answer = await Promise.race([run.done, deadline]);
  run.abort.abort();
  return { answer, phases: run.phases, ms: Date.now() - run.started, attempts: run.attempts };
}

/** A Distress from a loop that is gone -- the app reopened, the phone wiped -- acknowledged by Wren. */
async function acknowledgedEarlier(fast: LocalRelay, executor: EscalationExecutor, pubkey: string, operator: Uint8Array) {
  const first = finalizeEvent(
    {
      kind: KIND_DISTRESS,
      tags: [["p", pubkey]],
      content: sealSignal(operator, [pubkey], { position: null, area: "north side" }),
      created_at: nowS(),
    },
    operator,
  );
  fast.deliver(first);
  await eventually(() => expect(executor.ladders.get(first.id)?.state).toBe("acknowledged"));
  return first;
}

describe("a phone that missed the acknowledgement, with one relay slow to say OK [D2, #13]", () => {
  it("hears it re-sent to its next attempt, ends on it, and nobody is paged again", async () => {
    // Wren answers attempt one in 300ms, and the relay loses the report of it on the way to the
    // phone. Attempt two is answered from the hold, naming both attempts -- both this run's.
    const { fast, hung, pubkey, page } = await watch({ dropFirstAnswer: true });
    const operator = generateSecretKey();

    const { answer, phases, attempts } = await phone(operator, [fast.url, hung.url], pubkey, 25_000);

    expect(answer, `not acknowledged after ${attempts()} attempts`).not.toBeNull();
    expect(answer!.responder.kind).toBe("human");
    expect(answer!.responder.callsign).toBe("Wren");
    expect(answer!.text, "answered by something other than the hold").toMatch(/has not escalated this one/);
    expect(attempts()).toBeGreaterThanOrEqual(2);
    expect(phases.map((p) => p.phase), "the phone's own attempts read as an earlier Distress").not.toContain("acknowledged-earlier");
    expect(page, "the roster was woken again for a Distress Wren already has").toHaveBeenCalledTimes(1);
  }, 40_000);
});

describe("a phone that started its Distress again after the acknowledgement [D2, #0]", () => {
  it("is told who answered the earlier one, keeps sending, and is paged for once the hold closes", async () => {
    // A new run knows none of the ids Wren answered. That answer, held and re-sent, closed it in
    // under a tenth of a second under "Answered", though nobody had heard of this Distress. It
    // is said now, and the sending goes on until a person answers this one.
    const { fast, hung, executor, pubkey, page } = await watch({ over: { ackHoldsSeconds: 3 } });
    const operator = generateSecretKey();
    await acknowledgedEarlier(fast, executor, pubkey, operator);

    const { answer, phases, attempts } = await phone(operator, [fast.url, hung.url], pubkey, 30_000);

    const earlier = phases.find((p) => p.phase === "acknowledged-earlier");
    expect(earlier, "never told that Wren answered an earlier Distress").toBeDefined();
    expect(earlier && "response" in earlier ? earlier.response.responder.callsign : null).toBe("Wren");
    expect(answer, `not acknowledged after ${attempts()} attempts`).not.toBeNull();
    // Ended by Wren answering this Distress, once the hold had closed and she was paged for it.
    expect(answer!.text).toBe("Wren is responding.");
    expect(page).toHaveBeenCalledTimes(2);
    const names = phases.map((p) => p.phase);
    expect(names.indexOf("acknowledged")).toBeGreaterThan(names.indexOf("acknowledged-earlier"));
  }, 45_000);
});

describe("a phone still running the loop from before 2026-10-07 [#13]", () => {
  it("that started its Distress again hears the held answer, through the second send", async () => {
    // It records attempt one only once the hung relay has given up on its OK, so the re-send that
    // lands at once names an attempt it does not know yet. The second send, ten seconds on, lands
    // after -- and is the only thing that reaches it.
    const { fast, hung, executor, pubkey, page } = await watch();
    const operator = generateSecretKey();
    await acknowledgedEarlier(fast, executor, pubkey, operator);

    const { answer, ms, attempts } = await phone(operator, [fast.url, hung.url], pubkey, 25_000, "older");

    expect(answer, `not acknowledged after ${attempts()} attempts`).not.toBeNull();
    expect(answer!.responder.callsign).toBe("Wren");
    expect(answer!.text).toMatch(/has not escalated this one/);
    expect(ms, "heard before the second send could have reached it, so this proves nothing").toBeGreaterThan(9_000);
    expect(page).toHaveBeenCalledTimes(1);
  }, 40_000);
});

describe("a phone that started its Distress again while the first was still paging [review: relay paths, R1]", () => {
  /*
   * The app closed, was evicted or wiped mid-ladder, and the Distress was sent again. The watch
   * joined the new run's attempts to the ladder already paging and told it "Paging Wren.", naming
   * both. Wren then answered the page she got, which carried the first run's id. The new run had
   * never sent that id: it dropped her answer, read the hold's repeat of it as an answer to an
   * earlier Distress, and went on sending until the hold closed -- when the roster was paged again
   * for the emergency Wren was already answering.
   */
  async function restarted(opts: { loseWrensReport?: boolean } = {}) {
    const w = await watch({ wrenAnswers: false });
    const operator = generateSecretKey();

    const first = running(operator, [w.fast.url], w.pubkey);
    await eventually(() => expect(first.texts("watch-status")).toContain("Paging Wren."), 5_000);
    const opened = w.fast.published.find((e) => e.kind === KIND_DISTRESS)!.id;
    first.abort.abort();
    await first.done;

    const again = running(operator, [w.fast.url], w.pubkey);
    await eventually(() => expect(again.texts("watch-status"), "never told it joined the ladder").toContain("Paging Wren."), 5_000);
    if (opts.loseWrensReport) w.refuseResponses(1);
    w.wrenAnswers(opened);

    const deadline = new Promise<null>((r) => setTimeout(() => r(null), 10_000));
    const answer = await Promise.race([again.done, deadline]);
    again.abort.abort();
    return { answer, again, page: w.page };
  }

  it("ends when Wren answers the page she got, though it names only the first run's Distress", async () => {
    const { answer, again, page } = await restarted();
    expect(answer, `still sending after ${again.attempts()} attempts`).not.toBeNull();
    expect(answer!.responder.callsign).toBe("Wren");
    expect(answer!.text).toBe("Wren is responding.");
    expect(again.phases.map((p) => p.phase)).not.toContain("acknowledged-earlier");
    expect(page, "the roster was woken again for one emergency").toHaveBeenCalledTimes(1);
  }, 30_000);

  it("ends on the hold's repeat of her answer when her own report was lost on the way", async () => {
    const { answer, again, page } = await restarted({ loseWrensReport: true });
    expect(answer, `still sending after ${again.attempts()} attempts`).not.toBeNull();
    expect(answer!.responder.callsign).toBe("Wren");
    expect(answer!.text, "answered by something other than the hold").toMatch(/has not escalated this one/);
    expect(again.phases.map((p) => p.phase), "told Wren answered an earlier Distress, about the one she answered").not.toContain(
      "acknowledged-earlier",
    );
    expect(page).toHaveBeenCalledTimes(1);
  }, 30_000);
});

describe("a held answer the relay refuses the first time [review: relay paths, R2]", () => {
  it("reaches the phone on the second send, and nobody is paged again", async () => {
    // Wren's report is lost on the way to the phone, and the relay refuses the hold's first answer
    // to the next attempt -- a rate limit, a blip. Ending the hold there paged Wren again for a
    // Distress she had answered; the second send, ten seconds on, reaches the phone. The window is
    // longer than that here, as the phone's twenty seconds are, so no later attempt answers first.
    const { fast, pubkey, page, refuseResponses, wrenAnswers } = await watch({ wrenAnswers: false });
    const operator = generateSecretKey();
    const run = running(operator, [fast.url], pubkey, "current", 12_000);
    await eventually(() => expect(run.texts("watch-status")).toContain("Paging Wren."), 5_000);
    const opened = fast.published.find((e) => e.kind === KIND_DISTRESS)!.id;
    // Her report, and then the hold's first answer to attempt two.
    refuseResponses(2);
    wrenAnswers(opened);

    const deadline = new Promise<null>((r) => setTimeout(() => r(null), 30_000));
    const answer = await Promise.race([run.done, deadline]);
    run.abort.abort();
    expect(answer, `not acknowledged after ${run.attempts()} attempts`).not.toBeNull();
    expect(answer!.text).toMatch(/has not escalated this one/);
    expect(run.attempts(), "answered by a later attempt, not the second send").toBe(2);
    expect(page, "Wren was paged again for a Distress she had answered").toHaveBeenCalledTimes(1);
  }, 45_000);
});
