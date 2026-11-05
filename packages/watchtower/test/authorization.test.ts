import { describe, it, expect } from "vitest";
import { isAuthorizedOperator, refusalToStart } from "../src/daemon/authorization.js";

const closed = (allowedPubkeys: string[]) => ({ allowedPubkeys, open: false });

describe("isAuthorizedOperator", () => {
  // Closed by default (SC7, 2026-11-04). This used to pin the opposite -- an empty list heard
  // everyone -- so a change to the default had to come through here, and this is that change.
  it("hears nobody when the list is empty and the board is not open", () => {
    expect(isAuthorizedOperator("a".repeat(64), closed([]))).toBe(false);
    expect(isAuthorizedOperator("", closed([]))).toBe(false);
  });

  it("hears anyone only where the config says open = true", () => {
    expect(isAuthorizedOperator("a".repeat(64), { allowedPubkeys: [], open: true })).toBe(true);
    expect(isAuthorizedOperator("b".repeat(64), { allowedPubkeys: [], open: true })).toBe(true);
  });

  it("allows a pubkey present in a real allowlist", () => {
    const auth = closed(["a".repeat(64), "b".repeat(64)]);
    expect(isAuthorizedOperator("a".repeat(64), auth)).toBe(true);
    expect(isAuthorizedOperator("b".repeat(64), auth)).toBe(true);
  });

  it("rejects a pubkey not present in a real allowlist", () => {
    const auth = closed(["a".repeat(64)]);
    expect(isAuthorizedOperator("c".repeat(64), auth)).toBe(false);
    expect(isAuthorizedOperator("", auth)).toBe(false);
  });

  it("is case-sensitive -- an uppercase-hex pubkey does not match a lowercase allowlist entry", () => {
    // Nostr pubkeys are conventionally lowercase hex; config.ts's own parsing already rejects
    // non-lowercase entries at load time, so this pins that a mismatched case is not silently
    // normalized/matched here as a second line of defense.
    expect(isAuthorizedOperator("A".repeat(64), closed(["a".repeat(64)]))).toBe(false);
  });
});

describe("refusalToStart", () => {
  it("refuses a box that would hear nobody, and names both ways forward", () => {
    const why = refusalToStart(closed([]));
    expect(why).toMatch(/hear nobody/);
    expect(why).toMatch(/allowed_pubkeys/);
    expect(why).toMatch(/open = true/);
  });

  it("starts with a list, or with an open board said in as many words", () => {
    expect(refusalToStart(closed(["a".repeat(64)]))).toBeNull();
    expect(refusalToStart({ allowedPubkeys: [], open: true })).toBeNull();
  });
});
