import { describe, test, expect } from "bun:test";
import { makeStamp, parseStamp } from "./stamp";

describe("makeStamp", () => {
  test("generates stamp with correct length", () => {
    const stamp = makeStamp(1000000, 42);
    // 12 (ms) + 6 (seq) + 6 (nonce) = 24 characters
    expect(stamp).toHaveLength(24);
  });

  test("generates different stamps due to random nonce", () => {
    const stamp1 = makeStamp(1000000, 42);
    const stamp2 = makeStamp(1000000, 42);

    expect(stamp1).not.toBe(stamp2);
  });

  test("encodes values in hex format", () => {
    const stamp = makeStamp(255, 15);

    // Check that it's valid hex
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
