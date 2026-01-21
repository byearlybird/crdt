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

    store.transact(["users"], ([users]) => {
      users.add({
        id: "1",
        name: "Alice",
        profile: { age: 30 },
      });
    });

    const result = store.read(["users"], ([users]) => users.get("1"));
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

    store.transact(["users"], ([users]) => {
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

    expect(store.read(["users"], ([users]) => users.get("1"))).toBeUndefined();
    expect(store.read(["users"], ([users]) => users.get("2"))).toEqual({
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

    store.transact(["users"], ([users]) => {
      users.add({
        id: "1",
        name: "Alice",
        profile: {},
      });
    });

    store.transact(["users"], ([users]) => {
      users.update("1", {
        profile: { age: 30 },
      });
    });

    const result = store.read(["users"], ([users]) => users.get("1"));
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

    store.transact(["users", "notes"], ([users, notes]) => {
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

    store.transact(["users"], ([users]) => {
      users.add({ id: "1", name: "Alice", profile: {} });
    });
    const snapshotAfterUsers = store.getSnapshot();
    expect(snapshotAfterUsers.collections["users"]).toHaveProperty("1");
    expect(snapshotAfterUsers.collections["notes"]).toEqual({});

    store.transact(["notes"], ([notes]) => {
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
    store.transact(["users"], ([users]) => {
      users.add({ id: "1", name: "Alice", profile: { age: 30 } });
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ users: true });

    // Add a note - should trigger onChange
    store.transact(["notes"], ([notes]) => {
      notes.add({ id: "note-1", content: "First note" });
    });
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({ notes: true });

    // Update a user - should trigger onChange
    store.transact(["users"], ([users]) => {
      users.update("1", { profile: { age: 31 } });
    });
    expect(events).toHaveLength(3);
    expect(events[2]).toEqual({ users: true });

    // Remove a user - should trigger onChange
    store.transact(["users"], ([users]) => {
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

    store.transact(["users"], ([users]) => {
      users.add({ id: "123", name: "Alice", profile: {} });
      users.remove("123");
    });

    // Should be undefined (tombstoned)
    expect(store.read(["users"], ([users]) => users.get("123"))).toBeUndefined();

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

    store.transact(["users"], ([users]) => {
      users.add({ id: "1", name: "Alice", profile: {} });
      users.add({ id: "2", name: "Bob", profile: {} });
      users.add({ id: "3", name: "Charlie", profile: {} });
    });

    expect(store.read(["users"], ([users]) => users.list())).toHaveLength(3);

    store.transact(["users"], ([users]) => {
      users.remove("2");
    });

    const allUsers = store.read(["users"], ([users]) => users.list());
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
    store1.transact(["users"], ([users]) => {
      users.add({ id: "1", name: "Alice", profile: {} });
      users.remove("1");
    });

    // Store2: Add the same user
    store2.transact(["users"], ([users]) => {
      users.add({ id: "1", name: "Alice", profile: {} });
    });

    // Merge store1 into store2
    const snapshot1 = store1.getSnapshot();
    store2.merge(snapshot1);

    // User should still be tombstoned after merge
    expect(store2.read(["users"], ([users]) => users.get("1"))).toBeUndefined();
    expect(store2.read(["users"], ([users]) => users.list())).toHaveLength(0);

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
    store.transact(["users"], ([users]) => {
      users.add({ id: "1", name: "Alice", profile: { age: 30 } });
      users.add({ id: "2", name: "Bob", profile: { age: 25 } });
      users.add({ id: "3", name: "Charlie", profile: { age: 35 } });
    });

    const allUsers = store.read(["users"], ([users]) => users.list());
    expect(allUsers).toHaveLength(3);
    expect(allUsers.find((u) => u.name === "Alice")).toBeDefined();
    expect(allUsers.find((u) => u.name === "Bob")).toBeDefined();
    expect(allUsers.find((u) => u.name === "Charlie")).toBeDefined();

    // Test listing notes
    store.transact(["notes"], ([notes]) => {
      notes.add({ id: "1", content: "First note" });
      notes.add({ id: "2", content: "Second note" });
      notes.add({ id: "3", content: "Third note" });
    });

    const allNotes = store.read(["notes"], ([notes]) => notes.list());
    expect(allNotes).toHaveLength(3);
    expect(allNotes.find((n) => n.content === "First note")).toBeDefined();

    // Test that removed documents don't appear
    store.transact(["users"], ([users]) => {
      users.remove("2");
    });
    const usersAfterRemoval = store.read(["users"], ([users]) => users.list());
    expect(usersAfterRemoval).toHaveLength(2);
    expect(usersAfterRemoval.find((u) => u.id === "2")).toBeUndefined();
    expect(usersAfterRemoval.find((u) => u.id === "1")).toBeDefined();
    expect(usersAfterRemoval.find((u) => u.id === "3")).toBeDefined();

    // Demonstrate filtering with standard array methods
    const adults = store.read(["users"], ([users]) =>
      users.list({ where: (user) => (user.profile?.age ?? 0) >= 30 }),
    );
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
    store1.transact(["users"], ([users]) => {
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
    expect(store2.read(["users"], ([users]) => users.get("1"))).toEqual({
      id: "1",
      name: "Alice",
      profile: { age: 30 },
    });
    expect(store2.read(["users"], ([users]) => users.get("2"))).toEqual({
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
    store1.transact(["users"], ([users]) => {
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
    expect(store2.read(["users"], ([users]) => users.get("1"))).toEqual({
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
    store1.transact(["users"], ([users]) => {
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
    expect(store2.read(["users"], ([users]) => users.get("1"))).toEqual({
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
    store1.transact(["users", "notes"], ([users, notes]) => {
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
    expect(store2.read(["users"], ([users]) => users.get("1"))).toEqual({
      id: "1",
      name: "Alice",
      profile: { age: 30 },
    });
    expect(store2.read(["notes"], ([notes]) => notes.get("note-1"))).toEqual({
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

      expect(store.read(["users"], ([users]) => users.get("1"))).toEqual({
        id: "1",
        name: "Alice",
        profile: { age: 30 },
      });
      expect(store.read(["users"], ([users]) => users.get("2"))).toEqual({
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

      expect(store.read(["users"], ([users]) => users.get("1"))).toEqual({
        id: "1",
        name: "Alice",
        profile: {},
      });
      expect(store.read(["notes"], ([notes]) => notes.get("note-1"))).toEqual({
        id: "note-1",
        content: "Hello",
      });
      expect(store.read(["notes"], ([notes]) => notes.get("note-2"))).toEqual({
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

      store.transact(["users"], ([users]) => {
        users.add({ id: "1", name: "Alice", profile: {} });
      });

      expect(() => {
        store.transact(["users"], ([users]) => {
          users.add({ id: "2", name: "Bob", profile: {} });
          users.update("1", { name: "Alice Updated" });
          throw new Error("Transaction failed");
        });
      }).toThrow("Transaction failed");

      // Changes should not be persisted
      expect(store.read(["users"], ([users]) => users.get("2"))).toBeUndefined();
      expect(store.read(["users"], ([users]) => users.get("1"))?.name).toBe("Alice");
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

      store.transact(["users", "notes"], ([users, notes]) => {
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

      store.transact(["users"], ([users]) => {
        users.add({ id: "1", name: "Alice", profile: { age: 30 } });
      });

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

      store.transact(["users"], ([users]) => {
        users.add({ id: "1", name: "Alice", profile: { age: 30 } });
        users.add({ id: "2", name: "Bob", profile: { age: 25 } });
      });

      const result = store.transact(["users"], ([users]) => {
        const all = users.list();
        users.add({ id: "3", name: "Charlie", profile: { age: 35 } });
        return all.length;
      });

      expect(result).toBe(2); // Should see only the 2 existing users
      expect(store.read(["users"], ([users]) => users.get("3"))).toBeDefined(); // But the new one should be added
    });
  });
});
