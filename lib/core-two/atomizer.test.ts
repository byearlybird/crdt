import { describe, expect, test } from "vitest";
import { KEYS } from "./types";
import { Atomizer } from "./atomizer";

describe("Atomizer.pack", () => {
  test("creates atom with ~val and ~ts", () => {
    const a = Atomizer.pack("hello", "1000");
    expect(a[KEYS.VAL]).toBe("hello");
    expect(a[KEYS.TS]).toBe("1000");
  });

  test("handles primitives, objects, and arrays as value", () => {
    expect(Atomizer.pack(42, "t")).toEqual({ [KEYS.VAL]: 42, [KEYS.TS]: "t" });
    expect(Atomizer.pack(true, "t")).toEqual({ [KEYS.VAL]: true, [KEYS.TS]: "t" });
    expect(Atomizer.pack(null, "t")).toEqual({ [KEYS.VAL]: null, [KEYS.TS]: "t" });
    const obj = { theme: "dark" };
    expect(Atomizer.pack(obj, "t")).toEqual({ [KEYS.VAL]: obj, [KEYS.TS]: "t" });
    const arr = [1, 2, 3];
    expect(Atomizer.pack(arr, "t")).toEqual({ [KEYS.VAL]: arr, [KEYS.TS]: "t" });
  });
});

describe("Atomizer.isAtom", () => {
  test("returns true for packed atom", () => {
    const a = Atomizer.pack("x", "1000");
    expect(Atomizer.isAtom(a)).toBe(true);
  });

  test("returns false for non-objects", () => {
    expect(Atomizer.isAtom(undefined)).toBeFalsy();
    expect(Atomizer.isAtom(null)).toBeFalsy();
    expect(Atomizer.isAtom(1)).toBe(false);
    expect(Atomizer.isAtom("s")).toBe(false);
  });

  test("returns false for plain object without ~val", () => {
    expect(Atomizer.isAtom({})).toBe(false);
    expect(Atomizer.isAtom({ [KEYS.TS]: "1000" })).toBe(false);
  });
});

describe("Atomizer.unpack", () => {
  test("returns value when given atom", () => {
    expect(Atomizer.unpack(Atomizer.pack("hi", "t"))).toBe("hi");
    expect(Atomizer.unpack(Atomizer.pack(99, "t"))).toBe(99);
    const o = { nested: true };
    expect(Atomizer.unpack(Atomizer.pack(o, "t"))).toBe(o);
  });

  test("returns undefined when not an atom", () => {
    expect(Atomizer.unpack(undefined)).toBeUndefined();
    expect(Atomizer.unpack(null)).toBeUndefined();
    expect(Atomizer.unpack({})).toBeUndefined();
  });
});
