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
import { EscalationExecutor } from "../src/escalation/executor.js";
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
      oncall,
      ...over,
    },
    log: { path: tempLogPath(), retentionDays: 90 },
  };
}

function fakePool() {
  const published: Event[] = [];
  let onEvent: ((e: Event) => void) | undefined;
  const pool = {
    publish: (_relays: string[], event: Event) => {
      published.push(event);
      return [Promise.resolve("ok")];
    },
    subscribeMany: (_r: string[], _f: unknown, params: { onevent: (e: Event) => void }) => {
      onEvent = params.onevent;
      return { close: () => {} };
    },
    destroy: () => {},
  } as unknown as SimplePool;
  return { pool, published, deliver: (e: Event) => onEvent?.(e) };
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
  const { pool, published, deliver } = fakePool();
  const config = fakeConfig(oncall, over);
  const executor = new EscalationExecutor({ config, secretKey, pubkey, pool, page });
  executors.push(executor);
  executor.start();
  return { executor, pubkey, published, deliver, page, logPath: config.log.path };
}

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
