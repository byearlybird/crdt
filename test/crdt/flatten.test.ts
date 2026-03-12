import { describe, expect, test } from "bun:test";
import { flatten, unflatten } from "#crdt/flatten.ts";

describe("flatten", () => {
  test("flat object passes through", () => {
    expect(flatten({ a: 1, b: 2 })).toEqual({ a: 1, b: 2 });
  });

  test("nests with dot-separated keys", () => {
    expect(flatten({ a: { b: 1 } })).toEqual({ "a.b": 1 });
  });

  test("preserves non-plain-object leaves", () => {
    const result = flatten({ arr: [1, 2], nil: null, str: "hi", num: 42 });
    expect(result).toEqual({ arr: [1, 2], nil: null, str: "hi", num: 42 });
  });

  test("applies transform to leaves", () => {
    expect(flatten({ a: 1 }, String)).toEqual({ a: "1" });
  });

  test("empty nested object is a leaf", () => {
    expect(flatten({ a: {} })).toEqual({ a: {} });
  });

  test("keys containing dot are preserved (e.g. already-flattened or double-flatten)", () => {
    // Flat object with dot in key is unchanged
    expect(flatten({ "a.b": 1 })).toEqual({ "a.b": 1 });
    // Flatten again (idempotent for already-flat)
    expect(flatten(flatten({ a: { b: 1 } }))).toEqual({ "a.b": 1 });
    // Dot in key is kept; nested path is appended
    expect(flatten({ "x.y": { z: 2 } })).toEqual({ "x.y.z": 2 });
  });
});

describe("unflatten", () => {
  test("dot keys become nested objects", () => {
    expect(unflatten({ "a.b": 1 })).toEqual({ a: { b: 1 } });
  });

  test("flat keys pass through", () => {
    expect(unflatten({ a: 1 })).toEqual({ a: 1 });
  });

  test("numeric segments create arrays", () => {
    expect(unflatten({ "a.0": "x", "a.1": "y" })).toEqual({ a: ["x", "y"] });
  });

  test("skips __proto__ keys", () => {
    const result = unflatten({ "__proto__.polluted": true });
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(result).toEqual({});
  });
});
