import { describe, expect, test, mock } from "bun:test";
import { createMultiCollectionStore, createProfileStore } from "./test-utils";
import { createStore } from "./store";
import { define } from "./schema";
import z from "zod";

describe("createStore", () => {
  test("can put documents to collections", () => {
    const store = createProfileStore();

    store.put("users", {
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
    const store = createProfileStore();

    store.put("users", {
      id: "1",
      name: "Alice",
      profile: {},
    });

    store.put("users", {
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

  test("can patch documents in collections", () => {
    const store = createProfileStore();

    store.put("users", {
      id: "1",
      name: "Alice",
      profile: {},
    });

    store.patch("users", "1", {
      profile: { age: 30 },
    });

    const result = store.get("users", "1");
    expect(result).toEqual({
      id: "1",
      name: "Alice",
      profile: { age: 30 },
    });
  });

  test("tombstones are collection-scoped", () => {
    const store = createMultiCollectionStore();

    store.put("users", { id: "123", name: "Alice", profile: {} });
    store.remove("users", "123");

    // Should be undefined (tombstoned in users collection)
    expect(store.get("users", "123")).toBeUndefined();

    // Same ID in different collection should work
    store.put("settings", { id: "123", key: "theme", value: "dark" });
    expect(store.get("settings", "123")).toEqual({ id: "123", key: "theme", value: "dark" });
  });

  test("put revives tombstoned id", () => {
    const store = createProfileStore();

    store.put("users", { id: "1", name: "Alice", profile: {} });
    store.remove("users", "1");
    expect(store.get("users", "1")).toBeUndefined();

    // Put should revive the tombstoned ID
    store.put("users", { id: "1", name: "Bob", profile: {} });
    expect(store.get("users", "1")).toEqual({ id: "1", name: "Bob", profile: {} });
  });

  test("removed documents don't appear in list", () => {
    const store = createProfileStore();

    store.put("users", { id: "1", name: "Alice", profile: {} });
    store.put("users", { id: "2", name: "Bob", profile: {} });
    store.put("users", { id: "3", name: "Charlie", profile: {} });

    expect(store.list("users")).toHaveLength(3);

    store.remove("users", "2");

    const allUsers = store.list("users");
    expect(allUsers).toHaveLength(2);
    expect(allUsers.find((u) => u.id === "2")).toBeUndefined();
    expect(allUsers.find((u) => u.id === "1")).toBeDefined();
    expect(allUsers.find((u) => u.id === "3")).toBeDefined();
  });

  test("direct handle access returns current results", () => {
    const store = createProfileStore();

    store.put("users", { id: "1", name: "Alice", profile: {} });

    expect(store.get("users", "1")).toEqual({
      id: "1",
      name: "Alice",
      profile: {},
    });

    store.patch("users", "1", { name: "Alice Updated" });

    expect(store.get("users", "1")).toEqual({
      id: "1",
      name: "Alice Updated",
      profile: {},
    });
  });

  test("writes notify listeners", () => {
    const store = createProfileStore();

    const changes: string[] = [];
    store.subscribe((event) => {
      changes.push(...Object.keys(event));
    });

    store.put("users", { id: "1", name: "Alice", profile: {} });

    expect(changes).toContain("users");
  });
});

test("getState returns current state", () => {
  const store = createProfileStore();

  const state = store.getState();
  expect(state).toHaveProperty("clock");
  expect(state).toHaveProperty("collections");
  expect(state.collections).toBeDefined();
  if (Object.keys(state.collections).length > 0) {
    const firstCollection = Object.values(state.collections)[0];
    expect(firstCollection).toHaveProperty("documents");
    expect(firstCollection).toHaveProperty("tombstones");
  }
});

describe("subscribe", () => {
  test("returns unsubscribe function", () => {
    const store = createProfileStore();

    const callback = mock(() => {});
    const unsubscribe = store.subscribe(callback);

    expect(typeof unsubscribe).toBe("function");
  });

  test("callback fires when subscribed collection changes", () => {
    const store = createProfileStore();

    const callback = mock(() => {});
    store.subscribe(callback);

    // Trigger a change
    store.put("users", { id: "1", name: "Alice", profile: {} });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({ users: true });
  });

  test("callback fires on patch", () => {
    const store = createProfileStore();
    store.put("users", { id: "1", name: "Alice", profile: {} });

    const callback = mock(() => {});
    store.subscribe(callback);

    callback.mockClear();

    store.patch("users", "1", { name: "Alice Updated" });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({ users: true });
  });

  test("callback fires on remove", () => {
    const store = createProfileStore();
    store.put("users", { id: "1", name: "Alice", profile: {} });

    const callback = mock(() => {});
    store.subscribe(callback);

    callback.mockClear();

    store.remove("users", "1");

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({ users: true });
  });

  test("unsubscribe stops callback execution", () => {
    const store = createProfileStore();

    const callback = mock(() => {});
    const unsubscribe = store.subscribe(callback);

    callback.mockClear();
    unsubscribe();

    // This should NOT trigger the callback
    store.put("users", { id: "1", name: "Alice", profile: {} });

    expect(callback).not.toHaveBeenCalled();
  });

  test("callback does NOT fire for unsubscribed collections", () => {
    const store = createMultiCollectionStore();

    const callback = mock((_e: unknown) => {});
    // Only subscribe to users, not notes - filter in callback
    store.subscribe((event) => {
      if ("users" in event) {
        callback(event);
      }
    });

    callback.mockClear();

    // Change notes - should NOT trigger callback
    store.put("notes", { id: "1", content: "Hello" });

    expect(callback).not.toHaveBeenCalled();

    // Change users - should trigger callback
    store.put("users", { id: "1", name: "Alice", profile: {} });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({ users: true });
  });

  test("multi-collection subscriptions track all subscribed collections", () => {
    const store = createMultiCollectionStore();

    const callback = mock((_e: unknown) => {});
    store.subscribe((event) => {
      if ("users" in event || "notes" in event) {
        callback(event);
      }
    });

    callback.mockClear();

    // Change users - should trigger
    store.put("users", { id: "1", name: "Alice", profile: {} });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({ users: true });

    callback.mockClear();

    // Change notes - should also trigger
    store.put("notes", { id: "1", content: "Hello" });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({ notes: true });
  });

  test("multiple subscriptions can coexist", () => {
    const store = createProfileStore();

    const callback1 = mock(() => {});
    const callback2 = mock(() => {});

    store.subscribe(callback1);
    store.subscribe(callback2);

    callback1.mockClear();
    callback2.mockClear();

    store.put("users", { id: "1", name: "Alice", profile: {} });

    expect(callback1).toHaveBeenCalledTimes(1);
    expect(callback1).toHaveBeenCalledWith({ users: true });
    expect(callback2).toHaveBeenCalledTimes(1);
    expect(callback2).toHaveBeenCalledWith({ users: true });
  });

  test("unsubscribing one subscription does not affect others", () => {
    const store = createProfileStore();

    const callback1 = mock(() => {});
    const callback2 = mock(() => {});

    const unsub1 = store.subscribe(callback1);
    store.subscribe(callback2);

    callback1.mockClear();
    callback2.mockClear();

    unsub1();

    store.put("users", { id: "1", name: "Alice", profile: {} });

    expect(callback1).not.toHaveBeenCalled();
    expect(callback2).toHaveBeenCalledTimes(1);
    expect(callback2).toHaveBeenCalledWith({ users: true });
  });

  test("subscribe accepts callback function", () => {
    const store = createProfileStore();

    const callback = mock(() => {});
    expect(() => {
      store.subscribe(callback);
    }).not.toThrow();
  });

  test("event only includes changed collections", () => {
    const store = createMultiCollectionStore();

    const callback = mock((_e: unknown) => {});
    store.subscribe((event) => {
      if ("users" in event || "notes" in event) {
        callback(event);
      }
    });

    callback.mockClear();

    // Only change users
    store.put("users", { id: "1", name: "Alice", profile: {} });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({ users: true });
    expect(callback).not.toHaveBeenCalledWith(expect.objectContaining({ notes: true }));
  });

  test("subscription receives all relevant changes", () => {
    const store = createProfileStore();

    const events: Array<{ users?: true }> = [];
    store.subscribe((event) => {
      if ("users" in event) {
        events.push(event);
      }
    });

    store.put("users", { id: "1", name: "Alice", profile: {} });
    store.put("users", { id: "2", name: "Bob", profile: {} });
    store.remove("users", "1");

    expect(events).toEqual([{ users: true }, { users: true }, { users: true }]);
  });

  test("global subscribe receives all collection events", () => {
    const store = createMultiCollectionStore();

    const events: any[] = [];
    store.subscribe((event) => events.push(event));

    store.put("users", { id: "1", name: "Alice", profile: {} });
    store.put("notes", { id: "1", content: "Hello" });

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ users: true });
    expect(events[1]).toEqual({ notes: true });
  });

  test("global subscribe returns unsubscribe function", () => {
    const store = createProfileStore();

    const callback = mock(() => {});
    const unsubscribe = store.subscribe(callback);

    store.put("users", { id: "1", name: "Alice", profile: {} });
    expect(callback).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.put("users", { id: "2", name: "Bob", profile: {} });
    expect(callback).toHaveBeenCalledTimes(1);
  });
});

describe("transact", () => {
  test("transaction throws error for non-existent collection on access", () => {
    const store = createMultiCollectionStore();

    expect(() => {
      store.transact((tx) => {
        // Error thrown when accessing non-existent collection
        tx.get("orders" as any, "1");
      });
    }).toThrow('Collection "orders" not found');
  });

  test("transaction with multiple collections commits atomically", () => {
    const store = createMultiCollectionStore();

    store.transact((tx) => {
      const user = tx.put("users", { id: "u1", name: "Alice", profile: {} });
      tx.put("notes", { id: "n1", content: `Note for ${user.name}` });
    });

    expect(store.get("users", "u1")).toEqual({ id: "u1", name: "Alice", profile: {} });
    expect(store.get("notes", "n1")).toEqual({ id: "n1", content: "Note for Alice" });
  });

  test("transaction rollback on error", () => {
    const store = createMultiCollectionStore();

    store.put("users", { id: "u1", name: "Alice", profile: {} });

    expect(() => {
      store.transact((tx) => {
        tx.put("users", { id: "u2", name: "Bob", profile: {} });
        tx.put("notes", { id: "n1", content: "Hello" });
        throw new Error("Transaction failed");
      });
    }).toThrow("Transaction failed");

    // Original state should be preserved
    expect(store.get("users", "u1")).toEqual({ id: "u1", name: "Alice", profile: {} });
    expect(store.get("users", "u2")).toBeUndefined();
    expect(store.get("notes", "n1")).toBeUndefined();
  });

  test("transaction emits single event on commit", () => {
    const store = createMultiCollectionStore();

    const events: any[] = [];
    store.subscribe((event) => {
      events.push(event);
    });

    store.transact((tx) => {
      tx.put("users", { id: "u1", name: "Alice", profile: {} });
      tx.put("notes", { id: "n1", content: "Hello" });
    });

    // Should emit only one event with both collections
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ users: true, notes: true });
  });

  test("transaction return value is passed through", () => {
    const store = createMultiCollectionStore();

    const result = store.transact((tx) => {
      const user = tx.put("users", { id: "u1", name: "Alice", profile: {} });
      return user;
    });

    expect(result).toEqual({ id: "u1", name: "Alice", profile: {} });
  });

  test("transaction with cross-collection references", () => {
    const store = createMultiCollectionStore();

    store.transact((tx) => {
      const user = tx.put("users", { id: "u1", name: "Alice", profile: {} });
      tx.put("notes", { id: "n1", content: `Note for user ${user.id}` });
    });

    const note = store.get("notes", "n1");
    expect(note).toEqual({ id: "n1", content: "Note for user u1" });
  });

  test("transaction only emits event for mutated collections", () => {
    const store = createMultiCollectionStore();

    const events: any[] = [];
    store.subscribe((event) => {
      events.push(event);
    });

    store.transact((tx) => {
      // Only mutate users, not notes
      tx.put("users", { id: "u1", name: "Alice", profile: {} });
    });

    // Should only include users in the event
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ users: true });
    expect(events[0]).not.toHaveProperty("notes");
  });

  test("transaction with no mutations emits no event", () => {
    const store = createMultiCollectionStore();

    store.put("users", { id: "u1", name: "Alice", profile: {} });

    const events: any[] = [];
    store.subscribe((event) => {
      events.push(event);
    });

    store.transact((tx) => {
      // Just read, don't mutate
      const user = tx.get("users", "u1");
      expect(user).toEqual({ id: "u1", name: "Alice", profile: {} });
    });

    // Should not emit any event
    expect(events).toHaveLength(0);
  });

  test("transaction can use returned documents from put", () => {
    const store = createMultiCollectionStore();

    store.transact((tx) => {
      const user = tx.put("users", { id: "u1", name: "Alice", profile: {} });
      expect(user.id).toBe("u1");
      expect(user.name).toBe("Alice");
      tx.put("notes", { id: "n1", content: `Created by ${user.name}` });
    });

    expect(store.get("notes", "n1")).toEqual({ id: "n1", content: "Created by Alice" });
  });

  test("transaction can use returned documents from patch", () => {
    const store = createMultiCollectionStore();

    store.put("users", { id: "u1", name: "Alice", profile: {} });

    store.transact((tx) => {
      const updated = tx.patch("users", "u1", { name: "Alice Updated" });
      expect(updated.name).toBe("Alice Updated");
      tx.put("notes", { id: "n1", content: `Updated by ${updated.name}` });
    });

    expect(store.get("users", "u1")).toEqual({ id: "u1", name: "Alice Updated", profile: {} });
    expect(store.get("notes", "n1")).toEqual({ id: "n1", content: "Updated by Alice Updated" });
  });

  test("transaction throws error for non-existent collection on access", () => {
    const store = createProfileStore();

    expect(() => {
      store.transact((tx) => {
        // Error thrown when accessing non-existent collection
        tx.get("nonexistent" as any, "1");
      });
    }).toThrow('Collection "nonexistent" not found');
  });

  test("transaction only clones collections that are accessed", () => {
    const store = createMultiCollectionStore();

    store.put("users", { id: "u1", name: "Alice", profile: {} });
    store.put("notes", { id: "n1", content: "Hello" });
    store.put("settings", { id: "s1", key: "theme", value: "dark" });

    store.transact((tx) => {
      // Only access users and notes, not settings
      const user = tx.get("users", "u1");
      expect(user).toBeDefined();
      tx.put("notes", { id: "n2", content: "World" });
      // Settings should not be cloned since we never accessed it
    });

    // All collections should still be accessible
    expect(store.get("users", "u1")).toBeDefined();
    expect(store.get("notes", "n2")).toBeDefined();
    expect(store.get("settings", "s1")).toBeDefined();
  });
});

