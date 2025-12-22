import { describe, test, expect } from "bun:test";
import { mergeDocuments } from "./merge";
import type { Document } from "./document";

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

    expect(result["name"]?.["~value"]).toBe("Alice"); // target wins
    expect(result["age"]?.["~value"]).toBe(30); // source wins
    expect(result["city"]?.["~value"]).toBe("NYC"); // only in target
    expect(result["country"]?.["~value"]).toBe("USA"); // only in source
  });
});
