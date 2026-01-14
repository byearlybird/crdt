import { describe, test, expect } from "bun:test";
import { makeStamp } from "./clock";
import { makeDocument, parseDocument, mergeDocuments } from "./document";

describe("Integration: Full Document Lifecycle", () => {
  test("complete workflow: create, merge, and parse documents", () => {
    const stamp1 = makeStamp(1000, 1);
    const stamp2 = makeStamp(2000, 1);

    const doc1 = makeDocument({ name: "Alice", age: 30 }, stamp1);
    const doc2 = makeDocument({ name: "Alice", age: 31 }, stamp2);

    const merged = mergeDocuments(doc1, doc2);
    const result = parseDocument(merged);

    expect(result).toEqual({ name: "Alice", age: 31 });
  });

  test("round-trip maintains data integrity through merge", () => {
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

    const stamp = makeStamp(Date.now(), 1);
    const document = makeDocument(original, stamp);
    const merged = mergeDocuments(document, document);
    const restored = parseDocument(merged);

    expect(restored).toEqual(original);
  });
});

describe("Integration: Conflict Resolution", () => {
  test("last write wins resolution with nested object fields", () => {
    const stamp1 = makeStamp(1000, 1);
    const stamp2 = makeStamp(2000, 1);
    const stamp3 = makeStamp(3000, 1);

    const doc1 = makeDocument(
      {
        user: {
          name: "Alice",
          age: 30,
        },
      },
      stamp1,
    );

    const doc2 = makeDocument(
      {
        user: {
          name: "Alice",
          age: 31,
        },
      },
      stamp2,
    );

    const doc3 = makeDocument(
      {
        user: {
          name: "Alicia",
          age: 30,
        },
      },
      stamp3,
    );

    const merged1 = mergeDocuments(doc1, doc2);
    const merged2 = mergeDocuments(merged1, doc3);
    const result = parseDocument(merged2);

    expect(result).toEqual({
      user: {
        name: "Alicia",
        age: 30,
      },
    });
  });

  test("sequence number matters when timestamps are equal", () => {
    const stamp1 = makeStamp(1000, 1);
    const stamp2 = makeStamp(1000, 2);

    const doc1 = makeDocument({ value: "first" }, stamp1);
    const doc2 = makeDocument({ value: "second" }, stamp2);

    const merged = mergeDocuments(doc1, doc2);
    const result = parseDocument(merged);

    expect(result["value"]).toBe("second");
  });
});

describe("Integration: Partial Updates", () => {
  test("merges non-overlapping fields from different documents", () => {
    const stamp1 = makeStamp(1000, 1);
    const stamp2 = makeStamp(2000, 1);

    const doc1 = makeDocument({ name: "Alice", age: 30 }, stamp1);
    const doc2 = makeDocument({ email: "alice@example.com", city: "NYC" }, stamp2);

    const merged = mergeDocuments(doc1, doc2);
    const result = parseDocument(merged);

    expect(result).toEqual({
      name: "Alice",
      age: 30,
      email: "alice@example.com",
      city: "NYC",
    });
  });

  test("partial update to nested structure", () => {
    const stamp1 = makeStamp(1000, 1);
    const stamp2 = makeStamp(2000, 1);

    const doc1 = makeDocument(
      {
        user: {
          name: "Alice",
          address: {
            city: "NYC",
            zip: 10001,
          },
        },
      },
      stamp1,
    );

    const doc2 = makeDocument(
      {
        user: {
          address: {
            city: "SF",
          },
        },
      },
      stamp2,
    );

    const merged = mergeDocuments(doc1, doc2);
    const result = parseDocument(merged);

    expect(result).toEqual({
      user: {
        name: "Alice",
        address: {
          city: "SF",
          zip: 10001,
        },
      },
    });
  });

  test("adding new nested fields to existing structure", () => {
    const stamp1 = makeStamp(1000, 1);
    const stamp2 = makeStamp(2000, 1);

    const doc1 = makeDocument(
      {
        user: {
          name: "Bob",
        },
      },
      stamp1,
    );

    const doc2 = makeDocument(
      {
        user: {
          email: "bob@example.com",
        },
      },
      stamp2,
    );

    const merged = mergeDocuments(doc1, doc2);
    const result = parseDocument(merged);

    expect(result).toEqual({
      user: {
        name: "Bob",
        email: "bob@example.com",
      },
    });
  });
});

