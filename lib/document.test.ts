import { describe, test, expect } from "bun:test";
import { makeDocument, parseDocument } from "./document";

describe("makeDocument", () => {
  test("wraps simple object fields with stamp", () => {
    const fields = { name: "Alice", age: 30 };
    const stamp = "stamp123";

    const result = makeDocument(fields, stamp);

    expect(result).toEqual({
      name: { "~value": "Alice", "~stamp": "stamp123" },
      age: { "~value": 30, "~stamp": "stamp123" },
    });
  });

  test("handles empty object", () => {
    const fields = {};
    const stamp = "stamp456";

    const result = makeDocument(fields, stamp);

    expect(result).toEqual({});
  });

  test("handles various value types", () => {
    const fields = {
      str: "hello",
      num: 42,
      bool: true,
      arr: [1, 2, 3],
      obj: { nested: "value" },
      nil: null,
    };
    const stamp = "stamp789";

    const result = makeDocument(fields, stamp);

    expect(result).toEqual({
      str: { "~value": "hello", "~stamp": "stamp789" },
      num: { "~value": 42, "~stamp": "stamp789" },
      bool: { "~value": true, "~stamp": "stamp789" },
      arr: { "~value": [1, 2, 3], "~stamp": "stamp789" },
      "obj.nested": { "~value": "value", "~stamp": "stamp789" },
      nil: { "~value": null, "~stamp": "stamp789" },
    });
  });

  test("all fields receive the same stamp", () => {
    const fields = { a: 1, b: 2, c: 3 };
    const stamp = "unified-stamp";

    const result = makeDocument(fields, stamp);

    expect(result["a"]?.["~stamp"]).toBe(stamp);
    expect(result["b"]?.["~stamp"]).toBe(stamp);
    expect(result["c"]?.["~stamp"]).toBe(stamp);
  });

  test("flattens nested objects", () => {
    const fields = {
      user: {
        name: "Alice",
        address: {
          city: "NYC",
          zip: 10001,
        },
      },
      active: true,
    };
    const stamp = "stamp-flat";

    const result = makeDocument(fields, stamp);

    expect(result).toEqual({
      "user.name": { "~value": "Alice", "~stamp": "stamp-flat" },
      "user.address.city": { "~value": "NYC", "~stamp": "stamp-flat" },
      "user.address.zip": { "~value": 10001, "~stamp": "stamp-flat" },
      active: { "~value": true, "~stamp": "stamp-flat" },
    });
  });
});

describe("parseDocument", () => {
  test("extracts values from simple document", () => {
    const document = {
      name: { "~value": "Alice", "~stamp": "stamp123" },
      age: { "~value": 30, "~stamp": "stamp123" },
    };

    const result = parseDocument(document);

    expect(result).toEqual({
      name: "Alice",
      age: 30,
    });
  });

  test("unflattens nested structures", () => {
    const document = {
      "user.name": { "~value": "Alice", "~stamp": "stamp-flat" },
      "user.address.city": { "~value": "NYC", "~stamp": "stamp-flat" },
      "user.address.zip": { "~value": 10001, "~stamp": "stamp-flat" },
      active: { "~value": true, "~stamp": "stamp-flat" },
    };

    const result = parseDocument(document);

    expect(result).toEqual({
      user: {
        name: "Alice",
        address: {
          city: "NYC",
          zip: 10001,
        },
      },
      active: true,
    });
  });

  test("handles empty document", () => {
    const document = {};

    const result = parseDocument(document);

    expect(result).toEqual({});
  });
});

describe("makeDocument + parseDocument round-trip", () => {
  test("round-trip preserves data structure", () => {
    const original = {
      user: {
        name: "Bob",
        profile: {
          age: 25,
          active: true,
        },
      },
      settings: {
        theme: "dark",
      },
    };

    const document = makeDocument(original, "test-stamp");
    const restored = parseDocument(document);

    expect(restored).toEqual(original);
  });
});
