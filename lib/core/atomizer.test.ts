import { describe, expect, test } from "vitest";
import { makeStamp } from "./clock";
import { KEYS } from "./types";
import { isAtom, pack, unpack } from "./atomizer";

const t = makeStamp(1000, 0);

describe("pack", () => {
  test("creates atom with ~val and ~ts", () => {
    const a = pack("hello", t);
    expect(a[KEYS.VAL]).toBe("hello");
    expect(a[KEYS.TS]).toBe(t);
  });

  test("handles primitives, objects, and arrays as value", () => {
    expect(pack(42, t)).toEqual({ [KEYS.VAL]: 42, [KEYS.TS]: t });
    expect(pack(true, t)).toEqual({ [KEYS.VAL]: true, [KEYS.TS]: t });
    expect(pack(null, t)).toEqual({ [KEYS.VAL]: null, [KEYS.TS]: t });
    const obj = { theme: "dark" };
    expect(pack(obj, t)).toEqual({ [KEYS.VAL]: obj, [KEYS.TS]: t });
    const arr = [1, 2, 3];
    expect(pack(arr, t)).toEqual({ [KEYS.VAL]: arr, [KEYS.TS]: t });
  });
});

describe("isAtom", () => {
  test("returns true for packed atom", () => {
    const a = pack("x", t);
    expect(isAtom(a)).toBe(true);
  });

  test("returns false for non-objects", () => {
    expect(isAtom(undefined)).toBeFalsy();
    expect(isAtom(null)).toBeFalsy();
    expect(isAtom(1)).toBe(false);
    expect(isAtom("s")).toBe(false);
  });

  test("returns false for plain object without ~val", () => {
    expect(isAtom({})).toBe(false);
    expect(isAtom({ [KEYS.TS]: t })).toBe(false);
  });
});

describe("unpack", () => {
  test("returns value when given atom", () => {
    expect(unpack(pack("hi", t))).toBe("hi");
    expect(unpack(pack(99, t))).toBe(99);
    const o = { nested: true };
    expect(unpack(pack(o, t))).toBe(o);
  });

  test("returns undefined when not an atom", () => {
    expect(unpack(undefined)).toBeUndefined();
    expect(unpack(null)).toBeUndefined();
    expect(unpack({})).toBeUndefined();
  });
});
