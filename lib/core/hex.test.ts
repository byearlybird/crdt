import { describe, test, expect } from "vitest";
import { toHex, nonce } from "./hex";

describe("toHex", () => {
  test("converts number to hex string", () => {
    expect(toHex(255, 2)).toBe("ff");
    expect(toHex(16, 2)).toBe("10");
    expect(toHex(0, 2)).toBe("00");
  });

  test("pads hex string to specified length", () => {
    expect(toHex(1, 4)).toBe("0001");
    expect(toHex(255, 6)).toBe("0000ff");
    expect(toHex(4096, 3)).toBe("1000");
  });
});

describe("nonce", () => {
  test("generates hex string of correct length", () => {
    expect(nonce(6)).toHaveLength(6);
    expect(nonce(8)).toHaveLength(8);
    expect(nonce(12)).toHaveLength(12);
  });

  test("generates different values on subsequent calls", () => {
    const n1 = nonce(6);
    const n2 = nonce(6);
    const n3 = nonce(6);

    expect(n1).not.toBe(n2);
    expect(n2).not.toBe(n3);
    expect(n1).not.toBe(n3);
  });

  test("generates valid hex characters", () => {
    const n = nonce(20);
    expect(n).toMatch(/^[0-9a-f]+$/);
  });
});
