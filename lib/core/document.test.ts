import { describe, test, expect } from "bun:test";
import {
  makeDocument,
  mergeDocuments,
  parseDocument,
  type Document,
} from "./document";

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

describe("mergeDocuments", () => {
  test("chooses target when both have key and target stamp is higher", () => {
    const target: Document = {
      name: { "~stamp": "000000000000000002000000", "~value": "Alice" },
    };
    const source: Document = {
      name: { "~stamp": "000000000000000001000000", "~value": "Bob" },
    };

    const result = mergeDocuments(target, source);

    expect(result["name"]?.["~value"]).toBe("Alice");
  });

  test("chooses source when both have key and source stamp is higher", () => {
    const target: Document = {
      name: { "~stamp": "000000000000000001000000", "~value": "Alice" },
    };
    const source: Document = {
      name: { "~stamp": "000000000000000002000000", "~value": "Bob" },
    };

    const result = mergeDocuments(target, source);

    expect(result["name"]?.["~value"]).toBe("Bob");
  });

  test("includes key that only exists in source", () => {
    const target: Document = {};
    const source: Document = {
      age: { "~stamp": "000000000000000001000000", "~value": 30 },
    };

    const result = mergeDocuments(target, source);

    expect(result["age"]?.["~value"]).toBe(30);
  });

  test("includes key that only exists in target", () => {
    const target: Document = {
      age: { "~stamp": "000000000000000001000000", "~value": 25 },
    };
    const source: Document = {};

    const result = mergeDocuments(target, source);

    expect(result["age"]?.["~value"]).toBe(25);
  });

  test("throws error when key exists in neither document", () => {
    const target: Document = { name: undefined as any };
    const source: Document = { name: undefined as any };

    expect(() => mergeDocuments(target, source)).toThrow(
      "Key name not found in either document",
    );
  });

  test("merges multiple keys with mixed scenarios", () => {
    const target: Document = {
      name: { "~stamp": "000000000000000002000000", "~value": "Alice" },
      age: { "~stamp": "000000000000000001000000", "~value": 25 },
      city: { "~stamp": "000000000000000001000000", "~value": "NYC" },
    };
    const source: Document = {
      name: { "~stamp": "000000000000000001000000", "~value": "Bob" },
      age: { "~stamp": "000000000000000002000000", "~value": 30 },
      country: { "~stamp": "000000000000000001000000", "~value": "USA" },
    };

    const result = mergeDocuments(target, source);

    expect(result["name"]?.["~value"]).toBe("Alice");
    expect(result["age"]?.["~value"]).toBe(30);
    expect(result["city"]?.["~value"]).toBe("NYC");
    expect(result["country"]?.["~value"]).toBe("USA");
  });
});