describe("input type inference with defaults", () => {
  test("put accepts input type when schema has defaults", () => {
    const schemaWithDefault = z.object({
      id: z.string().default(() => "auto-generated"),
      name: z.string(),
      age: z.number().optional(),
    });

    const store = createStore({
      users: define(schemaWithDefault, (data) => data.id),
    });

    // Should accept input without id (has default)
    const result = store.put("users", {
      name: "Alice",
      age: 30,
    });

    // Result should have id filled in by default
    expect(result.id).toBe("auto-generated");
    expect(result.name).toBe("Alice");
    expect(result.age).toBe(30);

    // Should also accept id explicitly
    const result2 = store.put("users", {
      id: "custom-id",
      name: "Bob",
    });

    expect(result2.id).toBe("custom-id");
    expect(result2.name).toBe("Bob");
  });

  test("put accepts input type in transactions", () => {
    const schemaWithDefault = z.object({
      id: z.string().default(() => "auto-generated"),
      name: z.string(),
    });

    const store = createStore({
      users: define(schemaWithDefault, (data) => data.id),
    });

    store.transact((tx) => {
      // Should accept input without id
      const user = tx.put("users", {
        name: "Alice",
      });

      expect(user.id).toBe("auto-generated");
      expect(user.name).toBe("Alice");
    });
  });
});
