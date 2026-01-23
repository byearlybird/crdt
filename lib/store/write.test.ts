import { describe, expect, test } from "vitest";
import { z } from "zod";
import { type Document, type DocumentId, makeDocument, makeStamp, parseDocument } from "../core";
import { createWriteHandle, type WriteDependencies } from "./write";
import { profileSchema, userSchema } from "./test-utils";

// Helper to create test dependencies with mock callbacks
type TestDeps = {
  deps: WriteDependencies<any>;
  addCalls: Array<[DocumentId, Document]>;
  updateCalls: Array<[DocumentId, Document]>;
  removeCalls: Array<[DocumentId, string]>;
  timestampCounter: { value: number };
};

function createTestDeps(
  options: {
    documents?: Record<DocumentId, Document>;
    schema?: any;
    keyPath?: string;
  } = {},
): TestDeps {
  const addCalls: Array<[DocumentId, Document]> = [];
  const updateCalls: Array<[DocumentId, Document]> = [];
  const removeCalls: Array<[DocumentId, string]> = [];

  const timestampCounter = { value: 1000 };
  const getTimestamp = () => makeStamp(timestampCounter.value++, 0);

  const documents = options.documents || {};

  const deps: WriteDependencies<any> = {
    config: {
      schema: options.schema || userSchema,
      keyPath: options.keyPath || "id",
    },
    documents: () => documents,
    getTimestamp,
    callbacks: {
      onAdd: (id, doc) => addCalls.push([id, doc]),
      onUpdate: (id, doc) => updateCalls.push([id, doc]),
      onRemove: (id, stamp) => removeCalls.push([id, stamp]),
    },
  };

  return {
    deps,
    addCalls,
    updateCalls,
    removeCalls,
    timestampCounter,
  };
}

