import { describe, it, expect } from "vitest";
import { isValidHexPubkey, sanitizeForLog, validateOnStationPayload, ValidationError } from "../src/shared/validate.js";

describe("isValidHexPubkey", () => {
  it("accepts a valid 64-char lowercase hex pubkey", () => {
    expect(isValidHexPubkey("a".repeat(64))).toBe(true);
  });

  it("rejects wrong length", () => {
    expect(isValidHexPubkey("a".repeat(63))).toBe(false);
    expect(isValidHexPubkey("a".repeat(65))).toBe(false);
  });

  it("rejects uppercase hex", () => {
    expect(isValidHexPubkey("A".repeat(64))).toBe(false);
  });

  it("rejects an npub (bech32, not hex)", () => {
    expect(isValidHexPubkey("npub1" + "q".repeat(58))).toBe(false);
  });

  it("rejects the literal example-config placeholder text", () => {
    // The exact real-world footgun this fix exists for.
    expect(isValidHexPubkey("REPLACE_WITH_WATCHTOWER_PUBKEY")).toBe(false);
  });

  it("rejects non-string input", () => {
    expect(isValidHexPubkey(12345)).toBe(false);
    expect(isValidHexPubkey(null)).toBe(false);
    expect(isValidHexPubkey(undefined)).toBe(false);
  });
});

describe("sanitizeForLog", () => {
  it("passes through an ordinary string unchanged", () => {
    expect(sanitizeForLog("OP-1")).toBe("OP-1");
  });

  it("strips embedded newlines (log-injection prevention)", () => {
    const malicious = "OP-1\n[board] + fake-admin callsign=root area=everywhere status=active";
    const cleaned = sanitizeForLog(malicious, 200);
    expect(cleaned).not.toContain("\n");
    expect(cleaned).toContain("[board]"); // stripped of newlines but still one line, not two fake ones
  });

  it("strips other control characters", () => {
    expect(sanitizeForLog("a\x00b\x1bc\x7fd")).toBe("abcd");
  });

  it("truncates long strings with an ellipsis marker", () => {
    const long = "x".repeat(100);
    const cleaned = sanitizeForLog(long, 10);
    expect(cleaned.length).toBe(11); // 10 chars + ellipsis
    expect(cleaned.endsWith("…")).toBe(true);
  });
});

describe("validateOnStationPayload", () => {
  const valid = {
    area: "district-7",
    expected_duration: 7200,
    routine_interval: 3600,
    share_position: false,
    position: null,
  };

  it("accepts a well-formed payload", () => {
    expect(() => validateOnStationPayload(valid)).not.toThrow();
  });

  it("accepts routine_interval: null", () => {
    expect(() => validateOnStationPayload({ ...valid, routine_interval: null })).not.toThrow();
  });

  it("accepts an optional callsign", () => {
    const result = validateOnStationPayload({ ...valid, callsign: "OP-9" });
    expect(result.callsign).toBe("OP-9");
  });

  it("accepts a valid position when share_position is true", () => {
    const result = validateOnStationPayload({
      ...valid,
      share_position: true,
      position: { lat: 1.23, lon: -4.56, precision_m: 500 },
    });
    expect(result.position).toEqual({ lat: 1.23, lon: -4.56, precision_m: 500 });
  });

  // The exact real bug this module exists to catch: a malformed
  // expected_duration used to reach `new Date(NaN * 1000).toISOString()`
  // inside Board.onStation() and throw an uncaught RangeError.
  it("rejects null payload", () => {
    expect(() => validateOnStationPayload(null)).toThrow(ValidationError);
  });

  it("rejects a non-object payload (string)", () => {
    expect(() => validateOnStationPayload("not an object")).toThrow(ValidationError);
  });

  it("rejects missing expected_duration", () => {
    const { expected_duration: _drop, ...rest } = valid;
    expect(() => validateOnStationPayload(rest)).toThrow(/expected_duration/);
  });

  it("rejects non-numeric expected_duration", () => {
    expect(() => validateOnStationPayload({ ...valid, expected_duration: "7200" })).toThrow(/expected_duration/);
  });

  it("rejects NaN expected_duration", () => {
    expect(() => validateOnStationPayload({ ...valid, expected_duration: NaN })).toThrow(/expected_duration/);
  });

  it("rejects zero or negative expected_duration", () => {
    expect(() => validateOnStationPayload({ ...valid, expected_duration: 0 })).toThrow(/expected_duration/);
    expect(() => validateOnStationPayload({ ...valid, expected_duration: -100 })).toThrow(/expected_duration/);
  });

  it("rejects zero or negative routine_interval (null is fine, 0/negative is not)", () => {
    expect(() => validateOnStationPayload({ ...valid, routine_interval: 0 })).toThrow(/routine_interval/);
    expect(() => validateOnStationPayload({ ...valid, routine_interval: -1 })).toThrow(/routine_interval/);
  });

  it("rejects missing area", () => {
    const { area: _drop, ...rest } = valid;
    expect(() => validateOnStationPayload(rest)).toThrow(/area/);
  });

  it("rejects empty-string area", () => {
    expect(() => validateOnStationPayload({ ...valid, area: "" })).toThrow(/area/);
  });

  it("rejects non-boolean share_position", () => {
    expect(() => validateOnStationPayload({ ...valid, share_position: "yes" })).toThrow(/share_position/);
  });

  it("rejects an out-of-range position", () => {
    expect(() =>
      validateOnStationPayload({ ...valid, position: { lat: 999, lon: 0, precision_m: 1 } }),
    ).toThrow(/position/);
  });

  it("rejects a malformed position object", () => {
    expect(() => validateOnStationPayload({ ...valid, position: { lat: 1 } })).toThrow(/position/);
  });

  it("rejects non-string callsign when present", () => {
    expect(() => validateOnStationPayload({ ...valid, callsign: 12345 })).toThrow(/callsign/);
  });

  // Found in robustness audit: the compose-side cap (checkedText/limits.ts) never ran on
  // this receive path, so a crafted payload could carry an area/callsign of any length
  // straight onto a live board entry -- exactly the "make somebody else's screen
  // unusable" attack limits.ts's own docstring names.
  it("rejects an area longer than AREA_MAX (found in robustness audit)", () => {
    expect(() => validateOnStationPayload({ ...valid, area: "x".repeat(121) })).toThrow(/area/);
  });

  it("rejects a callsign longer than CALLSIGN_MAX (found in robustness audit)", () => {
    expect(() => validateOnStationPayload({ ...valid, callsign: "x".repeat(49) })).toThrow(/callsign/);
  });

  it("rejects an absurdly large expected_duration rather than letting it overflow Date() downstream (found in robustness audit)", () => {
    // Same root cause and fix site as the original NaN bug this file exists to prevent, a
    // different magnitude class: a finite but huge value passed every check here and still
    // overflowed `new Date()` inside Board.onStation(), after the entry was already on the
    // board.
    expect(() => validateOnStationPayload({ ...valid, expected_duration: 1e13 })).toThrow(
      /expected_duration/,
    );
  });

  it("rejects an absurdly large routine_interval the same way", () => {
    expect(() => validateOnStationPayload({ ...valid, routine_interval: 1e13 })).toThrow(
      /routine_interval/,
    );
  });
});
