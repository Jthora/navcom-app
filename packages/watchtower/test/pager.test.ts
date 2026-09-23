import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { emptyState, forgetOld, markPaged, shouldPage, REPAGE_AFTER_SECONDS } from "../src/pager/decide.js";

/**
 * A keyless pager's whole job is counting, so this is where its failure modes live.
 *
 * Both directions are dangerous. Paging on every retry trains somebody to swipe the alarm
 * away; going quiet while a Distress is still running means nobody comes.
 */

const T = 1_755_300_000;
const wren = "a".repeat(64);
const raven = "b".repeat(64);

describe("one incident, one page", () => {
  it("pages the first time it sees a Distress", () => {
    const s = emptyState();
    expect(shouldPage(s, { id: "e1", author: wren, at: T }, T)).toBe(true);
  });

  it("does not page again for the same event from another relay", () => {
    // Several relays deliver the same event. That is one emergency.
    const s = emptyState();
    shouldPage(s, { id: "e1", author: wren, at: T }, T);
    expect(shouldPage(s, { id: "e1", author: wren, at: T }, T)).toBe(false);
  });

  it("does not page for the retries of a Distress it already paged for", () => {
    // sendDistressUntilAcknowledged retries with backoff, so one incident is a stream of
    // events with distinct ids. Fifty pages for one emergency is the alarm-fatigue failure
    // that the rest of this system is built to avoid.
    const s = emptyState();
    expect(shouldPage(s, { id: "e1", author: wren, at: T }, T)).toBe(true);
    // The page went out. Recording that is the caller's job since 2026-09-21, so that a page
    // which never went cannot suppress the retries that follow it.
    markPaged(s, wren, T);
    for (let i = 2; i < 20; i++) {
      const at = T + i * 10;
      expect(shouldPage(s, { id: `e${i}`, author: wren, at }, at), `retry ${i}`).toBe(false);
    }
  });
});

describe("still running means nobody answered", () => {
  it("pages again once the window has passed", () => {
    // The most important behaviour here. A Distress still going after five minutes means
    // the first page did not produce a human, and going quiet then would be the worst
    // possible thing this process could do.
    const s = emptyState();
    shouldPage(s, { id: "e1", author: wren, at: T }, T);

    const later = T + REPAGE_AFTER_SECONDS + 1;
    expect(shouldPage(s, { id: "e2", author: wren, at: later }, later)).toBe(true);
  });

  it("keeps re-paging for as long as it continues", () => {
    const s = emptyState();
    let now = T;
    let pages = 0;
    for (let i = 0; i < 10; i++) {
      if (shouldPage(s, { id: `e${i}`, author: wren, at: now }, now)) pages++;
      now += REPAGE_AFTER_SECONDS + 1;
    }
    expect(pages).toBe(10);
  });
});

describe("two people in trouble are two emergencies", () => {
  it("pages for a second operator inside the first one's window", () => {
    // Suppressing this would be the cost of deduplication landing on the wrong person.
    const s = emptyState();
    expect(shouldPage(s, { id: "e1", author: wren, at: T }, T)).toBe(true);
    expect(shouldPage(s, { id: "e2", author: raven, at: T + 5 }, T + 5)).toBe(true);
  });
});

describe("what it refuses to wake somebody for", () => {
  it("ignores an event stamped well in the past", () => {
    // Relays replay, and events arrive out of order. Paging for something that happened an
    // hour ago wakes somebody about an emergency that is over.
    const s = emptyState();
    expect(shouldPage(s, { id: "old", author: wren, at: T - 3600 }, T)).toBe(false);
  });

  it("cannot be configured into paging on every retry", () => {
    // A window of zero would page on every event in the retry stream. A configuration that
    // produces alarm fatigue is a configuration that disables the alarm.
    const s = emptyState();
    expect(shouldPage(s, { id: "e1", author: wren, at: T }, T, 0)).toBe(true);
    markPaged(s, wren, T);
    expect(shouldPage(s, { id: "e2", author: wren, at: T }, T, 0)).toBe(false);
  });
});

describe("running for months on a machine nobody looks at", () => {
  it("forgets operators who have not been paged for in a long time", () => {
    const s = emptyState();
    shouldPage(s, { id: "e1", author: wren, at: T }, T);
    markPaged(s, wren, T);
    expect(s.pagedAt.size).toBe(1);
    forgetOld(s, T + 7200);
    expect(s.pagedAt.size).toBe(0);
  });

  it("keeps a recent page, so forgetting cannot cause a double page", () => {
    const s = emptyState();
    shouldPage(s, { id: "e1", author: wren, at: T }, T);
    markPaged(s, wren, T);
    forgetOld(s, T + 60);
    expect(shouldPage(s, { id: "e2", author: wren, at: T + 61 }, T + 61)).toBe(false);
  });
});

describe("it holds no key, structurally", () => {
  /**
   * Code only, comments stripped.
   *
   * These files explain at length what they cannot do, so matching raw text finds "cannot
   * decrypt" and fails on the sentence that documents the property being asserted. A test
   * that fails on its own prose is a test somebody deletes.
   */
  const source = ["decide.ts", "index.ts"]
    .map((f) => readFileSync(join(import.meta.dirname, "../src/pager", f), "utf8"))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  it("never loads, reads or derives a secret", () => {
    // The property the whole design rests on, asserted rather than trusted. A keyless pager
    // that grew a key would silently become a second thing holding the Watchtower secret,
    // and the person running it -- who was told they need to be trusted with nothing --
    // would not be told.
    for (const forbidden of ["privkey", "secretKey", "loadOrCreateKeypair", "secretFromHex"]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("never decrypts anything", () => {
    // It can see that a Distress arrived. It cannot see inside one, and there is no code
    // path here that could.
    for (const forbidden of ["decrypt", "openSignal", "openFromGroup", "nip44"]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("never signs or publishes anything", () => {
    // Answering a Distress means signing as the Watchtower. This cannot, so it can never
    // become the thing that closes one [invariant 2] -- and it cannot report to the operator
    // either, which is why it is a supplement and the keyed executor is not optional.
    for (const forbidden of ["finalizeEvent", "publish(", "sealResponse"]) {
      expect(source, forbidden).not.toContain(forbidden);
    }
  });

  it("has no configuration field that could give it one", () => {
    // Not an optional field, not a commented-out one. Somebody copying this config must not
    // find a key-shaped hole in it.
    const example = readFileSync(join(import.meta.dirname, "../pager.example.toml"), "utf8");
    expect(example).not.toMatch(/privkey|secret|private_key/i);
  });
});

describe("a page that failed to send", () => {
  it("leaves the next retry free, instead of counting as delivered", () => {
    /*
     * `shouldPage` used to record the operator as paged before the command had run, so one
     * failed dispatch — a dead gateway, a missing binary — suppressed every real retry from
     * that operator for the whole repage window. The backup pager, whose only job is
     * redundancy for the thing that must not fail, went quiet exactly when its first attempt
     * failed.
     */
    const s = emptyState();
    expect(shouldPage(s, { id: "e1", author: wren, at: T }, T)).toBe(true);
    // No markPaged: the command exited non-zero.
    expect(shouldPage(s, { id: "e2", author: wren, at: T + 10 }, T + 10)).toBe(true);

    // And once one actually goes out, the retries are suppressed as before.
    markPaged(s, wren, T + 10);
    expect(shouldPage(s, { id: "e3", author: wren, at: T + 20 }, T + 20)).toBe(false);
  });
});
