import { describe, test, expect } from "vitest";
import { advanceClock, makeStamp, parseStamp } from "./clock";

describe("advanceClock", () => {
  test("with greater ms updates ms and resets seq", () => {
    const current = { ms: 1000, seq: 5 };
    const next = { ms: 2000, seq: 3 };
    const result = advanceClock(current, next);

    expect(result).toEqual({ ms: 2000, seq: 3 });
  });

  test("with same ms advances seq", () => {
    const current = { ms: 1000, seq: 5 };
    let result = advanceClock(current, { ms: 1000, seq: 3 });
    expect(result).toEqual({ ms: 1000, seq: 6 });

    result = advanceClock(result, { ms: 1000, seq: 10 });
    expect(result).toEqual({ ms: 1000, seq: 11 });
  });

  test("with smaller ms handles clock going backward by incrementing seq", () => {
    const current = { ms: 1000, seq: 5 };
    const next = { ms: 500, seq: 10 };
    const result = advanceClock(current, next);

    expect(result).toEqual({ ms: 1000, seq: 6 });
  });

  test("handles zero initial state", () => {
    const current = { ms: 0, seq: 0 };
    const next = { ms: 1000, seq: 5 };
    const result = advanceClock(current, next);

    expect(result).toEqual({ ms: 1000, seq: 5 });
  });
});

describe("makeStamp", () => {
  test("generates stamp with correct length", () => {
    const stamp = makeStamp(1000000, 42);
    expect(stamp).toHaveLength(24);
  });

  test("generates different stamps due to random nonce", () => {
    const stamp1 = makeStamp(1000000, 42);
    const stamp2 = makeStamp(1000000, 42);

    expect(stamp1).not.toBe(stamp2);
  });

  test("encodes values in hex format", () => {
    const stamp = makeStamp(255, 15);
    expect(stamp).toMatch(/^[0-9a-f]{24}$/);
  });
});

describe("parseStamp", () => {
  test("extracts ms and seq from stamp", () => {
    const stamp = "0000000f424000002aabc123";
    const result = parseStamp(stamp);

    expect(result.ms).toBe(1000000);
    expect(result.seq).toBe(42);
  });

  test("handles zero values", () => {
    const stamp = "000000000000000000abc123";
    const result = parseStamp(stamp);

    expect(result.ms).toBe(0);
    expect(result.seq).toBe(0);
  });

  test("handles max values", () => {
    const stamp = "ffffffffffffffffffabc123";
    const result = parseStamp(stamp);

    expect(result.ms).toBe(281474976710655);
    expect(result.seq).toBe(16777215);
  });
});

describe("makeStamp + parseStamp round-trip", () => {
  test("round-trip preserves ms and seq values", () => {
    const ms = 1703203200000;
    const seq = 42;

    const stamp = makeStamp(ms, seq);
    const parsed = parseStamp(stamp);

    expect(parsed.ms).toBe(ms);
    expect(parsed.seq).toBe(seq);
  });
});
