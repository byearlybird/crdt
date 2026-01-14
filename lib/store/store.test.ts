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
    expect(store.getAll).toBeDefined();
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

  test("works with keyPath property", () => {
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

    expect(store.get("users", "1")).toEqual({
      id: "1",
      name: "Alice",
      profile: {},
    });
  });

  test("collection methods work correctly", () => {
    const store = createStore({
      collections: {
        users: {
          schema: userSchema,
          keyPath: "id",
        },
      },
    });

    expect(store.getAll("users")).toHaveLength(0);
    expect(store.get("users", "1")).toBeUndefined();

    store.add("users", {
      id: "1",
      name: "Alice",
      profile: { age: 30 },
    });
    store.add("users", {
      id: "2",
      name: "Bob",
      profile: { age: 25 },
    });
    store.add("users", {
      id: "3",
      name: "Charlie",
      profile: { age: 35 },
    });

    const allUsers = store.getAll("users");
    expect(allUsers).toHaveLength(3);
    expect(store.get("users", "1")?.name).toBe("Alice");
    expect(store.get("users", "nonexistent")).toBeUndefined();
    expect(allUsers.some((v) => v.name === "Alice")).toBe(true);

    store.remove("users", "2");
    expect(store.getAll("users")).toHaveLength(2);
    expect(store.get("users", "2")).toBeUndefined();
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
    expect(events[0]).toEqual({
      type: "add",
      collection: "users",
      id: "1",
      data: { id: "1", name: "Alice", profile: { age: 30 } },
    });

    // Add a note - should trigger onChange
    store.add("notes", { id: "note-1", content: "First note" });
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({
      type: "add",
      collection: "notes",
      id: "note-1",
      data: { id: "note-1", content: "First note" },
    });

    // Update a user - should trigger onChange
    store.update("users", "1", { profile: { age: 31 } });
    expect(events).toHaveLength(3);
    expect(events[2]?.type).toBe("update");
    expect(events[2]?.collection).toBe("users");
    expect(events[2]?.id).toBe("1");

    // Remove a user - should trigger onChange
    store.remove("users", "1");
    expect(events).toHaveLength(4);
    expect(events[3]).toEqual({
      type: "remove",
      collection: "users",
      id: "1",
    });

    unsubscribe();
  });

  test("can filter onChange by collection", () => {
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

    const userEvents: any[] = [];
    const unsubscribe = store.onChange((event) => {
      if (event.collection === "users") {
        userEvents.push(event);
      }
    });

    // Add a user - should be captured
    store.add("users", { id: "1", name: "Alice", profile: { age: 30 } });
    expect(userEvents).toHaveLength(1);
    expect(userEvents[0]).toEqual({
      type: "add",
      collection: "users",
      id: "1",
      data: { id: "1", name: "Alice", profile: { age: 30 } },
    });

    // Add another user - should be captured
    store.add("users", { id: "2", name: "Bob", profile: { age: 25 } });
    expect(userEvents).toHaveLength(2);
    expect(userEvents[1]).toEqual({
      type: "add",
      collection: "users",
      id: "2",
      data: { id: "2", name: "Bob", profile: { age: 25 } },
    });

    // Update a user - should be captured
    store.update("users", "1", { profile: { age: 31 } });
    expect(userEvents).toHaveLength(3);
    expect(userEvents[2]?.type).toBe("update");
    expect(userEvents[2]?.collection).toBe("users");
    expect(userEvents[2]?.id).toBe("1");

    // Remove a user - should be captured
    store.remove("users", "1");
    expect(userEvents).toHaveLength(4);
    expect(userEvents[3]).toEqual({
      type: "remove",
      collection: "users",
      id: "1",
    });

    // Adding to notes should NOT be captured
    store.add("notes", { id: "note-1", content: "Note" });
    expect(userEvents).toHaveLength(4); // Still 4, no change

    unsubscribe();
  });

  test("keyPath is required in collection config", () => {
    const schemaWithId = z.object({
      id: z.string(),
      name: z.string(),
    });

    const store = createStore({
      collections: {
        items: {
          schema: schemaWithId,
          keyPath: "id",
        },
      },
    });

    store.add("items", { id: "1", name: "Test" });
    expect(store.get("items", "1")?.name).toBe("Test");
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

  test("removed documents don't appear in getAll", () => {
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

    expect(store.getAll("users")).toHaveLength(3);

    store.remove("users", "2");

    const allUsers = store.getAll("users");
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
    expect(store2.getAll("users")).toHaveLength(0);

    const snapshot2 = store2.getSnapshot();
    expect(snapshot2.tombstones).toHaveProperty("1");
  });

  test("getAll works without options (backward compatibility)", () => {
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

    const allUsers = store.getAll("users");
    expect(allUsers).toHaveLength(2);
  });

  test("getAll with where predicate filters items", () => {
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
    store.add("users", { id: "3", name: "Charlie", profile: { age: 35 } });

    const adults = store.getAll("users", {
      where: (user) => (user.profile?.age ?? 0) >= 30,
    });

    expect(adults).toHaveLength(2);
    expect(adults.find((u) => u.name === "Alice")).toBeDefined();
    expect(adults.find((u) => u.name === "Charlie")).toBeDefined();
    expect(adults.find((u) => u.name === "Bob")).toBeUndefined();
  });

  test("getAll with where predicate works with different conditions", () => {
    const store = createStore({
      collections: {
        notes: {
          schema: noteSchema,
          keyPath: "id",
        },
      },
    });

    store.add("notes", { id: "1", content: "First note" });
    store.add("notes", { id: "2", content: "Second note" });
    store.add("notes", { id: "3", content: "Third note" });

    const filtered = store.getAll("notes", {
      where: (note) => note.content.includes("Second"),
    });

    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe("2");
    expect(filtered[0]?.content).toBe("Second note");
  });

  test("getAll with where predicate returns empty array when no matches", () => {
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

    const filtered = store.getAll("users", {
      where: (user) => user.name === "Charlie",
    });

    expect(filtered).toHaveLength(0);
  });

  test("getAll with where predicate is applied after tombstone filtering", () => {
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
    store.add("users", { id: "3", name: "Charlie", profile: { age: 35 } });

    // Remove one user
    store.remove("users", "2");

    // Filter for adults - should not include removed user
    const adults = store.getAll("users", {
      where: (user) => (user.profile?.age ?? 0) >= 30,
    });

    expect(adults).toHaveLength(2);
    expect(adults.find((u) => u.id === "1")).toBeDefined();
    expect(adults.find((u) => u.id === "3")).toBeDefined();
    expect(adults.find((u) => u.id === "2")).toBeUndefined();
  });
});
