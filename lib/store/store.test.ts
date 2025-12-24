import { describe, test, expect } from "bun:test";
import { z } from "zod";
import { createStore } from "./store";
import { makeDocument } from "../core/document";
import { makeStamp, advanceClock } from "../core/clock";

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

  test("collections share the same clock", () => {
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

    // Add to both collections
    store.users.add({
      id: "1",
      name: "Alice",
      profile: {},
    });
    store.notes.add({
      id: "1",
      content: "Hello",
    });

    const userSnapshot = store.users.$snapshot.get();
    const noteSnapshot = store.notes.$snapshot.get();

    // Clocks should be equal (same ms and seq)
    expect(userSnapshot.clock.ms).toBe(noteSnapshot.clock.ms);
    expect(userSnapshot.clock.seq).toBe(noteSnapshot.clock.seq);
  });

  test("merge updates store clock", () => {
    const store = createStore({
      collections: {
        users: {
          schema: userSchema,
        },
      },
    });

    // Get initial clock
    const initialSnapshot = store.users.$snapshot.get();
    const initialClock = initialSnapshot.clock;

    // Add something to advance clock
    store.users.add({
      id: "1",
      name: "Alice",
      profile: {},
    });

    const afterAddSnapshot = store.users.$snapshot.get();
    expect(afterAddSnapshot.clock.ms).toBeGreaterThanOrEqual(initialClock.ms);
    expect(afterAddSnapshot.clock.seq).toBeGreaterThan(initialClock.seq);

    // Merge a snapshot from the future
    const futureClock = {
      ms: Date.now() + 1000,
      seq: 10,
    };

    store.users.merge({
      clock: futureClock,
      documents: {},
      tombstones: {},
    });

    const afterMergeSnapshot = store.users.$snapshot.get();
    // Clock should be advanced
    expect(afterMergeSnapshot.clock.ms).toBe(futureClock.ms);
    expect(afterMergeSnapshot.clock.seq).toBe(futureClock.seq);
  });

  test("merge merges documents correctly", () => {
    const store = createStore({
      collections: {
        users: {
          schema: userSchema,
        },
      },
    });

    // Add initial document
    store.users.add({
      id: "1",
      name: "Alice",
      profile: { age: 30 },
    });

    // Merge a snapshot with updated data (simulating sync from remote)
    const currentClock = store.users.$snapshot.get().clock;
    const newClock = advanceClock(currentClock, {
      ms: Date.now() + 100,
      seq: 1,
    });
    const newStamp = makeStamp(newClock.ms, newClock.seq);

    const updatedDoc = makeDocument(
      {
        id: "1",
        name: "Alice Updated",
        profile: { age: 31 },
      },
      newStamp,
    );

    store.users.merge({
      clock: newClock,
      documents: {
        "1": updatedDoc,
      },
      tombstones: {},
    });

    const result = store.users.$data.get().get("1");
    expect(result).toBeDefined();
    expect(result!.name).toBe("Alice Updated");
    expect(result!.profile.age).toBe(31);
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

    // Initially empty
    expect(store.users.size).toBe(0);
    expect(store.users.has("1")).toBe(false);
    expect(store.users.get("1")).toBeUndefined();

    // Add documents
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

    // Test size
    expect(store.users.size).toBe(3);

    // Test get
    expect(store.users.get("1")).toEqual({
      id: "1",
      name: "Alice",
      profile: { age: 30 },
    });
    expect(store.users.get("2")).toEqual({
      id: "2",
      name: "Bob",
      profile: { age: 25 },
    });
    expect(store.users.get("nonexistent")).toBeUndefined();

    // Test has
    expect(store.users.has("1")).toBe(true);
    expect(store.users.has("2")).toBe(true);
    expect(store.users.has("3")).toBe(true);
    expect(store.users.has("nonexistent")).toBe(false);

    // Test keys
    const keys = Array.from(store.users.keys());
    expect(keys.length).toBe(3);
    expect(keys).toContain("1");
    expect(keys).toContain("2");
    expect(keys).toContain("3");

    // Test values
    const values = Array.from(store.users.values());
    expect(values.length).toBe(3);
    expect(values).toContainEqual({
      id: "1",
      name: "Alice",
      profile: { age: 30 },
    });
    expect(values).toContainEqual({
      id: "2",
      name: "Bob",
      profile: { age: 25 },
    });
    expect(values).toContainEqual({
      id: "3",
      name: "Charlie",
      profile: { age: 35 },
    });

    // Test entries
    const entries = Array.from(store.users.entries());
    expect(entries.length).toBe(3);
    const entryMap = new Map(entries);
    expect(entryMap.get("1")).toEqual({
      id: "1",
      name: "Alice",
      profile: { age: 30 },
    });
    expect(entryMap.get("2")).toEqual({
      id: "2",
      name: "Bob",
      profile: { age: 25 },
    });
    expect(entryMap.get("3")).toEqual({
      id: "3",
      name: "Charlie",
      profile: { age: 35 },
    });

    // Remove a document and verify size updates
    store.users.remove("2");
    expect(store.users.size).toBe(2);
    expect(store.users.has("2")).toBe(false);
    expect(store.users.get("2")).toBeUndefined();
  });
});