describe("createWriteHandle", () => {
  describe("add()", () => {
    test("validates and adds document with correct callback", () => {
      const { deps, addCalls } = createTestDeps();
      const handle = createWriteHandle(deps);

      handle.add({ id: "1", name: "Alice" });

      expect(addCalls).toHaveLength(1);
      expect(addCalls[0]![0]).toBe("1");

      const document = addCalls[0]![1];
      const parsed = parseDocument(document);
      expect(parsed).toEqual({ id: "1", name: "Alice" });

      // Verify document has ~value and ~stamp structure
      expect(document["id"]?.["~value"]).toBe("1");
      expect(document["id"]?.["~stamp"]).toBeDefined();
      expect(document["name"]?.["~value"]).toBe("Alice");
      expect(document["name"]?.["~stamp"]).toBeDefined();
    });

    test("extracts ID from keyPath correctly", () => {
      const { deps, addCalls } = createTestDeps();
      const handle = createWriteHandle(deps);

      handle.add({ id: "123", name: "Bob" });

      expect(addCalls).toHaveLength(1);
      expect(addCalls[0]![0]).toBe("123");
    });

    test("throws error for invalid data", () => {
      const { deps, addCalls } = createTestDeps();
      const handle = createWriteHandle(deps);

      expect(() => {
        handle.add({ id: "1", name: 123 as any }); // Invalid: name should be string
      }).toThrow();

      expect(addCalls).toHaveLength(0);
    });

    test("works with nested objects", () => {
      const { deps, addCalls } = createTestDeps({ schema: profileSchema });
      const handle = createWriteHandle(deps);

      handle.add({
        id: "1",
        name: "Alice",
        profile: { age: 30, email: "alice@example.com" },
      });

      expect(addCalls).toHaveLength(1);
      expect(addCalls[0]![0]).toBe("1");

      const document = addCalls[0]![1];
      const parsed = parseDocument(document);
      expect(parsed).toEqual({
        id: "1",
        name: "Alice",
        profile: { age: 30, email: "alice@example.com" },
      });

      // Verify nested fields are flattened
      expect(document["profile.age"]?.["~value"]).toBe(30);
      expect(document["profile.age"]?.["~stamp"]).toBeDefined();
      expect(document["profile.email"]?.["~value"]).toBe("alice@example.com");
      expect(document["profile.email"]?.["~stamp"]).toBeDefined();
    });
  });

  describe("update()", () => {
    test("merges partial changes into existing document", () => {
      const existingDoc = makeDocument({ id: "1", name: "Alice" }, makeStamp(500, 0));
      const { deps, updateCalls } = createTestDeps({
        documents: { "1": existingDoc },
      });
      const handle = createWriteHandle(deps);

      handle.update("1", { name: "Bob" });

      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0]![0]).toBe("1");

      const mergedDoc = updateCalls[0]![1];
      const parsed = parseDocument(mergedDoc);
      expect(parsed).toEqual({ id: "1", name: "Bob" });
    });

    test("returns silently for non-existent document", () => {
      const { deps, updateCalls } = createTestDeps();
      const handle = createWriteHandle(deps);

      handle.update("nonexistent", { name: "Bob" });

      expect(updateCalls).toHaveLength(0);
    });

    test("validates merged result against schema", () => {
      const strictSchema = z
        .object({
          id: z.string(),
          name: z.string(),
        })
        .strict();

      const existingDoc = makeDocument({ id: "1", name: "Alice" }, makeStamp(500, 0));
      const { deps, updateCalls } = createTestDeps({
        documents: { "1": existingDoc },
        schema: strictSchema,
      });
      const handle = createWriteHandle(deps);

      expect(() => {
        // Invalid: adding an extra field that's not in schema
        handle.update("1", { name: "Bob", extra: "field" } as any);
      }).toThrow();

      expect(updateCalls).toHaveLength(0);
    });

    test("uses newer timestamps for field-level LWW", () => {
      const oldStamp = makeStamp(500, 0);
      const existingDoc = makeDocument({ id: "1", name: "Alice" }, oldStamp);
      const { deps, updateCalls } = createTestDeps({
        documents: { "1": existingDoc },
      });
      const handle = createWriteHandle(deps);

      handle.update("1", { name: "Bob" });

      expect(updateCalls).toHaveLength(1);
      const mergedDoc = updateCalls[0]![1];

      // Updated field has new timestamp
      const nameStamp = mergedDoc["name"]?.["~stamp"];
      expect(nameStamp).not.toBe(oldStamp);
      expect(nameStamp! > oldStamp).toBe(true);

      // ID field retains old timestamp (wasn't updated)
      expect(mergedDoc["id"]?.["~stamp"]).toBe(oldStamp);
    });

    test("can update subset of fields", () => {
      const oldStamp = makeStamp(500, 0);
      const existingDoc = makeDocument({ id: "1", name: "Alice", profile: { age: 30 } }, oldStamp);
      const { deps, updateCalls } = createTestDeps({
        documents: { "1": existingDoc },
        schema: profileSchema,
      });
      const handle = createWriteHandle(deps);

      handle.update("1", { profile: { email: "alice@example.com" } });

      expect(updateCalls).toHaveLength(1);
      const mergedDoc = updateCalls[0]![1];
      const parsed = parseDocument(mergedDoc);

      // Name field unchanged
      expect(parsed["name"]).toBe("Alice");
      // Profile updated with new field
      expect(parsed["profile"]["email"]).toBe("alice@example.com");
      // Original profile field retained
      expect(parsed["profile"]["age"]).toBe(30);
    });
  });

  describe("remove()", () => {
    test("calls onRemove with id and timestamp", () => {
      const { deps, removeCalls } = createTestDeps();
      const handle = createWriteHandle(deps);

      handle.remove("123");

      expect(removeCalls).toHaveLength(1);
      expect(removeCalls[0]![0]).toBe("123");
      expect(removeCalls[0]![1]).toBeDefined();
      expect(typeof removeCalls[0]![1]).toBe("string");
    });

    test("works even for non-existent documents", () => {
      const { deps, removeCalls } = createTestDeps();
      const handle = createWriteHandle(deps);

      handle.remove("nonexistent");

      // Tombstones are always recorded
      expect(removeCalls).toHaveLength(1);
      expect(removeCalls[0]![0]).toBe("nonexistent");
    });
  });

  describe("integration", () => {
    test("all callbacks receive correct argument types", () => {
      const existingDoc = makeDocument({ id: "1", name: "Alice" }, makeStamp(500, 0));
      const { deps, addCalls, updateCalls, removeCalls } = createTestDeps({
        documents: { "1": existingDoc },
      });
      const handle = createWriteHandle(deps);

      // Test add
      handle.add({ id: "2", name: "Bob" });
      expect(addCalls[0]![0]).toBe("2");
      expect(typeof addCalls[0]![1]).toBe("object");
      expect(addCalls[0]![1]["name"]?.["~value"]).toBe("Bob");

      // Test update
      handle.update("1", { name: "Charlie" });
      expect(updateCalls[0]![0]).toBe("1");
      expect(typeof updateCalls[0]![1]).toBe("object");
      expect(updateCalls[0]![1]["name"]?.["~value"]).toBe("Charlie");

      // Test remove
      handle.remove("1");
      expect(removeCalls[0]![0]).toBe("1");
      expect(typeof removeCalls[0]![1]).toBe("string");
    });

    test("getTimestamp is called for each operation", () => {
      const existingDoc = makeDocument({ id: "1", name: "Alice" }, makeStamp(1000, 0));
      const { deps, timestampCounter } = createTestDeps({
        documents: { "1": existingDoc },
      });
      const handle = createWriteHandle(deps);

      const initialValue = timestampCounter.value;

      handle.add({ id: "2", name: "Bob" });
      expect(timestampCounter.value).toBe(initialValue + 1);

      handle.update("1", { name: "Charlie" });
      expect(timestampCounter.value).toBe(initialValue + 2);

      handle.remove("1");
      expect(timestampCounter.value).toBe(initialValue + 3);
    });

    test("config.keyPath is used to extract ID", () => {
      const customSchema = z.object({
        userId: z.string(),
        name: z.string(),
      });

      const { deps, addCalls } = createTestDeps({
        schema: customSchema,
        keyPath: "userId",
      });
      const handle = createWriteHandle(deps);

      handle.add({ userId: "custom-123", name: "Alice" });

      expect(addCalls).toHaveLength(1);
      expect(addCalls[0]![0]).toBe("custom-123");
    });
  });
});
