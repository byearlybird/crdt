import { describe, test, expect } from "bun:test";
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
        },
        notes: {
          schema: noteSchema,
        },
      },
    });

    expect(store.users).toBeDefined();
    expect(store.notes).toBeDefined();
    expect(store.users.get).toBeDefined();
    expect(store.users.getSnapshot).toBeDefined();
    expect(store.notes.get).toBeDefined();
    expect(store.notes.getSnapshot).toBeDefined();
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

    const result = store.users.get("1");
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

    expect(store.users.get("1")).toBeUndefined();
    expect(store.users.get("2")).toEqual({
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

    const result = store.users.get("1");
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

    expect(store.users.get("user-1")).toEqual({
      id: "1",
      name: "Alice",
      profile: {},
    });
    expect(store.users.get("1")).toBeUndefined();
  });

  test("collection methods work correctly", () => {
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

    const keys = store.users.keys();
    expect(keys).toHaveLength(3);
    expect(keys).toContain("1");

    const values = store.users.values();
    expect(values).toHaveLength(3);
    expect(values.some((v) => v.name === "Alice")).toBe(true);

    const entries = store.users.entries();
    expect(entries).toHaveLength(3);
    expect(new Map(entries).get("1")?.name).toBe("Alice");

    store.users.remove("2");
    expect(store.users.size).toBe(2);
    expect(store.users.has("2")).toBe(false);
  });

  test("getSnapshot returns store snapshot with clock and collections", () => {
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

    const initialSnapshot = store.getSnapshot();
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

    const updatedSnapshot = store.getSnapshot();
    expect(updatedSnapshot.collections["users"]?.documents).toHaveProperty("1");
    expect(updatedSnapshot.collections["notes"]?.documents).toHaveProperty("note-1");
    expect(updatedSnapshot.collections["users"]?.tombstones).toEqual({});
    expect(updatedSnapshot.collections["notes"]?.tombstones).toEqual({});
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
        },
        notes: {
          schema: noteSchema,
        },
      },
    });

    const initialSnapshot = store.getSnapshot();
    expect(initialSnapshot.collections["users"]?.documents).toEqual({});
    expect(initialSnapshot.collections["notes"]?.documents).toEqual({});

    store.users.add({ id: "1", name: "Alice", profile: {} });
    const snapshotAfterUsers = store.getSnapshot();
    expect(snapshotAfterUsers.collections["users"]?.documents).toHaveProperty("1");
    expect(snapshotAfterUsers.collections["notes"]?.documents).toEqual({});

    store.notes.add({ id: "1", content: "Note" });
    const snapshotAfterNotes = store.getSnapshot();
    expect(snapshotAfterNotes.collections["users"]?.documents).toHaveProperty("1");
    expect(snapshotAfterNotes.collections["notes"]?.documents).toHaveProperty("1");
  });

  test("merge updates clock and collections", () => {
    const store = createStore({
      collections: {
        users: {
          schema: userSchema,
        },
      },
    });

    const snapshot = store.getSnapshot();
    const futureSnapshot = {
      clock: { ms: snapshot.clock.ms + 1000, seq: 5 },
      collections: snapshot.collections,
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
        },
        notes: {
          schema: noteSchema,
        },
      },
    });

    const events: any[] = [];
    const unsubscribe = store.onChange((event) => {
      events.push(event);
    });

    // Add a user - should trigger onChange
    store.users.add({ id: "1", name: "Alice", profile: { age: 30 } });
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      collection: "users",
      event: {
        type: "add",
        id: "1",
        data: { id: "1", name: "Alice", profile: { age: 30 } },
      },
    });

    // Add a note - should trigger onChange
    store.notes.add({ id: "note-1", content: "First note" });
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({
      collection: "notes",
      event: {
        type: "add",
        id: "note-1",
        data: { id: "note-1", content: "First note" },
      },
    });

    // Update a user - should trigger onChange
    store.users.update("1", { profile: { age: 31 } });
    expect(events).toHaveLength(3);
    expect(events[2]?.collection).toBe("users");
    expect(events[2]?.event.type).toBe("update");
    expect(events[2]?.event.id).toBe("1");

    // Remove a user - should trigger onChange
    store.users.remove("1");
    expect(events).toHaveLength(4);
    expect(events[3]).toEqual({
      collection: "users",
      event: { type: "remove", id: "1" },
    });

    unsubscribe();
  });

  test("collection onChange is called when collection changes", () => {
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

    const userEvents: any[] = [];
    const unsubscribe = store.users.onChange((event) => {
      userEvents.push(event);
    });

    // Add a user - should trigger onChange
    store.users.add({ id: "1", name: "Alice", profile: { age: 30 } });
    expect(userEvents).toHaveLength(1);
    expect(userEvents[0]).toEqual({
      type: "add",
      id: "1",
      data: { id: "1", name: "Alice", profile: { age: 30 } },
    });

    // Add another user - should trigger onChange
    store.users.add({ id: "2", name: "Bob", profile: { age: 25 } });
    expect(userEvents).toHaveLength(2);
    expect(userEvents[1]).toEqual({
      type: "add",
      id: "2",
      data: { id: "2", name: "Bob", profile: { age: 25 } },
    });

    // Update a user - should trigger onChange
    store.users.update("1", { profile: { age: 31 } });
    expect(userEvents).toHaveLength(3);
    expect(userEvents[2]?.type).toBe("update");
    expect(userEvents[2]?.id).toBe("1");

    // Remove a user - should trigger onChange
    store.users.remove("1");
    expect(userEvents).toHaveLength(4);
    expect(userEvents[3]).toEqual({
      type: "remove",
      id: "1",
    });

    // Adding to notes should NOT trigger users onChange
    store.notes.add({ id: "note-1", content: "Note" });
    expect(userEvents).toHaveLength(4); // Still 4, no change

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
