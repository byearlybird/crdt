import { describe, expect, test } from "vitest";
import { createMultiCollectionStore, createProfileStore } from "./test-utils";

describe("createStore", () => {
  test("can add documents to collections", () => {
    const store = createProfileStore();

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
    const store = createProfileStore();

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
    const store = createProfileStore();

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

  test("tombstones are store-level and globally unique", () => {
    const store = createMultiCollectionStore();

    store.users.add({ id: "123", name: "Alice", profile: {} });
    store.users.remove("123");

    // Should be undefined (tombstoned)
    expect(store.users.get("123")).toBeUndefined();
  });

  test("removed documents don't appear in list", () => {
    const store = createProfileStore();

    store.users.add({ id: "1", name: "Alice", profile: {} });
    store.users.add({ id: "2", name: "Bob", profile: {} });
    store.users.add({ id: "3", name: "Charlie", profile: {} });

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

    store.users.add({ id: "1", name: "Alice", profile: {} });

    expect(store.users.get("1")).toEqual({
      id: "1",
      name: "Alice",
      profile: {},
    });

    store.users.update("1", { name: "Alice Updated" });

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

    store.users.add({ id: "1", name: "Alice", profile: {} });

    expect(changes).toContain("users");
  });
});

describe("getState and setState", () => {
  test("getState returns current state", () => {
    const store = createProfileStore();

    const state = store.getState();
    expect(state).toHaveProperty("clock");
    expect(state).toHaveProperty("collections");
    expect(state).toHaveProperty("tombstones");
  });

  test("setState applies state via applyState", () => {
    const store = createProfileStore();

    store.users.add({ id: "1", name: "Alice", profile: {} });

    const newSnapshot = {
      clock: { ms: 2000, seq: 0 },
      collections: {
        users: {
          "2": {
            id: { "~val": "2", "~ts": "2000:0" },
            name: { "~val": "Bob", "~ts": "2000:0" },
            profile: { "~val": {}, "~ts": "2000:0" },
          },
        },
      },
      tombstones: {},
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
      collections: { users: {} },
      tombstones: {},
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
          "1": {
            id: { "~val": "1", "~ts": "1000:0" },
            name: { "~val": "Alice", "~ts": "1000:0" },
            profile: { "~val": {}, "~ts": "1000:0" },
          },
        },
      },
      tombstones: {},
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
