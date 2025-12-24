import { describe, test, expect } from "bun:test";
import { z } from "zod";
import { createStore, type StoreSnapshot } from "./store";
import type { Collection } from "../core/collection";

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
        },
        notes: {
          schema: noteSchema,
        },
      },
    });

    expect(store.users).toBeDefined();
    expect(store.notes).toBeDefined();
    expect(store.users.$data).toBeDefined();
    expect(store.users.$snapshot).toBeDefined();
    expect(store.notes.$data).toBeDefined();
    expect(store.notes.$snapshot).toBeDefined();
  });

  test("can add documents to collections", () => {
    const store = createStore({
      collections: {
        users: {
          schema: userSchema,
        },
      },
    });

    store.users.add({
      id: "1",
      name: "Alice",
      profile: { age: 30 },
    });

    const result = store.users.$data.get().get("1");
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
        },
      },
    });

    store.users.add({
      id: "1",
      name: "Alice",
      profile: {},
    });
    store.users.add({
      id: "2",
      name: "Bob",
      profile: {},
    });

    store.users.remove("1");

    expect(store.users.$data.get().get("1")).toBeUndefined();
    expect(store.users.$data.get().get("2")).toEqual({
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
        },
      },
    });

    store.users.add({
      id: "1",
      name: "Alice",
      profile: {},
    });

    store.users.update("1", {
      profile: { age: 30 },
    });

    const result = store.users.$data.get().get("1");
    expect(result).toEqual({
      id: "1",
      name: "Alice",
      profile: { age: 30 },
    });
  });

  test("works with custom getId function", () => {
    const store = createStore({
      collections: {
        users: {
          schema: userSchema,
          getId: (data) => `user-${data.id}`,
        },
      },
    });

    store.users.add({
      id: "1",
      name: "Alice",
      profile: {},
    });

    expect(store.users.$data.get().get("user-1")).toEqual({
      id: "1",
      name: "Alice",
      profile: {},
    });
    expect(store.users.$data.get().get("1")).toBeUndefined();
  });

  test("ReadonlyMap methods work correctly", () => {
    const store = createStore({
      collections: {
        users: {
          schema: userSchema,
        },
      },
    });

    expect(store.users.size).toBe(0);
    expect(store.users.has("1")).toBe(false);
    expect(store.users.get("1")).toBeUndefined();

    store.users.add({
      id: "1",
      name: "Alice",
      profile: { age: 30 },
    });
    store.users.add({
      id: "2",
      name: "Bob",
      profile: { age: 25 },
    });
    store.users.add({
      id: "3",
      name: "Charlie",
      profile: { age: 35 },
    });

    expect(store.users.size).toBe(3);
    expect(store.users.get("1")?.name).toBe("Alice");
    expect(store.users.get("nonexistent")).toBeUndefined();
    expect(store.users.has("1")).toBe(true);
    expect(store.users.has("nonexistent")).toBe(false);

    const keys = Array.from(store.users.keys());
    expect(keys).toHaveLength(3);
    expect(keys).toContain("1");

    const values = Array.from(store.users.values());
    expect(values).toHaveLength(3);
    expect(values.some((v) => v.name === "Alice")).toBe(true);

    const entries = Array.from(store.users.entries());
    expect(entries).toHaveLength(3);
    expect(new Map(entries).get("1")?.name).toBe("Alice");

    store.users.remove("2");
    expect(store.users.size).toBe(2);
    expect(store.users.has("2")).toBe(false);
  });

  test("$snapshot returns store snapshot with clock and collections", () => {
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

    const initialSnapshot = store.$snapshot.get();
    expect(initialSnapshot).toHaveProperty("clock");
    expect(initialSnapshot).toHaveProperty("collections");
    expect(initialSnapshot.collections["users"]).toEqual({
      documents: {},
      tombstones: {},
    });
    expect(initialSnapshot.collections["notes"]).toEqual({
      documents: {},
      tombstones: {},
    });
    expect(initialSnapshot.clock).toHaveProperty("ms");
    expect(initialSnapshot.clock).toHaveProperty("seq");

    store.users.add({
      id: "1",
      name: "Alice",
      profile: { age: 30 },
    });
    store.notes.add({
      id: "note-1",
      content: "Hello world",
    });

    const updatedSnapshot = store.$snapshot.get();
    expect(updatedSnapshot.collections["users"]?.documents).toHaveProperty("1");
    expect(updatedSnapshot.collections["notes"]?.documents).toHaveProperty(
      "note-1",
    );
    expect(updatedSnapshot.collections["users"]?.tombstones).toEqual({});
    expect(updatedSnapshot.collections["notes"]?.tombstones).toEqual({});
  });

  test("creates store with empty collections", () => {
    const store = createStore({
      collections: {},
    });

    expect(store).toBeDefined();
    expect(store.$snapshot).toBeDefined();
    expect(store.$snapshot.get().collections).toEqual({});
    expect(store.$snapshot.get().clock).toBeDefined();
  });

  test("$snapshot is reactive and updates when collections change", () => {
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

    const initialSnapshot = store.$snapshot.get();
    expect(initialSnapshot.collections["users"]?.documents).toEqual({});
    expect(initialSnapshot.collections["notes"]?.documents).toEqual({});

    store.users.add({ id: "1", name: "Alice", profile: {} });
    const snapshotAfterUsers = store.$snapshot.get();
    expect(snapshotAfterUsers.collections["users"]?.documents).toHaveProperty(
      "1",
    );
    expect(snapshotAfterUsers.collections["notes"]?.documents).toEqual({});

    store.notes.add({ id: "1", content: "Note" });
    const snapshotAfterNotes = store.$snapshot.get();
    expect(snapshotAfterNotes.collections["users"]?.documents).toHaveProperty(
      "1",
    );
    expect(snapshotAfterNotes.collections["notes"]?.documents).toHaveProperty(
      "1",
    );
  });

  test("query returns reactive atom with selected collections data", () => {
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

    store.users.add({ id: "1", name: "Alice", profile: { age: 30 } });
    store.users.add({ id: "2", name: "Bob", profile: { age: 25 } });
    store.notes.add({ id: "note-1", content: "First note" });

    const $result = store.query(["users", "notes"] as const, (collections) => {
      return {
        userCount: collections.users.size,
        noteCount: collections.notes.size,
        firstUser: collections.users.get("1"),
      };
    });

    const result = $result.get();
    expect(result.userCount).toBe(2);
    expect(result.noteCount).toBe(1);
    expect(result.firstUser).toEqual({
      id: "1",
      name: "Alice",
      profile: { age: 30 },
    });

    store.users.add({ id: "3", name: "Charlie", profile: { age: 35 } });

    const updatedResult = $result.get();
    expect(updatedResult.userCount).toBe(3);
  });

  test("query subscribe is called when collections change", () => {
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

    store.users.add({ id: "1", name: "Alice", profile: { age: 30 } });
    store.users.add({ id: "2", name: "Bob", profile: { age: 25 } });
    store.notes.add({ id: "note-1", content: "First note" });

    const $result = store.query(["users", "notes"] as const, (collections) => {
      return {
        userCount: collections.users.size,
        noteCount: collections.notes.size,
        firstUser: collections.users.get("1"),
      };
    });

    const results: any[] = [];
    const unsubscribe = $result.subscribe((result) => {
      results.push(result);
    });

    // Subscribe should be called immediately with current result
    expect(results).toHaveLength(1);
    expect(results[0]!.userCount).toBe(2);
    expect(results[0]!.noteCount).toBe(1);

    // Add a user - should trigger subscribe synchronously
    store.users.add({ id: "3", name: "Charlie", profile: { age: 35 } });
    expect(results).toHaveLength(2);
    expect(results[1]!.userCount).toBe(3);
    expect(results[1]!.noteCount).toBe(1);

    // Add a note - should trigger subscribe synchronously
    store.notes.add({ id: "note-2", content: "Second note" });
    expect(results).toHaveLength(3);
    expect(results[2]!.userCount).toBe(3);
    expect(results[2]!.noteCount).toBe(2);

    unsubscribe();
  });

  test("merge updates clock and collections", () => {
    const store = createStore({
      collections: {
        users: {
          schema: userSchema,
        },
      },
    });

    const snapshot = store.$snapshot.get();
    const futureSnapshot = {
      clock: { ms: snapshot.clock.ms + 1000, seq: 5 },
      collections: snapshot.collections,
    };

    store.merge(futureSnapshot);

    const updated = store.$snapshot.get();
    expect(updated.clock.ms).toBe(futureSnapshot.clock.ms);
    expect(updated.clock.seq).toBe(futureSnapshot.clock.seq);
  });

  test("forEach iterates over collection entries", () => {
    const store = createStore({
      collections: {
        users: {
          schema: userSchema,
        },
      },
    });

    store.users.add({ id: "1", name: "Alice", profile: { age: 30 } });
    store.users.add({ id: "2", name: "Bob", profile: { age: 25 } });

    const names: string[] = [];
    store.users.forEach((user) => {
      names.push(user.name);
    });

    expect(names).toHaveLength(2);
    expect(names).toContain("Alice");
    expect(names).toContain("Bob");
  });

  test("$snapshot subscribe is called when store changes", () => {
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

    const snapshots: StoreSnapshot[] = [];
    const unsubscribe = store.$snapshot.subscribe((snapshot) => {
      snapshots.push(snapshot);
    });

    // Subscribe should be called immediately with initial snapshot
    // Per nanostores docs: "Store#subscribe() calls callback immediately"
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]!.collections["users"]?.documents).toEqual({});
    expect(snapshots[0]!.collections["notes"]?.documents).toEqual({});


    // Add a user - should trigger subscribe synchronously
    // Per nanostores docs: subscribe is called on store changes
    store.users.add({ id: "1", name: "Alice", profile: { age: 30 } });
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1]!.collections["users"]?.documents).toHaveProperty("1");
    expect(snapshots[1]!.collections["notes"]?.documents).toEqual({});

    // Add a note - should trigger subscribe synchronously
    store.notes.add({ id: "note-1", content: "First note" });
    expect(snapshots).toHaveLength(3);
    expect(snapshots[2]!.collections["users"]?.documents).toHaveProperty("1");
    expect(snapshots[2]!.collections["notes"]?.documents).toHaveProperty(
      "note-1",
    );

    // Update a user - should trigger subscribe synchronously
    store.users.update("1", { profile: { age: 31 } });
    expect(snapshots).toHaveLength(4);
    expect(snapshots[3]!.collections["users"]?.documents).toHaveProperty("1");

    // Remove a user - should trigger subscribe synchronously
    store.users.remove("1");
    expect(snapshots).toHaveLength(5);
    expect(snapshots[4]!.collections["users"]?.documents).not.toHaveProperty(
      "1",
    );

    unsubscribe();
  });

  test("collection $snapshot subscribe is called when collection changes", () => {
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

    const collectionSnapshots: Collection[] = [];
    const unsubscribe = store.users.$snapshot.subscribe((snapshot) => {
      collectionSnapshots.push(snapshot);
    });

    // Subscribe should be called immediately with initial snapshot
    // Per nanostores docs: "Store#subscribe() calls callback immediately"
    expect(collectionSnapshots).toHaveLength(1);
    expect(collectionSnapshots[0]!.documents).toEqual({});
    expect(collectionSnapshots[0]!.tombstones).toEqual({});

    // Add a user - should trigger subscribe synchronously
    // Per nanostores docs: subscribe is called on store changes
    store.users.add({ id: "1", name: "Alice", profile: { age: 30 } });
    expect(collectionSnapshots).toHaveLength(2);
    expect(collectionSnapshots[1]!.documents).toHaveProperty("1");
    expect(collectionSnapshots[1]!.tombstones).toEqual({});

    // Add another user - should trigger subscribe synchronously
    store.users.add({ id: "2", name: "Bob", profile: { age: 25 } });
    expect(collectionSnapshots).toHaveLength(3);
    expect(collectionSnapshots[2]!.documents).toHaveProperty("1");
    expect(collectionSnapshots[2]!.documents).toHaveProperty("2");

    // Update a user - should trigger subscribe synchronously
    store.users.update("1", { profile: { age: 31 } });
    expect(collectionSnapshots).toHaveLength(4);
    expect(collectionSnapshots[3]!.documents).toHaveProperty("1");
    expect(collectionSnapshots[3]!.documents).toHaveProperty("2");

    // Remove a user - should trigger subscribe synchronously
    store.users.remove("1");
    expect(collectionSnapshots).toHaveLength(5);
    expect(collectionSnapshots[4]!.documents).not.toHaveProperty("1");
    expect(collectionSnapshots[4]!.documents).toHaveProperty("2");
    // Tombstone should be set for removed document
    expect(collectionSnapshots[4]!.tombstones).toHaveProperty("1");

    unsubscribe();
  });

  test("collection $data subscribe is called when collection changes", () => {
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

    const dataSnapshots: ReadonlyMap<string, any>[] = [];
    const unsubscribe = store.users.$data.subscribe((data) => {
      dataSnapshots.push(data);
    });

    // Subscribe should be called immediately with initial data
    // Per nanostores docs: "Store#subscribe() calls callback immediately"
    expect(dataSnapshots).toHaveLength(1);
    expect(dataSnapshots[0]!.size).toBe(0);
    expect(dataSnapshots[0]!.has("1")).toBe(false);

    // Add a user - should trigger subscribe synchronously
    // Per nanostores docs: subscribe is called on store changes
    store.users.add({ id: "1", name: "Alice", profile: { age: 30 } });
    expect(dataSnapshots).toHaveLength(2);
    expect(dataSnapshots[1]!.size).toBe(1);
    expect(dataSnapshots[1]!.has("1")).toBe(true);
    expect(dataSnapshots[1]!.get("1")).toEqual({
      id: "1",
      name: "Alice",
      profile: { age: 30 },
    });

    // Add another user - should trigger subscribe synchronously
    store.users.add({ id: "2", name: "Bob", profile: { age: 25 } });
    expect(dataSnapshots).toHaveLength(3);
    expect(dataSnapshots[2]!.size).toBe(2);
    expect(dataSnapshots[2]!.has("1")).toBe(true);
    expect(dataSnapshots[2]!.has("2")).toBe(true);
    expect(dataSnapshots[2]!.get("2")).toEqual({
      id: "2",
      name: "Bob",
      profile: { age: 25 },
    });

    // Update a user - should trigger subscribe synchronously
    store.users.update("1", { profile: { age: 31 } });
    expect(dataSnapshots).toHaveLength(4);
    expect(dataSnapshots[3]!.size).toBe(2);
    expect(dataSnapshots[3]!.get("1")).toEqual({
      id: "1",
      name: "Alice",
      profile: { age: 31 },
    });

    // Remove a user - should trigger subscribe synchronously
    // Removed documents should not appear in $data (they're filtered out)
    store.users.remove("1");
    expect(dataSnapshots).toHaveLength(5);
    expect(dataSnapshots[4]!.size).toBe(1);
    expect(dataSnapshots[4]!.has("1")).toBe(false);
    expect(dataSnapshots[4]!.has("2")).toBe(true);
    expect(dataSnapshots[4]!.get("2")).toEqual({
      id: "2",
      name: "Bob",
      profile: { age: 25 },
    });

    unsubscribe();
  });

  test("throws error when schema missing id property and no getId provided", () => {
    const schemaWithoutId = z.object({
      name: z.string(),
    });

    const store = createStore({
      collections: {
        items: {
          schema: schemaWithoutId as any,
        },
      },
    });

    expect(() => {
      store.items.add({ name: "Test" } as any);
    }).toThrow("Schema must have an 'id' property when getId is not provided");
  });
});
