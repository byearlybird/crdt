import { describe, test, expect } from "vitest";
import { z } from "zod";
import { createStore } from "./store";

const userSchema = z.object({
  id: z.string(),
  name: z.string(),
  profile: z.object({
    age: z.number().optional(),
    email: z.string().optional(),
  }),
});

const noteSchema = z.object({
  id: z.string(),
  content: z.string(),
});

describe("createStore", () => {
  test("creates store with collections", () => {
    const store = createStore({
      collections: {
        users: {
          schema: userSchema,
          keyPath: "id",
        },
        notes: {
          schema: noteSchema,
          keyPath: "id",
        },
      },
    });

    expect(store.add).toBeDefined();
    expect(store.get).toBeDefined();
    expect(store.list).toBeDefined();
    expect(store.update).toBeDefined();
    expect(store.remove).toBeDefined();
    expect(store.getSnapshot).toBeDefined();
    expect(store.merge).toBeDefined();
    expect(store.onChange).toBeDefined();
  });

  test("can add documents to collections", () => {
    const store = createStore({
      collections: {
        users: {
          schema: userSchema,
          keyPath: "id",
        },
      },
    });

    store.add("users", {
      id: "1",
      name: "Alice",
      profile: { age: 30 },
    });

    const result = store.get("users", "1");
    expect(result).toEqual({
      id: "1",
      name: "Alice",
      profile: { age: 30 },
    });
  });

  test("can remove documents from collections", () => {
    const store = createStore({
      collections: {
        users: {
          schema: userSchema,
          keyPath: "id",
        },
      },
    });

    store.add("users", {
      id: "1",
      name: "Alice",
      profile: {},
    });

    store.add("users", {
      id: "2",
      name: "Bob",
      profile: {},
    });

    store.remove("users", "1");

    expect(store.get("users", "1")).toBeUndefined();
    expect(store.get("users", "2")).toEqual({
      id: "2",
      name: "Bob",
      profile: {},
    });
  });

  test("can update documents in collections", () => {
    const store = createStore({
      collections: {
        users: {
          schema: userSchema,
          keyPath: "id",
        },
      },
    });

    store.add("users", {
      id: "1",
      name: "Alice",
      profile: {},
    });

    store.update("users", "1", {
      profile: { age: 30 },
    });

    const result = store.get("users", "1");
    expect(result).toEqual({
      id: "1",
      name: "Alice",
      profile: { age: 30 },
    });
  });

  test("getSnapshot returns store snapshot with clock and collections", () => {
    const store = createStore({
      collections: {
        users: {
          schema: userSchema,
          keyPath: "id",
        },
        notes: {
          schema: noteSchema,
          keyPath: "id",
        },
      },
    });

    const initialSnapshot = store.getSnapshot();
    expect(initialSnapshot).toHaveProperty("clock");
    expect(initialSnapshot).toHaveProperty("collections");
    expect(initialSnapshot).toHaveProperty("tombstones");
    expect(initialSnapshot.collections["users"]).toEqual({
      documents: {},
    });
    expect(initialSnapshot.collections["notes"]).toEqual({
      documents: {},
    });
    expect(initialSnapshot.tombstones).toEqual({});
    expect(initialSnapshot.clock).toHaveProperty("ms");
    expect(initialSnapshot.clock).toHaveProperty("seq");

    store.add("users", {
      id: "1",
      name: "Alice",
      profile: { age: 30 },
    });
    store.add("notes", {
      id: "note-1",
      content: "Hello world",
    });

    const updatedSnapshot = store.getSnapshot();
    expect(updatedSnapshot.collections["users"]?.documents).toHaveProperty("1");
    expect(updatedSnapshot.collections["notes"]?.documents).toHaveProperty("note-1");
    expect(updatedSnapshot.tombstones).toEqual({});
  });

  test("creates store with empty collections", () => {
    const store = createStore({
      collections: {},
    });

    expect(store).toBeDefined();
    expect(store.getSnapshot).toBeDefined();
    expect(store.getSnapshot().collections).toEqual({});
    expect(store.getSnapshot().clock).toBeDefined();
  });

  test("getSnapshot updates when collections change", () => {
    const store = createStore({
      collections: {
        users: {
          schema: userSchema,
          keyPath: "id",
        },
        notes: {
          schema: noteSchema,
          keyPath: "id",
        },
      },
    });

    const initialSnapshot = store.getSnapshot();
    expect(initialSnapshot.collections["users"]?.documents).toEqual({});
    expect(initialSnapshot.collections["notes"]?.documents).toEqual({});

    store.add("users", { id: "1", name: "Alice", profile: {} });
    const snapshotAfterUsers = store.getSnapshot();
    expect(snapshotAfterUsers.collections["users"]?.documents).toHaveProperty("1");
    expect(snapshotAfterUsers.collections["notes"]?.documents).toEqual({});

    store.add("notes", { id: "1", content: "Note" });
    const snapshotAfterNotes = store.getSnapshot();
    expect(snapshotAfterNotes.collections["users"]?.documents).toHaveProperty("1");
    expect(snapshotAfterNotes.collections["notes"]?.documents).toHaveProperty("1");
  });

  test("merge updates clock and collections", () => {
    const store = createStore({
      collections: {
        users: {
          schema: userSchema,
          keyPath: "id",
        },
      },
    });

    const snapshot = store.getSnapshot();
    const futureSnapshot = {
      clock: { ms: snapshot.clock.ms + 1000, seq: 5 },
      collections: snapshot.collections,
      tombstones: {},
    };

    store.merge(futureSnapshot);

    const updated = store.getSnapshot();
    expect(updated.clock.ms).toBe(futureSnapshot.clock.ms);
    expect(updated.clock.seq).toBe(futureSnapshot.clock.seq);
  });

  test("onChange is called when store changes", () => {
    const store = createStore({
      collections: {
        users: {
          schema: userSchema,
          keyPath: "id",
        },
        notes: {
          schema: noteSchema,
          keyPath: "id",
        },
      },
    });

    const events: any[] = [];
    const unsubscribe = store.onChange((event) => {
      events.push(event);
    });

    // Add a user - should trigger onChange
    store.add("users", { id: "1", name: "Alice", profile: { age: 30 } });
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual([
      {
        collection: "users",
        mutated: ["1"],
        removed: [],
      },
    ]);

    // Add a note - should trigger onChange
    store.add("notes", { id: "note-1", content: "First note" });
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual([
      {
        collection: "notes",
        mutated: ["note-1"],
        removed: [],
      },
    ]);

    // Update a user - should trigger onChange
    store.update("users", "1", { profile: { age: 31 } });
    expect(events).toHaveLength(3);
    expect(events[2]).toEqual([
      {
        collection: "users",
        mutated: ["1"],
        removed: [],
      },
    ]);

    // Remove a user - should trigger onChange
    store.remove("users", "1");
    expect(events).toHaveLength(4);
    expect(events[3]).toEqual([
      {
        collection: "users",
        mutated: [],
        removed: ["1"],
      },
    ]);

    unsubscribe();
  });

  test("tombstones are store-level and globally unique", () => {
    const store = createStore({
      collections: {
        users: {
          schema: userSchema,
          keyPath: "id",
        },
        notes: {
          schema: noteSchema,
          keyPath: "id",
        },
      },
    });

    store.add("users", { id: "123", name: "Alice", profile: {} });
    store.remove("users", "123");

    // Should be undefined (tombstoned)
    expect(store.get("users", "123")).toBeUndefined();

    // Snapshot should have store-level tombstones
    const snapshot = store.getSnapshot();
    expect(snapshot.tombstones).toHaveProperty("123");
    expect(snapshot.tombstones["123"]).toBeDefined();

    // Collections should not have tombstones field
    expect(snapshot.collections["users"]).not.toHaveProperty("tombstones");
    expect(snapshot.collections["notes"]).not.toHaveProperty("tombstones");
  });

  test("removed documents don't appear in list", () => {
    const store = createStore({
      collections: {
        users: {
          schema: userSchema,
          keyPath: "id",
        },
      },
    });

    store.add("users", { id: "1", name: "Alice", profile: {} });
    store.add("users", { id: "2", name: "Bob", profile: {} });
    store.add("users", { id: "3", name: "Charlie", profile: {} });

    expect(store.list("users")).toHaveLength(3);

    store.remove("users", "2");

    const allUsers = store.list("users");
    expect(allUsers).toHaveLength(2);
    expect(allUsers.find((u) => u.id === "2")).toBeUndefined();
    expect(allUsers.find((u) => u.id === "1")).toBeDefined();
    expect(allUsers.find((u) => u.id === "3")).toBeDefined();
  });

  test("tombstones persist across merge", () => {
    const store1 = createStore({
      collections: {
        users: { schema: userSchema, keyPath: "id" },
      },
    });

    const store2 = createStore({
      collections: {
        users: { schema: userSchema, keyPath: "id" },
      },
    });

    // Store1: Add and remove a user
    store1.add("users", { id: "1", name: "Alice", profile: {} });
    store1.remove("users", "1");

    // Store2: Add the same user
    store2.add("users", { id: "1", name: "Alice", profile: {} });

    // Merge store1 into store2
    const snapshot1 = store1.getSnapshot();
    store2.merge(snapshot1);

    // User should still be tombstoned after merge
    expect(store2.get("users", "1")).toBeUndefined();
    expect(store2.list("users")).toHaveLength(0);

    const snapshot2 = store2.getSnapshot();
    expect(snapshot2.tombstones).toHaveProperty("1");
  });

  test("list returns all non-tombstoned documents", () => {
    const store = createStore({
      collections: {
        users: {
          schema: userSchema,
          keyPath: "id",
        },
        notes: {
          schema: noteSchema,
          keyPath: "id",
        },
      },
    });

    // Test listing users
    store.add("users", { id: "1", name: "Alice", profile: { age: 30 } });
    store.add("users", { id: "2", name: "Bob", profile: { age: 25 } });
    store.add("users", { id: "3", name: "Charlie", profile: { age: 35 } });

    const allUsers = store.list("users");
    expect(allUsers).toHaveLength(3);
    expect(allUsers.find((u) => u.name === "Alice")).toBeDefined();
    expect(allUsers.find((u) => u.name === "Bob")).toBeDefined();
    expect(allUsers.find((u) => u.name === "Charlie")).toBeDefined();

    // Test listing notes
    store.add("notes", { id: "1", content: "First note" });
    store.add("notes", { id: "2", content: "Second note" });
    store.add("notes", { id: "3", content: "Third note" });

    const allNotes = store.list("notes");
    expect(allNotes).toHaveLength(3);
    expect(allNotes.find((n) => n.content === "First note")).toBeDefined();

    // Test that removed documents don't appear
    store.remove("users", "2");
    const usersAfterRemoval = store.list("users");
    expect(usersAfterRemoval).toHaveLength(2);
    expect(usersAfterRemoval.find((u) => u.id === "2")).toBeUndefined();
    expect(usersAfterRemoval.find((u) => u.id === "1")).toBeDefined();
    expect(usersAfterRemoval.find((u) => u.id === "3")).toBeDefined();

    // Demonstrate filtering with standard array methods
    const adults = store.list("users").filter((user) => (user.profile?.age ?? 0) >= 30);
    expect(adults).toHaveLength(2);
    expect(adults.find((u) => u.name === "Alice")).toBeDefined();
    expect(adults.find((u) => u.name === "Charlie")).toBeDefined();
  });

  test("merge with silent: true does not emit events", () => {
    const store1 = createStore({
      collections: {
        users: { schema: userSchema, keyPath: "id" },
      },
    });

    const store2 = createStore({
      collections: {
        users: { schema: userSchema, keyPath: "id" },
      },
    });

    // Add data to store1
    store1.add("users", { id: "1", name: "Alice", profile: { age: 30 } });
    store1.add("users", { id: "2", name: "Bob", profile: { age: 25 } });

    // Listen for events on store2
    const events: any[] = [];
    store2.onChange((event) => {
      events.push(event);
    });

    // Merge with silent: true
    const snapshot = store1.getSnapshot();
    store2.merge(snapshot, { silent: true });

    // No events should have been emitted
    expect(events).toHaveLength(0);

    // But the data should still be merged
    expect(store2.get("users", "1")).toEqual({
      id: "1",
      name: "Alice",
      profile: { age: 30 },
    });
    expect(store2.get("users", "2")).toEqual({
      id: "2",
      name: "Bob",
      profile: { age: 25 },
    });
  });

  test("merge without silent option emits merge events", () => {
    const store1 = createStore({
      collections: {
        users: { schema: userSchema, keyPath: "id" },
      },
    });

    const store2 = createStore({
      collections: {
        users: { schema: userSchema, keyPath: "id" },
      },
    });

    // Add data to store1
    store1.add("users", { id: "1", name: "Alice", profile: { age: 30 } });

    // Listen for events on store2
    const events: any[] = [];
    store2.onChange((event) => {
      events.push(event);
    });

    // Merge without silent option (default behavior)
    const snapshot = store1.getSnapshot();
    store2.merge(snapshot);

    // Should emit a batched event with mutated items
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual([
      {
        collection: "users",
        mutated: ["1"],
        removed: [],
      },
    ]);

    // Data should be merged
    expect(store2.get("users", "1")).toEqual({
      id: "1",
      name: "Alice",
      profile: { age: 30 },
    });
  });

  test("merge with silent: false emits merge events", () => {
    const store1 = createStore({
      collections: {
        users: { schema: userSchema, keyPath: "id" },
      },
    });

    const store2 = createStore({
      collections: {
        users: { schema: userSchema, keyPath: "id" },
      },
    });

    // Add data to store1
    store1.add("users", { id: "1", name: "Alice", profile: { age: 30 } });

    // Listen for events on store2
    const events: any[] = [];
    store2.onChange((event) => {
      events.push(event);
    });

    // Merge with explicit silent: false
    const snapshot = store1.getSnapshot();
    store2.merge(snapshot, { silent: false });

    // Should emit a batched event with mutated items
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual([
      {
        collection: "users",
        mutated: ["1"],
        removed: [],
      },
    ]);

    // Data should be merged
    expect(store2.get("users", "1")).toEqual({
      id: "1",
      name: "Alice",
      profile: { age: 30 },
    });
  });

  test("merge with silent: true emits no events for multiple collections", () => {
    const store1 = createStore({
      collections: {
        users: { schema: userSchema, keyPath: "id" },
        notes: { schema: noteSchema, keyPath: "id" },
      },
    });

    const store2 = createStore({
      collections: {
        users: { schema: userSchema, keyPath: "id" },
        notes: { schema: noteSchema, keyPath: "id" },
      },
    });

    // Add data to store1
    store1.add("users", { id: "1", name: "Alice", profile: { age: 30 } });
    store1.add("notes", { id: "note-1", content: "First note" });

    // Listen for events on store2
    const events: any[] = [];
    store2.onChange((event) => {
      events.push(event);
    });

    // Merge with silent: true
    const snapshot = store1.getSnapshot();
    store2.merge(snapshot, { silent: true });

    // No events should have been emitted for either collection
    expect(events).toHaveLength(0);

    // But the data should still be merged for both collections
    expect(store2.get("users", "1")).toEqual({
      id: "1",
      name: "Alice",
      profile: { age: 30 },
    });
    expect(store2.get("notes", "note-1")).toEqual({
      id: "note-1",
      content: "First note",
    });
  });

  describe("transact", () => {
    test("transact with single collection", () => {
      const store = createStore({
        collections: {
          users: {
            schema: userSchema,
            keyPath: "id",
          },
        },
      });

      store.transact(["users"], ([users]) => {
        users.add({ id: "1", name: "Alice", profile: { age: 30 } });
        users.add({ id: "2", name: "Bob", profile: { age: 25 } });
      });

      expect(store.get("users", "1")).toEqual({
        id: "1",
        name: "Alice",
        profile: { age: 30 },
      });
      expect(store.get("users", "2")).toEqual({
        id: "2",
        name: "Bob",
        profile: { age: 25 },
      });
    });

    test("transact with multiple collections", () => {
      const store = createStore({
        collections: {
          users: {
            schema: userSchema,
            keyPath: "id",
          },
          notes: {
            schema: noteSchema,
            keyPath: "id",
          },
        },
      });

      store.transact(["users", "notes"], ([users, notes]) => {
        users.add({ id: "1", name: "Alice", profile: {} });
        notes.add({ id: "note-1", content: "Hello" });
        notes.add({ id: "note-2", content: "World" });
      });

      expect(store.get("users", "1")).toEqual({
        id: "1",
        name: "Alice",
        profile: {},
      });
      expect(store.get("notes", "note-1")).toEqual({
        id: "note-1",
        content: "Hello",
      });
      expect(store.get("notes", "note-2")).toEqual({
        id: "note-2",
        content: "World",
      });
    });

    test("transact returns callback return value", () => {
      const store = createStore({
        collections: {
          users: {
            schema: userSchema,
            keyPath: "id",
          },
        },
      });

      const result = store.transact(["users"], ([users]) => {
        users.add({ id: "1", name: "Alice", profile: { age: 30 } });
        return users.get("1");
      });

      expect(result).toEqual({
        id: "1",
        name: "Alice",
        profile: { age: 30 },
      });
    });

    test("transact returns different types", () => {
      const store = createStore({
        collections: {
          users: {
            schema: userSchema,
            keyPath: "id",
          },
        },
      });

      const stringResult = store.transact(["users"], () => "hello");
      expect(stringResult).toBe("hello");

      const numberResult = store.transact(["users"], () => 42);
      expect(numberResult).toBe(42);

      const objectResult = store.transact(["users"], () => ({ foo: "bar" }));
      expect(objectResult).toEqual({ foo: "bar" });
    });

    test("transact rolls back on error", () => {
      const store = createStore({
        collections: {
          users: {
            schema: userSchema,
            keyPath: "id",
          },
        },
      });

      store.add("users", { id: "1", name: "Alice", profile: {} });

      expect(() => {
        store.transact(["users"], ([users]) => {
          users.add({ id: "2", name: "Bob", profile: {} });
          users.update("1", { name: "Alice Updated" });
          throw new Error("Transaction failed");
        });
      }).toThrow("Transaction failed");

      // Changes should not be persisted
      expect(store.get("users", "2")).toBeUndefined();
      expect(store.get("users", "1")?.name).toBe("Alice");
    });

    test("transact batches notifications", () => {
      const store = createStore({
        collections: {
          users: {
            schema: userSchema,
            keyPath: "id",
          },
        },
      });

      const events: any[] = [];
      store.onChange((event) => {
        events.push(event);
      });

      store.transact(["users"], ([users]) => {
        users.add({ id: "1", name: "Alice", profile: {} });
        users.add({ id: "2", name: "Bob", profile: {} });
        users.update("1", { name: "Alice Updated" });
        users.remove("2");
      });

      // Should have 1 batched event with all changes
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual([
        {
          collection: "users",
          mutated: ["1"],
          removed: ["2"],
        },
      ]);
    });

    test("transact with multiple collections batches notifications across collections", () => {
      const store = createStore({
        collections: {
          users: {
            schema: userSchema,
            keyPath: "id",
          },
          notes: {
            schema: noteSchema,
            keyPath: "id",
          },
        },
      });

      const events: any[] = [];
      store.onChange((event) => {
        events.push(event);
      });

      store.transact(["users", "notes"], ([users, notes]) => {
        users.add({ id: "1", name: "Alice", profile: {} });
        notes.add({ id: "note-1", content: "Hello" });
        users.update("1", { name: "Alice Updated" });
        notes.add({ id: "note-2", content: "World" });
      });

      // Should have 1 batched event with changes from both collections
      expect(events).toHaveLength(1);
      expect(events[0]).toHaveLength(2);
      const usersChange = events[0].find((c: any) => c.collection === "users");
      const notesChange = events[0].find((c: any) => c.collection === "notes");
      expect(usersChange).toEqual({
        collection: "users",
        mutated: ["1"],
        removed: [],
      });
      expect(notesChange).toEqual({
        collection: "notes",
        mutated: ["note-1", "note-2"],
        removed: [],
      });
    });

    test("transact can read within transaction", () => {
      const store = createStore({
        collections: {
          users: {
            schema: userSchema,
            keyPath: "id",
          },
        },
      });

      store.add("users", { id: "1", name: "Alice", profile: { age: 30 } });

      const result = store.transact(["users"], ([users]) => {
        const user = users.get("1");
        if (user) {
          users.update("1", { profile: { age: 31 } });
        }
        return users.get("1");
      });

      expect(result?.profile?.age).toBe(31);
    });

    test("transact list works within transaction", () => {
      const store = createStore({
        collections: {
          users: {
            schema: userSchema,
            keyPath: "id",
          },
        },
      });

      store.add("users", { id: "1", name: "Alice", profile: { age: 30 } });
      store.add("users", { id: "2", name: "Bob", profile: { age: 25 } });

      const result = store.transact(["users"], ([users]) => {
        const all = users.list();
        users.add({ id: "3", name: "Charlie", profile: { age: 35 } });
        return all.length;
      });

      expect(result).toBe(2); // Should see only the 2 existing users
      expect(store.get("users", "3")).toBeDefined(); // But the new one should be added
    });

    test("convenience methods still work (add, update, remove)", () => {
      const store = createStore({
        collections: {
          users: {
            schema: userSchema,
            keyPath: "id",
          },
        },
      });

      // These should all work the same as before
      store.add("users", { id: "1", name: "Alice", profile: {} });
      expect(store.get("users", "1")?.name).toBe("Alice");

      store.update("users", "1", { name: "Alice Updated" });
      expect(store.get("users", "1")?.name).toBe("Alice Updated");

      store.remove("users", "1");
      expect(store.get("users", "1")).toBeUndefined();
    });

    test("convenience methods still emit notifications", () => {
      const store = createStore({
        collections: {
          users: {
            schema: userSchema,
            keyPath: "id",
          },
        },
      });

      const events: any[] = [];
      store.onChange((event) => {
        events.push(event);
      });

      store.add("users", { id: "1", name: "Alice", profile: {} });
      store.update("users", "1", { name: "Alice Updated" });
      store.remove("users", "1");

      // Each convenience method should emit one batched event
      expect(events).toHaveLength(3);
      expect(events[0]).toEqual([
        {
          collection: "users",
          mutated: ["1"],
          removed: [],
        },
      ]);
      expect(events[1]).toEqual([
        {
          collection: "users",
          mutated: ["1"],
          removed: [],
        },
      ]);
      expect(events[2]).toEqual([
        {
          collection: "users",
          mutated: [],
          removed: ["1"],
        },
      ]);
    });
  });
});
