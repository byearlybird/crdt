import { describe, expect, test } from "vitest";
import { createMultiCollectionStore, createProfileStore } from "./test-utils";

describe("createStore", () => {
  test("can add documents to collections", () => {
    const store = createProfileStore();

    store.transact(({ users }) => {
      users.add({
        id: "1",
        name: "Alice",
        profile: { age: 30 },
      });
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

    expect(store.users.get("1")).toBeUndefined();
    expect(store.users.get("2")).toEqual({
      id: "2",
      name: "Bob",
      profile: {},
    });
  });

  test("can update documents in collections", () => {
    const store = createProfileStore();

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

    const result = store.users.get("1");
    expect(result).toEqual({
      id: "1",
      name: "Alice",
      profile: { age: 30 },
    });
  });

  test("tombstones are store-level and globally unique", () => {
    const store = createMultiCollectionStore();

    store.transact(({ users }) => {
      users.add({ id: "123", name: "Alice", profile: {} });
      users.remove("123");
    });

    // Should be undefined (tombstoned)
    expect(store.users.get("123")).toBeUndefined();
  });

  test("removed documents don't appear in list", () => {
    const store = createProfileStore();

    store.transact(({ users }) => {
      users.add({ id: "1", name: "Alice", profile: {} });
      users.add({ id: "2", name: "Bob", profile: {} });
      users.add({ id: "3", name: "Charlie", profile: {} });
    });

    expect(store.users.list()).toHaveLength(3);

    store.transact(({ users }) => {
      users.remove("2");
    });

    const allUsers = store.users.list();
    expect(allUsers).toHaveLength(2);
    expect(allUsers.find((u) => u.id === "2")).toBeUndefined();
    expect(allUsers.find((u) => u.id === "1")).toBeDefined();
    expect(allUsers.find((u) => u.id === "3")).toBeDefined();
  });

  describe("transact", () => {
    test("transact returns callback return value", () => {
      const store = createProfileStore();

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

    test("empty transaction works", () => {
      const store = createProfileStore();

      const result = store.transact(() => {
        return "done";
      });

      expect(result).toBe("done");
    });

    test("read-only transaction doesn't notify listeners", async () => {
      const store = createProfileStore();

      store.transact(({ users }) => {
        users.add({ id: "1", name: "Alice", profile: {} });
      });

      const changes: string[] = [];
      const middleware = ({ subscribe }: any) => {
        subscribe((event: any) => {
          changes.push(...Object.keys(event));
        });
      };

      store.use(middleware);
      await store.init();

      // Read-only transaction
      store.transact(({ users }) => {
        users.get("1"); // Just read
      });

      expect(changes).toHaveLength(0); // No notification
    });

    test("transact rolls back on error", () => {
      const store = createProfileStore();

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
      expect(store.users.get("2")).toBeUndefined();
      expect(store.users.get("1")?.name).toBe("Alice");
    });

    test("transact can read within transaction", () => {
      const store = createProfileStore();

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
      const store = createProfileStore();

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
      expect(store.users.get("3")).toBeDefined(); // But the new one should be added
    });
  });

  test("direct handle access returns current results", () => {
    const store = createProfileStore();

    store.transact(({ users }) => {
      users.add({ id: "1", name: "Alice", profile: {} });
    });

    expect(store.users.get("1")).toEqual({
      id: "1",
      name: "Alice",
      profile: {},
    });

    store.transact(({ users }) => {
      users.update("1", { name: "Alice Updated" });
    });

    expect(store.users.get("1")).toEqual({
      id: "1",
      name: "Alice Updated",
      profile: {},
    });
  });

  describe("store-level writes", () => {
    test("can add documents directly on store", () => {
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

    test("can update documents directly on store", () => {
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

    test("can remove documents directly on store", () => {
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

    test("store-level writes notify listeners", async () => {
      const store = createProfileStore();

      const changes: string[] = [];
      const middleware = ({ subscribe }: any) => {
        subscribe((event: any) => {
          changes.push(...Object.keys(event));
        });
      };

      store.use(middleware);
      await store.init();

      store.users.add({ id: "1", name: "Alice", profile: {} });

      expect(changes).toContain("users");
    });

    test("store-level writes and transact can be mixed", () => {
      const store = createProfileStore();

      // Add via store-level write
      store.users.add({
        id: "1",
        name: "Alice",
        profile: {},
      });

      expect(store.users.get("1")).toEqual({
        id: "1",
        name: "Alice",
        profile: {},
      });

      // Update via transact
      store.transact(({ users }) => {
        users.update("1", {
          profile: { age: 30 },
        });
      });

      expect(store.users.get("1")).toEqual({
        id: "1",
        name: "Alice",
        profile: { age: 30 },
      });

      // Remove via store-level write
      store.users.remove("1");

      expect(store.users.get("1")).toBeUndefined();
    });

    test("tombstones from store-level writes are store-level", () => {
      const store = createMultiCollectionStore();

      store.users.add({ id: "123", name: "Alice", profile: {} });
      store.users.remove("123");

      // Should be undefined (tombstoned)
      expect(store.users.get("123")).toBeUndefined();
    });
  });
});

describe("middleware", () => {
  test("can register and initialize middleware", async () => {
    const initOrder: string[] = [];
    const middleware = () => {
      initOrder.push("middleware1");
    };

    const store = createProfileStore();

    store.use(middleware);
    await store.init();

    expect(initOrder).toEqual(["middleware1"]);
  });

  test("use() is chainable", async () => {
    const initOrder: string[] = [];
    const middleware1 = () => {
      initOrder.push("middleware1");
    };
    const middleware2 = () => {
      initOrder.push("middleware2");
    };

    const store = createProfileStore().use(middleware1).use(middleware2);

    await store.init();

    expect(initOrder).toEqual(["middleware1", "middleware2"]);
  });

  test("middleware can subscribe to changes", async () => {
    const changes: string[] = [];
    const middleware = ({ subscribe }: any) => {
      subscribe((event: any) => {
        changes.push(...Object.keys(event));
      });
    };

    const store = createProfileStore().use(middleware);

    await store.init();

    store.transact(({ users }) => {
      users.add({ id: "1", name: "Alice", profile: {} });
    });

    expect(changes).toContain("users");
  });

  test("middleware can load data via setState", async () => {
    const snapshot = {
      clock: { ms: 1000, seq: 0 },
      collections: {
        users: {
          "1": {
            id: { "~value": "1", "~stamp": "1000:0" },
            name: { "~value": "Alice", "~stamp": "1000:0" },
            profile: { "~value": {}, "~stamp": "1000:0" },
          },
        },
      },
      tombstones: {},
    };

    const middleware = ({ setState }: any) => {
      setState(snapshot, { silent: true });
    };

    const store = createProfileStore().use(middleware);

    await store.init();

    const user = store.users.get("1");
    expect(user).toEqual({
      id: "1",
      name: "Alice",
      profile: {},
    });
  });

  test("middleware can access getState", async () => {
    let capturedSnapshot: any = null;
    const middleware = ({ getState }: any) => {
      capturedSnapshot = getState();
    };

    const store = createProfileStore().use(middleware);

    await store.init();

    expect(capturedSnapshot).toHaveProperty("clock");
    expect(capturedSnapshot).toHaveProperty("collections");
    expect(capturedSnapshot).toHaveProperty("tombstones");
  });

  test("throws error when adding middleware after init", async () => {
    const store = createProfileStore();

    await store.init();

    expect(() => {
      store.use(() => {});
    }).toThrow("Cannot add middleware after initialization");
  });

  test("throws error when initializing twice", async () => {
    const store = createProfileStore().use(() => {});

    await store.init();

    await expect(store.init()).rejects.toThrow("Store already initialized");
  });

  test("throws error when disposing uninitialized store", async () => {
    const store = createProfileStore();

    await expect(store.dispose()).rejects.toThrow("Store not initialized");
  });

  test("middleware cleanup is called on dispose", async () => {
    const changes: string[] = [];
    const middleware = ({ subscribe }: any) => {
      const unsubscribe = subscribe((event: any) => {
        changes.push(...Object.keys(event));
      });

      // Middleware returns cleanup function
      return unsubscribe;
    };

    const store = createProfileStore().use(middleware);

    await store.init();
    await store.dispose();

    // Clear previous changes
    changes.length = 0;

    // Make a change after dispose
    store.transact(({ users }) => {
      users.add({ id: "1", name: "Alice", profile: {} });
    });

    // Middleware should not receive the change because cleanup was called
    expect(changes).toHaveLength(0);
  });

  test("store works without middleware", () => {
    const store = createProfileStore();

    // Should be able to use store immediately without init
    store.transact(({ users }) => {
      users.add({ id: "1", name: "Alice", profile: {} });
    });

    const user = store.users.get("1");
    expect(user).toEqual({
      id: "1",
      name: "Alice",
      profile: {},
    });
  });

  test("setState replaces store state", async () => {
    const store = createProfileStore();

    // Add initial data
    store.transact(({ users }) => {
      users.add({ id: "1", name: "Alice", profile: {} });
    });

    // Create a new snapshot with different data
    const newSnapshot = {
      clock: { ms: 2000, seq: 0 },
      collections: {
        users: {
          "2": {
            id: { "~value": "2", "~stamp": "2000:0" },
            name: { "~value": "Bob", "~stamp": "2000:0" },
            profile: { "~value": {}, "~stamp": "2000:0" },
          },
        },
      },
      tombstones: {},
    };

    // Use middleware to access setState
    let setStateFn: any = null;
    const middleware = ({ setState }: any) => {
      setStateFn = setState;
    };

    store.use(middleware);
    await store.init();

    // Apply new snapshot
    setStateFn(newSnapshot, { silent: true });

    // Verify old data is gone and new data is present
    expect(store.users.get("1")).toBeUndefined();
    expect(store.users.get("2")).toEqual({
      id: "2",
      name: "Bob",
      profile: {},
    });
  });

  test("setState advances clock", async () => {
    const store = createProfileStore();

    let setStateFn: any = null;
    let getStateFn: any = null;
    const middleware = ({ setState, getState }: any) => {
      setStateFn = setState;
      getStateFn = getState;
    };

    store.use(middleware);
    await store.init();

    const initial = getStateFn();
    const initialMs = initial.clock.ms;

    const newSnapshot = {
      clock: { ms: initialMs + 1000, seq: 5 },
      collections: { users: {} },
      tombstones: {},
    };

    setStateFn(newSnapshot, { silent: true });

    const after = getStateFn();
    expect(after.clock.ms).toBe(initialMs + 1000);
    expect(after.clock.seq).toBeGreaterThanOrEqual(5);
  });

  test("setState does not notify - middleware uses notify explicitly", async () => {
    const store = createProfileStore();

    let notified = false;
    const unsubscribeFns: (() => void)[] = [];

    let setStateFn: any = null;
    let notifyFn: any = null;
    const middleware = ({ setState, notify, subscribe }: any) => {
      setStateFn = setState;
      notifyFn = notify;
      const unsubscribe = subscribe((event: any) => {
        if (Object.keys(event).length > 0) {
          notified = true;
        }
      });
      unsubscribeFns.push(unsubscribe);
      return () => {
        unsubscribeFns.forEach((fn) => fn());
        unsubscribeFns.length = 0;
      };
    };

    store.use(middleware);
    await store.init();

    const snapshot = {
      clock: { ms: 1000, seq: 0 },
      collections: {
        users: {
          "1": {
            id: { "~value": "1", "~stamp": "1000:0" },
            name: { "~value": "Alice", "~stamp": "1000:0" },
            profile: { "~value": {}, "~stamp": "1000:0" },
          },
        },
      },
      tombstones: {},
    };

    // setState does not notify
    notified = false;
    setStateFn(snapshot);
    expect(notified).toBe(false);

    // Middleware uses notify explicitly
    notified = false;
    notifyFn({ users: true });
    expect(notified).toBe(true);

    unsubscribeFns.forEach((fn) => fn());
  });
});