describe("Integration: Complex Nested Structures", () => {
  test("realistic user profile with multiple concurrent updates", () => {
    const stamp1 = makeStamp(1000, 1);
    const stamp2 = makeStamp(2000, 1);
    const stamp3 = makeStamp(3000, 1);

    const doc1 = makeDocument(
      {
        user: {
          name: "Charlie",
          age: 28,
          address: {
            street: "123 Main St",
            city: "Boston",
            zip: 12345,
          },
          settings: {
            theme: "light",
            notifications: true,
          },
        },
      },
      stamp1,
    );

    const doc2 = makeDocument(
      {
        user: {
          address: {
            street: "456 Oak Ave",
            city: "Boston",
          },
        },
      },
      stamp2,
    );

    const doc3 = makeDocument(
      {
        user: {
          age: 29,
          settings: {
            theme: "dark",
          },
        },
      },
      stamp3,
    );

    const merged1 = mergeDocuments(doc1, doc2);
    const merged2 = mergeDocuments(merged1, doc3);
    const result = parseDocument(merged2);

    expect(result).toEqual({
      user: {
        name: "Charlie",
        age: 29,
        address: {
          street: "456 Oak Ave",
          city: "Boston",
          zip: 12345,
        },
        settings: {
          theme: "dark",
          notifications: true,
        },
      },
    });
  });

  test("deeply nested structure maintains integrity", () => {
    const stamp1 = makeStamp(1000, 1);
    const stamp2 = makeStamp(2000, 1);

    const doc1 = makeDocument(
      {
        level1: {
          level2: {
            level3: {
              level4: {
                value: "deep",
              },
            },
          },
        },
      },
      stamp1,
    );

    const doc2 = makeDocument(
      {
        level1: {
          level2: {
            level3: {
              level4: {
                value: "deeper",
                newField: "added",
              },
            },
          },
        },
      },
      stamp2,
    );

    const merged = mergeDocuments(doc1, doc2);
    const result = parseDocument(merged);

    expect(result).toEqual({
      level1: {
        level2: {
          level3: {
            level4: {
              value: "deeper",
              newField: "added",
            },
          },
        },
      },
    });
  });

  test("arrays are treated atomically in merges", () => {
    const stamp1 = makeStamp(1000, 1);
    const stamp2 = makeStamp(2000, 1);

    const doc1 = makeDocument(
      {
        tags: ["javascript", "typescript"],
        metadata: {
          authors: ["Alice", "Bob"],
        },
      },
      stamp1,
    );

    const doc2 = makeDocument(
      {
        tags: ["javascript", "typescript", "node"],
        metadata: {
          version: "1.0.0",
        },
      },
      stamp2,
    );

    const merged = mergeDocuments(doc1, doc2);
    const result = parseDocument(merged);

    expect(result["tags"]).toEqual(["javascript", "typescript", "node"]);
    expect(result["metadata"]).toEqual({
      authors: ["Alice", "Bob"],
      version: "1.0.0",
    });
  });

  test("handles various data types in nested structure", () => {
    const stamp = makeStamp(Date.now(), 1);

    const original = {
      string: "text",
      number: 42,
      boolean: true,
      nullValue: null,
      array: [1, 2, 3],
      nested: {
        date: new Date("2024-01-01"),
        mixed: [{ id: 1 }, { id: 2 }],
      },
    };

    const document = makeDocument(original, stamp);
    const merged = mergeDocuments(document, document);
    const restored = parseDocument(merged);

    expect(restored).toEqual(original);
  });
});
