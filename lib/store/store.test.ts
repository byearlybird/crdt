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

    expect(store.transact).toBeDefined();
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

    store.transact(({ users }) => {
      users.add({
        id: "1",
        name: "Alice",
        profile: { age: 30 },
      });
    });

    const result = store.query(({ users }) => users.get("1")).result();
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

    store.transact(({ users }) => {
      users.add({
        id: "1",
        name: "Alice",
        profile: {},
      });

      users.add({
        id: "2",
        name: "Bob",
        profile: {},
      });

      users.remove("1");
    });

    expect(store.query(({ users }) => users.get("1")).result()).toBeUndefined();
    expect(store.query(({ users }) => users.get("2")).result()).toEqual({
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

    store.transact(({ users }) => {
      users.add({
        id: "1",
        name: "Alice",
        profile: {},
      });
    });

    store.transact(({ users }) => {
      users.update("1", {
        profile: { age: 30 },
      });
    });

    const result = store.query(({ users }) => users.get("1")).result();
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
    expect(initialSnapshot.collections["users"]).toEqual({});
    expect(initialSnapshot.collections["notes"]).toEqual({});
    expect(initialSnapshot.tombstones).toEqual({});
    expect(initialSnapshot.clock).toHaveProperty("ms");
    expect(initialSnapshot.clock).toHaveProperty("seq");

    store.transact(({ users, notes }) => {
      users.add({
        id: "1",
        name: "Alice",
        profile: { age: 30 },
      });
      notes.add({
        id: "note-1",
        content: "Hello world",
      });
    });

    const updatedSnapshot = store.getSnapshot();
    expect(updatedSnapshot.collections["users"]).toHaveProperty("1");
    expect(updatedSnapshot.collections["notes"]).toHaveProperty("note-1");
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
    expect(initialSnapshot.collections["users"]).toEqual({});
    expect(initialSnapshot.collections["notes"]).toEqual({});

    store.transact(({ users }) => {
      users.add({ id: "1", name: "Alice", profile: {} });
    });
    const snapshotAfterUsers = store.getSnapshot();
    expect(snapshotAfterUsers.collections["users"]).toHaveProperty("1");
    expect(snapshotAfterUsers.collections["notes"]).toEqual({});

    store.transact(({ notes }) => {
      notes.add({ id: "1", content: "Note" });
    });

    const snapshotAfterNotes = store.getSnapshot();
    expect(snapshotAfterNotes.collections["users"]).toHaveProperty("1");
    expect(snapshotAfterNotes.collections["notes"]).toHaveProperty("1");
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
    store.transact(({ users }) => {
      users.add({ id: "1", name: "Alice", profile: { age: 30 } });
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ users: true });

    // Add a note - should trigger onChange
    store.transact(({ notes }) => {
      notes.add({ id: "note-1", content: "First note" });
    });
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({ notes: true });

    // Update a user - should trigger onChange
    store.transact(({ users }) => {
      users.update("1", { profile: { age: 31 } });
    });
    expect(events).toHaveLength(3);
    expect(events[2]).toEqual({ users: true });

    // Remove a user - should trigger onChange
    store.transact(({ users }) => {
      users.remove("1");
    });
    expect(events).toHaveLength(4);
    expect(events[3]).toEqual({ users: true });

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

    store.transact(({ users }) => {
      users.add({ id: "123", name: "Alice", profile: {} });
      users.remove("123");
    });

    // Should be undefined (tombstoned)
    expect(store.query(({ users }) => users.get("123")).result()).toBeUndefined();

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

    store.transact(({ users }) => {
      users.add({ id: "1", name: "Alice", profile: {} });
      users.add({ id: "2", name: "Bob", profile: {} });
      users.add({ id: "3", name: "Charlie", profile: {} });
    });

    expect(store.query(({ users }) => users.list()).result()).toHaveLength(3);

    store.transact(({ users }) => {
      users.remove("2");
    });

    const allUsers = store.query(({ users }) => users.list()).result();
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
    store1.transact(({ users }) => {
      users.add({ id: "1", name: "Alice", profile: {} });
      users.remove("1");
    });

    // Store2: Add the same user
    store2.transact(({ users }) => {
      users.add({ id: "1", name: "Alice", profile: {} });
    });

    // Merge store1 into store2
    const snapshot1 = store1.getSnapshot();
    store2.merge(snapshot1);

    // User should still be tombstoned after merge
    expect(store2.query(({ users }) => users.get("1")).result()).toBeUndefined();
    expect(store2.query(({ users }) => users.list()).result()).toHaveLength(0);

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
    store.transact(({ users }) => {
      users.add({ id: "1", name: "Alice", profile: { age: 30 } });
      users.add({ id: "2", name: "Bob", profile: { age: 25 } });
      users.add({ id: "3", name: "Charlie", profile: { age: 35 } });
    });

    const allUsers = store.query(({ users }) => users.list()).result();
    expect(allUsers).toHaveLength(3);
    expect(allUsers.find((u) => u.name === "Alice")).toBeDefined();
    expect(allUsers.find((u) => u.name === "Bob")).toBeDefined();
    expect(allUsers.find((u) => u.name === "Charlie")).toBeDefined();

    // Test listing notes
    store.transact(({ notes }) => {
      notes.add({ id: "1", content: "First note" });
      notes.add({ id: "2", content: "Second note" });
      notes.add({ id: "3", content: "Third note" });
    });

    const allNotes = store.query(({ notes }) => notes.list()).result();
    expect(allNotes).toHaveLength(3);
    expect(allNotes.find((n) => n.content === "First note")).toBeDefined();

    // Test that removed documents don't appear
    store.transact(({ users }) => {
      users.remove("2");
    });
    const usersAfterRemoval = store.query(({ users }) => users.list()).result();
    expect(usersAfterRemoval).toHaveLength(2);
    expect(usersAfterRemoval.find((u) => u.id === "2")).toBeUndefined();
    expect(usersAfterRemoval.find((u) => u.id === "1")).toBeDefined();
    expect(usersAfterRemoval.find((u) => u.id === "3")).toBeDefined();

    // Demonstrate filtering with standard array methods
    const adults = store
      .query(({ users }) => users.list({ where: (user) => (user.profile?.age ?? 0) >= 30 }))
      .result();
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
    store1.transact(({ users }) => {
      users.add({ id: "1", name: "Alice", profile: { age: 30 } });
      users.add({ id: "2", name: "Bob", profile: { age: 25 } });
    });

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
    expect(store2.query(({ users }) => users.get("1")).result()).toEqual({
      id: "1",
      name: "Alice",
      profile: { age: 30 },
    });
    expect(store2.query(({ users }) => users.get("2")).result()).toEqual({
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
    store1.transact(({ users }) => {
      users.add({ id: "1", name: "Alice", profile: { age: 30 } });
    });

    // Listen for events on store2
    const events: any[] = [];
    store2.onChange((event) => {
      events.push(event);
    });

    // Merge without silent option (default behavior)
    const snapshot = store1.getSnapshot();
    store2.merge(snapshot);

    // Should emit an event marking users collection as dirty
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ users: true });

    // Data should be merged
    expect(store2.query(({ users }) => users.get("1")).result()).toEqual({
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
    store1.transact(({ users }) => {
      users.add({ id: "1", name: "Alice", profile: { age: 30 } });
    });

    // Listen for events on store2
    const events: any[] = [];
    store2.onChange((event) => {
      events.push(event);
    });

    // Merge with explicit silent: false
    const snapshot = store1.getSnapshot();
    store2.merge(snapshot, { silent: false });

    // Should emit an event marking users collection as dirty
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ users: true });

    // Data should be merged
    expect(store2.query(({ users }) => users.get("1")).result()).toEqual({
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
    store1.transact(({ users, notes }) => {
      users.add({ id: "1", name: "Alice", profile: { age: 30 } });
      notes.add({ id: "note-1", content: "First note" });
    });

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
    expect(store2.query(({ users }) => users.get("1")).result()).toEqual({
      id: "1",
      name: "Alice",
      profile: { age: 30 },
    });
    expect(store2.query(({ notes }) => notes.get("note-1")).result()).toEqual({
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

      store.transact(({ users }) => {
        users.add({ id: "1", name: "Alice", profile: { age: 30 } });
        users.add({ id: "2", name: "Bob", profile: { age: 25 } });
      });

      expect(store.query(({ users }) => users.get("1")).result()).toEqual({
        id: "1",
        name: "Alice",
        profile: { age: 30 },
      });
      expect(store.query(({ users }) => users.get("2")).result()).toEqual({
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

      store.transact(({ users, notes }) => {
        users.add({ id: "1", name: "Alice", profile: {} });
        notes.add({ id: "note-1", content: "Hello" });
        notes.add({ id: "note-2", content: "World" });
      });

      expect(store.query(({ users }) => users.get("1")).result()).toEqual({
        id: "1",
        name: "Alice",
        profile: {},
      });
      expect(store.query(({ notes }) => notes.get("note-1")).result()).toEqual({
        id: "note-1",
        content: "Hello",
      });
      expect(store.query(({ notes }) => notes.get("note-2")).result()).toEqual({
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

      const result = store.transact(({ users }) => {
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

      const stringResult = store.transact(() => "hello");
      expect(stringResult).toBe("hello");

      const numberResult = store.transact(() => 42);
      expect(numberResult).toBe(42);

      const objectResult = store.transact(() => ({ foo: "bar" }));
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

      store.transact(({ users }) => {
        users.add({ id: "1", name: "Alice", profile: {} });
      });

      expect(() => {
        store.transact(({ users }) => {
          users.add({ id: "2", name: "Bob", profile: {} });
          users.update("1", { name: "Alice Updated" });
          throw new Error("Transaction failed");
        });
      }).toThrow("Transaction failed");

      // Changes should not be persisted
      expect(store.query(({ users }) => users.get("2")).result()).toBeUndefined();
      expect(store.query(({ users }) => users.get("1")).result()?.name).toBe("Alice");
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

      store.transact(({ users }) => {
        users.add({ id: "1", name: "Alice", profile: {} });
        users.add({ id: "2", name: "Bob", profile: {} });
        users.update("1", { name: "Alice Updated" });
        users.remove("2");
      });

      // Should have 1 event marking users collection as dirty
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ users: true });
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

      store.transact(({ users, notes }) => {
        users.add({ id: "1", name: "Alice", profile: {} });
        notes.add({ id: "note-1", content: "Hello" });
        users.update("1", { name: "Alice Updated" });
        notes.add({ id: "note-2", content: "World" });
      });

      // Should have 1 event marking both collections as dirty
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ users: true, notes: true });
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

      store.transact(({ users }) => {
        users.add({ id: "1", name: "Alice", profile: { age: 30 } });
      });

      const result = store.transact(({ users }) => {
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

      store.transact(({ users }) => {
        users.add({ id: "1", name: "Alice", profile: { age: 30 } });
        users.add({ id: "2", name: "Bob", profile: { age: 25 } });
      });

      const result = store.transact(({ users }) => {
        const all = users.list();
        users.add({ id: "3", name: "Charlie", profile: { age: 35 } });
        return all.length;
      });

      expect(result).toBe(2); // Should see only the 2 existing users
      expect(store.query(({ users }) => users.get("3")).result()).toBeDefined(); // But the new one should be added
    });
  });

  describe("reactive queries", () => {
    test("query.result() returns current results", () => {
      const store = createStore({
        collections: {
          users: {
            schema: userSchema,
            keyPath: "id",
          },
        },
      });

      store.transact(({ users }) => {
        users.add({ id: "1", name: "Alice", profile: {} });
      });

      const query = store.query(({ users }) => users.get("1"));
      expect(query.result()).toEqual({
        id: "1",
        name: "Alice",
        profile: {},
      });

      store.transact(({ users }) => {
        users.update("1", { name: "Alice Updated" });
      });

      expect(query.result()).toEqual({
        id: "1",
        name: "Alice Updated",
        profile: {},
      });
    });

    test("query.subscribe() receives initial result and updates", () => {
      const store = createStore({
        collections: {
          users: {
            schema: userSchema,
            keyPath: "id",
          },
        },
      });

      store.transact(({ users }) => {
        users.add({ id: "1", name: "Alice", profile: {} });
      });

      const query = store.query(({ users }) => users.get("1"));
      const results: any[] = [];

      const unsubscribe = query.subscribe((result) => {
        results.push(result);
      });

      // Should receive initial result
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        id: "1",
        name: "Alice",
        profile: {},
      });

      // Update should trigger subscription
      store.transact(({ users }) => {
        users.update("1", { name: "Alice Updated" });
      });

      expect(results).toHaveLength(2);
      expect(results[1]).toEqual({
        id: "1",
        name: "Alice Updated",
        profile: {},
      });

      unsubscribe();
    });

    test("query.subscribe() only updates when dependencies change", () => {
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

      store.transact(({ users, notes }) => {
        users.add({ id: "1", name: "Alice", profile: {} });
        notes.add({ id: "note-1", content: "First note" });
      });

      const query = store.query(({ users }) => users.get("1"));
      const results: any[] = [];

      query.subscribe((result) => {
        results.push(result);
      });

      expect(results).toHaveLength(1);

      // Update notes collection - should NOT trigger query update
      store.transact(({ notes }) => {
        notes.add({ id: "note-2", content: "Second note" });
      });

      expect(results).toHaveLength(1); // No update

      // Update users collection - SHOULD trigger query update
      store.transact(({ users }) => {
        users.update("1", { name: "Alice Updated" });
      });

      expect(results).toHaveLength(2); // Updated
    });

    test("query.subscribe() tracks multiple collection dependencies", () => {
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

      store.transact(({ users, notes }) => {
        users.add({ id: "1", name: "Alice", profile: {} });
        notes.add({ id: "note-1", content: "First note" });
      });

      const query = store.query(({ users, notes }) => ({
        user: users.get("1"),
        note: notes.get("note-1"),
      }));

      const results: any[] = [];
      query.subscribe((result) => {
        results.push(result);
      });

      expect(results).toHaveLength(1);

      // Update users - should trigger
      store.transact(({ users }) => {
        users.update("1", { name: "Alice Updated" });
      });

      expect(results).toHaveLength(2);

      // Update notes - should also trigger
      store.transact(({ notes }) => {
        notes.update("note-1", { content: "Updated note" });
      });

      expect(results).toHaveLength(3);
    });

    test("query.subscribe() unsubscribe stops receiving updates", () => {
      const store = createStore({
        collections: {
          users: {
            schema: userSchema,
            keyPath: "id",
          },
        },
      });

      store.transact(({ users }) => {
        users.add({ id: "1", name: "Alice", profile: {} });
      });

      const query = store.query(({ users }) => users.get("1"));
      const results: any[] = [];

      const unsubscribe = query.subscribe((result) => {
        results.push(result);
      });

      expect(results).toHaveLength(1);

      // Unsubscribe
      unsubscribe();

      // Update should NOT trigger subscription
      store.transact(({ users }) => {
        users.update("1", { name: "Alice Updated" });
      });

      expect(results).toHaveLength(1); // No new result
    });

    test("query.subscribe() multiple subscribers all receive updates", () => {
      const store = createStore({
        collections: {
          users: {
            schema: userSchema,
            keyPath: "id",
          },
        },
      });

      store.transact(({ users }) => {
        users.add({ id: "1", name: "Alice", profile: {} });
      });

      const query = store.query(({ users }) => users.get("1"));
      const results1: any[] = [];
      const results2: any[] = [];

      query.subscribe((result) => {
        results1.push(result);
      });

      query.subscribe((result) => {
        results2.push(result);
      });

      expect(results1).toHaveLength(1);
      expect(results2).toHaveLength(1);

      store.transact(({ users }) => {
        users.update("1", { name: "Alice Updated" });
      });

      expect(results1).toHaveLength(2);
      expect(results2).toHaveLength(2);
    });

    test("query.subscribe() does not notify if result hasn't changed", () => {
      const store = createStore({
        collections: {
          users: {
            schema: userSchema,
            keyPath: "id",
          },
        },
      });

      store.transact(({ users }) => {
        users.add({ id: "1", name: "Alice", profile: {} });
      });

      const query = store.query(({ users }) => users.get("1"));
      const results: any[] = [];

      query.subscribe((result) => {
        results.push(result);
      });

      expect(results).toHaveLength(1);

      // Update a different user - should not trigger
      store.transact(({ users }) => {
        users.add({ id: "2", name: "Bob", profile: {} });
      });

      expect(results).toHaveLength(1); // No update because query result didn't change
    });

    test("query works with list() operations", () => {
      const store = createStore({
        collections: {
          users: {
            schema: userSchema,
            keyPath: "id",
          },
        },
      });

      store.transact(({ users }) => {
        users.add({ id: "1", name: "Alice", profile: {} });
        users.add({ id: "2", name: "Bob", profile: {} });
      });

      const query = store.query(({ users }) => users.list());
      const results: any[] = [];

      query.subscribe((result) => {
        results.push(result);
      });

      expect(results).toHaveLength(1);
      expect(results[0]).toHaveLength(2);

      // Add a new user
      store.transact(({ users }) => {
        users.add({ id: "3", name: "Charlie", profile: {} });
      });

      expect(results).toHaveLength(2);
      expect(results[1]).toHaveLength(3);
    });

    test("query works with filtered list() operations", () => {
      const store = createStore({
        collections: {
          users: {
            schema: userSchema,
            keyPath: "id",
          },
        },
      });

      store.transact(({ users }) => {
        users.add({ id: "1", name: "Alice", profile: { age: 30 } });
        users.add({ id: "2", name: "Bob", profile: { age: 25 } });
        users.add({ id: "3", name: "Charlie", profile: { age: 35 } });
      });

      const query = store.query(({ users }) =>
        users.list({ where: (user) => (user.profile?.age ?? 0) >= 30 }),
      );
      const results: any[] = [];

      query.subscribe((result) => {
        results.push(result);
      });

      expect(results).toHaveLength(1);
      expect(results[0]).toHaveLength(2); // Alice and Charlie

      // Update Bob's age to 30 - should now be included
      store.transact(({ users }) => {
        users.update("2", { profile: { age: 30 } });
      });

      expect(results).toHaveLength(2);
      expect(results[1]).toHaveLength(3); // All three now
    });
  });
});
