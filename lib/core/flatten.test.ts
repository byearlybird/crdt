import { describe, expect, test } from "vitest";
import { flatten, unflatten } from "./flatten";

describe("flatten", () => {
  test("flattens nested objects with various types", () => {
    const input = {
      a: { b: 1, c: [2, 3] },
      d: 4,
      e: { f: { g: "nested" } },
      h: null,
      i: undefined,
    };

    const result = flatten(input);

    expect(result).toEqual({
      "a.b": 1,
      "a.c": [2, 3],
      d: 4,
      "e.f.g": "nested",
      h: null,
      i: undefined,
    });
  });

  test("applies mapper to leaf values", () => {
    const input = { a: { b: 1 }, c: 2 };

    const result = flatten(input, (v, path) => ({ v, path, ts: 123 }));

    expect(result).toEqual({
      "a.b": { v: 1, path: "a.b", ts: 123 },
      c: { v: 2, path: "c", ts: 123 },
    });
  });

  test("treats empty objects as leaf values", () => {
    const input = { a: {}, b: { c: {} } };

    const result = flatten(input);

    expect(result).toEqual({
      a: {},
      "b.c": {},
    });
  });

  test("treats non-plain objects as leaf values", () => {
    const date = new Date("2024-01-01");
    const regex = /test/;
    const input = { a: date, b: { c: regex } };

    const result = flatten(input);

    expect(result).toEqual({
      a: date,
      "b.c": regex,
    });
  });
});

describe("unflatten", () => {
  test("unflattens dot-notation keys into nested objects", () => {
    const input = {
      "a.b": 1,
      "a.c": [2, 3],
      d: 4,
      "e.f.g": "nested",
    };

    const result = unflatten(input);

    expect(result).toEqual({
      a: { b: 1, c: [2, 3] },
      d: 4,
      e: { f: { g: "nested" } },
    });
  });

  test("applies mapper to values before placing them", () => {
    const input = {
      "a.b": { v: 1, ts: 123 },
      c: { v: 2, ts: 456 },
    };

    const result = unflatten(input, (val) => val.v);

    expect(result).toEqual({
      a: { b: 1 },
      c: 2,
    });
  });

  test("handles single keys without dots", () => {
    const input = { a: 1, b: 2 };

    const result = unflatten(input);

    expect(result).toEqual({ a: 1, b: 2 });
  });
});

describe("flatten + unflatten round-trip", () => {
  test("round-trip conversion preserves structure", () => {
    const original = {
      a: { b: 1, c: [2, 3] },
      d: 4,
      e: { f: { g: "nested" } },
    };

    const flattened = flatten(original);
    const restored = unflatten(flattened);

    expect(restored).toEqual(original);
  });
});
