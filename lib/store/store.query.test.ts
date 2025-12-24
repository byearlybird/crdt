import { describe, test, expect } from "bun:test";
import { z } from "zod";
import { createStore } from "./store";

const userSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const noteSchema = z.object({
  id: z.string(),
  content: z.string(),
  userId: z.string(),
});

describe("store.query", () => {
  test("creates a reactive query across multiple collections", () => {
    const store = createStore({
      collections: {
        users: {
          schema: userSchema,
        },
        notes: {
          schema: noteSchema,
        },
      },
    });

    // Add some data
    store.users.add({ id: "1", name: "Alice" });
    store.notes.add({ id: "1", content: "Hello", userId: "1" });

    // Create a query
    const $result = store.query(["users", "notes"], ({ users, notes }) => {
      const user = users.get("1");
      const note = notes.get("1");
      return {
        userName: user?.name,
        noteContent: note?.content,
      };
    });

    // Check initial result
    const result = $result.get();
    expect(result.userName).toBe("Alice");
    expect(result.noteContent).toBe("Hello");
  });

  test("query updates when collections change", () => {
    const store = createStore({
      collections: {
        users: {
          schema: userSchema,
        },
        notes: {
          schema: noteSchema,
        },
      },
    });

    // Create a query
    const $result = store.query(["users", "notes"], ({ users, notes }) => {
      return users.size + notes.size;
    });

    // Initial count should be 0
    expect($result.get()).toBe(0);

    // Add data
    store.users.add({ id: "1", name: "Alice" });
    store.notes.add({ id: "1", content: "Hello", userId: "1" });

    // Count should update
    expect($result.get()).toBe(2);
  });

  test("query with single collection", () => {
    const store = createStore({
      collections: {
        users: {
          schema: userSchema,
        },
      },
    });

    store.users.add({ id: "1", name: "Alice" });
    store.users.add({ id: "2", name: "Bob" });

    const $result = store.query(["users"], (s) => {
      return Array.from(s.users.values()).map((u) => u.name);
    });

    const names = $result.get();
    expect(names).toContain("Alice");
    expect(names).toContain("Bob");
    expect(names.length).toBe(2);
  });

  test("query returns undefined for non-existent documents", () => {
    const store = createStore({
      collections: {
        users: {
          schema: userSchema,
        },
      },
    });

    const $result = store.query(["users"], ({ users }) => {
      return users.get("nonexistent");
    });

    expect($result.get()).toBeUndefined();
  });

  test("query can access full data object", () => {
    const store = createStore({
      collections: {
        users: {
          schema: userSchema,
        },
      },
    });

    store.users.add({ id: "1", name: "Alice" });
    store.users.add({ id: "2", name: "Bob" });

    const $result = store.query(["users"], ({ users }) => {
      // Access full data object directly (without .data)
      return Array.from(users.keys());
    });

    const keys = $result.get();
    expect(keys).toEqual(["1", "2"]);
  });
});
