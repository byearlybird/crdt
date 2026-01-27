import { describe, expect, test, vi } from "vitest";
import { createMultiCollectionStore, createProfileStore } from "./test-utils";

describe("createStore", () => {
  test("can put documents to collections", () => {
    const store = createProfileStore();

    store.users.put({
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
    const store = createProfileStore();

    store.users.put({
      id: "1",
      name: "Alice",
      profile: {},
    });

    store.users.put({
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

  test("can patch documents in collections", () => {
    const store = createProfileStore();

    store.users.put({
      id: "1",
      name: "Alice",
      profile: {},
    });

    store.users.patch("1", {
      profile: { age: 30 },
    });

    const result = store.users.get("1");
    expect(result).toEqual({
      id: "1",
      name: "Alice",
      profile: { age: 30 },
    });
  });

  test("tombstones are collection-scoped", () => {
    const store = createMultiCollectionStore();

    store.users.put({ id: "123", name: "Alice", profile: {} });
    store.users.remove("123");

    // Should be undefined (tombstoned in users collection)
    expect(store.users.get("123")).toBeUndefined();

    // Same ID in different collection should work
    store.settings.put({ id: "123", key: "theme", value: "dark" });
    expect(store.settings.get("123")).toEqual({ id: "123", key: "theme", value: "dark" });
  });

  test("put revives tombstoned id", () => {
    const store = createProfileStore();

    store.users.put({ id: "1", name: "Alice", profile: {} });
    store.users.remove("1");
    expect(store.users.get("1")).toBeUndefined();

    // Put should revive the tombstoned ID
    store.users.put({ id: "1", name: "Bob", profile: {} });
    expect(store.users.get("1")).toEqual({ id: "1", name: "Bob", profile: {} });
  });

  test("removed documents don't appear in list", () => {
    const store = createProfileStore();

    store.users.put({ id: "1", name: "Alice", profile: {} });
    store.users.put({ id: "2", name: "Bob", profile: {} });
    store.users.put({ id: "3", name: "Charlie", profile: {} });

    expect(store.users.list()).toHaveLength(3);

    store.users.remove("2");

    const allUsers = store.users.list();
    expect(allUsers).toHaveLength(2);
    expect(allUsers.find((u) => u.id === "2")).toBeUndefined();
    expect(allUsers.find((u) => u.id === "1")).toBeDefined();
    expect(allUsers.find((u) => u.id === "3")).toBeDefined();
  });

  test("direct handle access returns current results", () => {
    const store = createProfileStore();

    store.users.put({ id: "1", name: "Alice", profile: {} });

    expect(store.users.get("1")).toEqual({
      id: "1",
      name: "Alice",
      profile: {},
    });

    store.users.patch("1", { name: "Alice Updated" });

    expect(store.users.get("1")).toEqual({
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

    store.users.put({ id: "1", name: "Alice", profile: {} });

    expect(changes).toContain("users");
  });
});

describe("getState and setState", () => {
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

  test("setState applies state via applyState", () => {
    const store = createProfileStore();

    store.users.put({ id: "1", name: "Alice", profile: {} });

    const newSnapshot = {
      clock: { ms: 2000, seq: 0 },
      collections: {
        users: {
          documents: {
            "2": {
              id: { "~val": "2", "~ts": "2000:0" },
              name: { "~val": "Bob", "~ts": "2000:0" },
              profile: { "~val": {}, "~ts": "2000:0" },
            },
          },
          tombstones: {},
        },
      },
    };

    store.setState(({ applyState }) => {
      applyState(newSnapshot);
    });

    expect(store.users.get("1")).toBeUndefined();
    expect(store.users.get("2")).toEqual({
      id: "2",
      name: "Bob",
      profile: {},
    });
  });

  test("setState advances clock", () => {
    const store = createProfileStore();

    const initial = store.getState();
    const initialMs = initial.clock.ms;

    const newSnapshot = {
      clock: { ms: initialMs + 1000, seq: 5 },
      collections: {
        users: {
          documents: {},
          tombstones: {},
        },
      },
    };

    store.setState(({ applyState }) => {
      applyState(newSnapshot);
    });

    const after = store.getState();
    expect(after.clock.ms).toBe(initialMs + 1000);
    expect(after.clock.seq).toBeGreaterThanOrEqual(5);
  });

  test("applyState without notify is silent", () => {
    const store = createProfileStore();

    let notified = false;
    store.subscribe(() => {
      notified = true;
    });

    const snapshot = {
      clock: { ms: 1000, seq: 0 },
      collections: {
        users: {
          "1": {
            id: { "~val": "1", "~ts": "1000:0" },
            name: { "~val": "Alice", "~ts": "1000:0" },
            profile: { "~val": {}, "~ts": "1000:0" },
          },
        },
      },
      tombstones: {},
    };

    store.setState(({ applyState }) => {
      applyState(snapshot);
    });

    expect(notified).toBe(false);
  });

  test("notify triggers subscribers", () => {
    const store = createProfileStore();

    let notified = false;
    store.subscribe(() => {
      notified = true;
    });

    store.setState(({ notify }) => {
      notify({ users: true });
    });

    expect(notified).toBe(true);
  });

  test("applyState and notify together", () => {
    const store = createProfileStore();

    const events: any[] = [];
    store.subscribe((event) => {
      events.push(event);
    });

    const snapshot = {
      clock: { ms: 1000, seq: 0 },
      collections: {
        users: {
          documents: {
            "1": {
              id: { "~val": "1", "~ts": "1000:0" },
              name: { "~val": "Alice", "~ts": "1000:0" },
              profile: { "~val": {}, "~ts": "1000:0" },
            },
          },
          tombstones: {},
        },
      },
    };

    store.setState(({ applyState, notify }) => {
      applyState(snapshot);
      notify({ users: true });
    });

    expect(store.users.get("1")).toEqual({
      id: "1",
      name: "Alice",
      profile: {},
    });
    expect(events).toEqual([{ users: true }]);
  });
});

describe("subscribe", () => {
  test("returns unsubscribe function", () => {
    const store = createProfileStore();

    const callback = vi.fn();
    const unsubscribe = store.subscribe(["users"], callback);

    expect(typeof unsubscribe).toBe("function");
  });

  test("callback fires when subscribed collection changes", () => {
    const store = createProfileStore();

    const callback = vi.fn();
    store.subscribe(["users"], callback);

    // Trigger a change
    store.users.put({ id: "1", name: "Alice", profile: {} });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({ users: true });
  });

  test("callback fires on patch", () => {
    const store = createProfileStore();
    store.users.put({ id: "1", name: "Alice", profile: {} });

    const callback = vi.fn();
    store.subscribe(["users"], callback);

    callback.mockClear();

    store.users.patch("1", { name: "Alice Updated" });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({ users: true });
  });

  test("callback fires on remove", () => {
    const store = createProfileStore();
    store.users.put({ id: "1", name: "Alice", profile: {} });

    const callback = vi.fn();
    store.subscribe(["users"], callback);

    callback.mockClear();

    store.users.remove("1");

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({ users: true });
  });

  test("unsubscribe stops callback execution", () => {
    const store = createProfileStore();

    const callback = vi.fn();
    const unsubscribe = store.subscribe(["users"], callback);

    callback.mockClear();
    unsubscribe();

    // This should NOT trigger the callback
    store.users.put({ id: "1", name: "Alice", profile: {} });

    expect(callback).not.toHaveBeenCalled();
  });

  test("callback does NOT fire for unsubscribed collections", () => {
    const store = createMultiCollectionStore();

    const callback = vi.fn();
    // Only subscribe to users, not notes
    store.subscribe(["users"], callback);

    callback.mockClear();

    // Change notes - should NOT trigger callback
    store.notes.put({ id: "1", content: "Hello" });

    expect(callback).not.toHaveBeenCalled();

    // Change users - should trigger callback
    store.users.put({ id: "1", name: "Alice", profile: {} });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({ users: true });
  });

  test("multi-collection subscriptions track all subscribed collections", () => {
    const store = createMultiCollectionStore();

    const callback = vi.fn();
    store.subscribe(["users", "notes"], callback);

    callback.mockClear();

    // Change users - should trigger
    store.users.put({ id: "1", name: "Alice", profile: {} });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({ users: true });

    callback.mockClear();

    // Change notes - should also trigger
    store.notes.put({ id: "1", content: "Hello" });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({ notes: true });
  });

  test("multiple subscriptions can coexist", () => {
    const store = createProfileStore();

    const callback1 = vi.fn();
    const callback2 = vi.fn();

    store.subscribe(["users"], callback1);
    store.subscribe(["users"], callback2);

    callback1.mockClear();
    callback2.mockClear();

    store.users.put({ id: "1", name: "Alice", profile: {} });

    expect(callback1).toHaveBeenCalledTimes(1);
    expect(callback1).toHaveBeenCalledWith({ users: true });
    expect(callback2).toHaveBeenCalledTimes(1);
    expect(callback2).toHaveBeenCalledWith({ users: true });
  });

  test("unsubscribing one subscription does not affect others", () => {
    const store = createProfileStore();

    const callback1 = vi.fn();
    const callback2 = vi.fn();

    const unsub1 = store.subscribe(["users"], callback1);
    store.subscribe(["users"], callback2);

    callback1.mockClear();
    callback2.mockClear();

    unsub1();

    store.users.put({ id: "1", name: "Alice", profile: {} });

    expect(callback1).not.toHaveBeenCalled();
    expect(callback2).toHaveBeenCalledTimes(1);
    expect(callback2).toHaveBeenCalledWith({ users: true });
  });

  test("throws error for non-existent collection", () => {
    const store = createProfileStore();

    expect(() => {
      store.subscribe(["nonexistent" as any], vi.fn());
    }).toThrow('Collection "nonexistent" not found');
  });

  test("event only includes changed collections", () => {
    const store = createMultiCollectionStore();

    const callback = vi.fn();
    store.subscribe(["users", "notes"], callback);

    callback.mockClear();

    // Only change users
    store.users.put({ id: "1", name: "Alice", profile: {} });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({ users: true });
    expect(callback).not.toHaveBeenCalledWith(expect.objectContaining({ notes: true }));
  });

  test("subscription receives all relevant changes", () => {
    const store = createProfileStore();

    const events: Array<{ users?: true }> = [];
    store.subscribe(["users"], (event) => {
      events.push(event);
    });

    store.users.put({ id: "1", name: "Alice", profile: {} });
    store.users.put({ id: "2", name: "Bob", profile: {} });
    store.users.remove("1");

    expect(events).toEqual([{ users: true }, { users: true }, { users: true }]);
  });

  test("global subscribe receives all collection events", () => {
    const store = createMultiCollectionStore();

    const events: any[] = [];
    store.subscribe((event) => events.push(event));

    store.users.put({ id: "1", name: "Alice", profile: {} });
    store.notes.put({ id: "1", content: "Hello" });

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ users: true });
    expect(events[1]).toEqual({ notes: true });
  });

  test("global subscribe returns unsubscribe function", () => {
    const store = createProfileStore();

    const callback = vi.fn();
    const unsubscribe = store.subscribe(callback);

    store.users.put({ id: "1", name: "Alice", profile: {} });
    expect(callback).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.users.put({ id: "2", name: "Bob", profile: {} });
    expect(callback).toHaveBeenCalledTimes(1);
  });
});

describe("transact", () => {
  test("transaction throws error for non-existent collection", () => {
    const store = createMultiCollectionStore();

    expect(() => {
      store.transact(["users", "orders" as any], (_tx) => {
        // This should never execute
      });
    }).toThrow('Collection "orders" not found');
  });

  test("transaction with multiple collections commits atomically", () => {
    const store = createMultiCollectionStore();

    store.transact(["users", "notes"], (tx) => {
      const user = tx.users.put({ id: "u1", name: "Alice", profile: {} });
      tx.notes.put({ id: "n1", content: `Note for ${user.name}` });
    });

    expect(store.users.get("u1")).toEqual({ id: "u1", name: "Alice", profile: {} });
    expect(store.notes.get("n1")).toEqual({ id: "n1", content: "Note for Alice" });
  });

  test("transaction rollback on error", () => {
    const store = createMultiCollectionStore();

    store.users.put({ id: "u1", name: "Alice", profile: {} });

    expect(() => {
      store.transact(["users", "notes"], (tx) => {
        tx.users.put({ id: "u2", name: "Bob", profile: {} });
        tx.notes.put({ id: "n1", content: "Hello" });
        throw new Error("Transaction failed");
      });
    }).toThrow("Transaction failed");

    // Original state should be preserved
    expect(store.users.get("u1")).toEqual({ id: "u1", name: "Alice", profile: {} });
    expect(store.users.get("u2")).toBeUndefined();
    expect(store.notes.get("n1")).toBeUndefined();
  });

  test("transaction emits single event on commit", () => {
    const store = createMultiCollectionStore();

    const events: any[] = [];
    store.subscribe((event) => {
      events.push(event);
    });

    store.transact(["users", "notes"], (tx) => {
      tx.users.put({ id: "u1", name: "Alice", profile: {} });
      tx.notes.put({ id: "n1", content: "Hello" });
    });

    // Should emit only one event with both collections
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ users: true, notes: true });
  });

  test("transaction return value is passed through", () => {
    const store = createMultiCollectionStore();

    const result = store.transact(["users"], (tx) => {
      const user = tx.users.put({ id: "u1", name: "Alice", profile: {} });
      return user;
    });

    expect(result).toEqual({ id: "u1", name: "Alice", profile: {} });
  });

  test("transaction with cross-collection references", () => {
    const store = createMultiCollectionStore();

    store.transact(["users", "notes"], (tx) => {
      const user = tx.users.put({ id: "u1", name: "Alice", profile: {} });
      tx.notes.put({ id: "n1", content: `Note for user ${user.id}` });
    });

    const note = store.notes.get("n1");
    expect(note).toEqual({ id: "n1", content: "Note for user u1" });
  });

  test("transaction only emits event for mutated collections", () => {
    const store = createMultiCollectionStore();

    const events: any[] = [];
    store.subscribe((event) => {
      events.push(event);
    });

    store.transact(["users", "notes"], (tx) => {
      // Only mutate users, not notes
      tx.users.put({ id: "u1", name: "Alice", profile: {} });
    });

    // Should only include users in the event
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ users: true });
    expect(events[0]).not.toHaveProperty("notes");
  });

  test("transaction with no mutations emits no event", () => {
    const store = createMultiCollectionStore();

    store.users.put({ id: "u1", name: "Alice", profile: {} });

    const events: any[] = [];
    store.subscribe((event) => {
      events.push(event);
    });

    store.transact(["users", "notes"], (tx) => {
      // Just read, don't mutate
      const user = tx.users.get("u1");
      expect(user).toEqual({ id: "u1", name: "Alice", profile: {} });
    });

    // Should not emit any event
    expect(events).toHaveLength(0);
  });

  test("transaction can use returned documents from put", () => {
    const store = createMultiCollectionStore();

    store.transact(["users", "notes"], (tx) => {
      const user = tx.users.put({ id: "u1", name: "Alice", profile: {} });
      expect(user.id).toBe("u1");
      expect(user.name).toBe("Alice");
      tx.notes.put({ id: "n1", content: `Created by ${user.name}` });
    });

    expect(store.notes.get("n1")).toEqual({ id: "n1", content: "Created by Alice" });
  });

  test("transaction can use returned documents from patch", () => {
    const store = createMultiCollectionStore();

    store.users.put({ id: "u1", name: "Alice", profile: {} });

    store.transact(["users", "notes"], (tx) => {
      const updated = tx.users.patch("u1", { name: "Alice Updated" });
      expect(updated.name).toBe("Alice Updated");
      tx.notes.put({ id: "n1", content: `Updated by ${updated.name}` });
    });

    expect(store.users.get("u1")).toEqual({ id: "u1", name: "Alice Updated", profile: {} });
    expect(store.notes.get("n1")).toEqual({ id: "n1", content: "Updated by Alice Updated" });
  });

  test("transaction throws error for non-existent collection", () => {
    const store = createProfileStore();

    expect(() => {
      store.transact(["nonexistent" as any], (_tx) => {
        // This should never execute
      });
    }).toThrow('Collection "nonexistent" not found');
  });
});
