import { describe, test, expect } from "vitest";
import { z } from "zod";
import { createStore } from "./store";
import { mergeSnapshots } from "../core";

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

    const result = store.read(({ users }) => users.get("1"));
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

    expect(store.read(({ users }) => users.get("1"))).toBeUndefined();
    expect(store.read(({ users }) => users.get("2"))).toEqual({
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

    const result = store.read(({ users }) => users.get("1"));
    expect(result).toEqual({
      id: "1",
      name: "Alice",
      profile: { age: 30 },
    });
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
    expect(store.read(({ users }) => users.get("123"))).toBeUndefined();
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

    expect(store.read(({ users }) => users.list())).toHaveLength(3);

    store.transact(({ users }) => {
      users.remove("2");
    });

    const allUsers = store.read(({ users }) => users.list());
    expect(allUsers).toHaveLength(2);
    expect(allUsers.find((u) => u.id === "2")).toBeUndefined();
    expect(allUsers.find((u) => u.id === "1")).toBeDefined();
    expect(allUsers.find((u) => u.id === "3")).toBeDefined();
  });

  describe("transact", () => {
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
      expect(store.read(({ users }) => users.get("2"))).toBeUndefined();
      expect(store.read(({ users }) => users.get("1"))?.name).toBe("Alice");
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
      expect(store.read(({ users }) => users.get("3"))).toBeDefined(); // But the new one should be added
    });
  });

  describe("read", () => {
    test("read() returns current results", () => {
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

      expect(store.read(({ users }) => users.get("1"))).toEqual({
        id: "1",
        name: "Alice",
        profile: {},
      });

      store.transact(({ users }) => {
        users.update("1", { name: "Alice Updated" });
      });

      expect(store.read(({ users }) => users.get("1"))).toEqual({
        id: "1",
        name: "Alice Updated",
        profile: {},
      });
    });
  });
});

describe("middleware", () => {
  test("can register and initialize middleware", async () => {
    const initOrder: string[] = [];
    const middleware = () => {
      initOrder.push("middleware1");
    };

    const store = createStore({
      collections: {
        users: {
          schema: userSchema,
          keyPath: "id",
        },
      },
    });

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

    const store = createStore({
      collections: {
        users: {
          schema: userSchema,
          keyPath: "id",
        },
      },
    })
      .use(middleware1)
      .use(middleware2);

    await store.init();

    expect(initOrder).toEqual(["middleware1", "middleware2"]);
  });

  test("middleware init runs in registration order", async () => {
    const initOrder: string[] = [];
    const middleware1 = () => {
      initOrder.push("1");
    };
    const middleware2 = () => {
      initOrder.push("2");
    };
    const middleware3 = () => {
      initOrder.push("3");
    };

    const store = createStore({
      collections: {
        users: {
          schema: userSchema,
          keyPath: "id",
        },
      },
    })
      .use(middleware1)
      .use(middleware2)
      .use(middleware3);

    await store.init();

    expect(initOrder).toEqual(["1", "2", "3"]);
  });

  test("middleware dispose runs in reverse order", async () => {
    const disposeOrder: string[] = [];
    const middleware1 = () => {
      return () => {
        disposeOrder.push("1");
      };
    };
    const middleware2 = () => {
      return () => {
        disposeOrder.push("2");
      };
    };
    const middleware3 = () => {
      return () => {
        disposeOrder.push("3");
      };
    };

    const store = createStore({
      collections: {
        users: {
          schema: userSchema,
          keyPath: "id",
        },
      },
    })
      .use(middleware1)
      .use(middleware2)
      .use(middleware3);

    await store.init();
    await store.dispose();

    expect(disposeOrder).toEqual(["3", "2", "1"]);
  });

  test("middleware can subscribe to changes", async () => {
    const changes: string[] = [];
    const middleware = ({ subscribe }: any) => {
      subscribe((event: any) => {
        changes.push(...Object.keys(event));
      });
    };

    const store = createStore({
      collections: {
        users: {
          schema: userSchema,
          keyPath: "id",
        },
      },
    }).use(middleware);

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

    const store = createStore({
      collections: {
        users: {
          schema: userSchema,
          keyPath: "id",
        },
      },
    }).use(middleware);

    await store.init();

    const user = store.read(({ users }) => users.get("1"));
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

    const store = createStore({
      collections: {
        users: {
          schema: userSchema,
          keyPath: "id",
        },
      },
    }).use(middleware);

    await store.init();

    expect(capturedSnapshot).toHaveProperty("clock");
    expect(capturedSnapshot).toHaveProperty("collections");
    expect(capturedSnapshot).toHaveProperty("tombstones");
  });

  test("throws error when adding middleware after init", async () => {
    const store = createStore({
      collections: {
        users: {
          schema: userSchema,
          keyPath: "id",
        },
      },
    });

    await store.init();

    expect(() => {
      store.use(() => {});
    }).toThrow("Cannot add middleware after initialization");
  });

  test("throws error when initializing twice", async () => {
    const store = createStore({
      collections: {
        users: {
          schema: userSchema,
          keyPath: "id",
        },
      },
    }).use(() => {});

    await store.init();

    await expect(store.init()).rejects.toThrow("Store already initialized");
  });

  test("middleware subscriptions are cleaned up on dispose", async () => {
    const changes: string[] = [];
    const middleware = ({ subscribe }: any) => {
      subscribe((event: any) => {
        changes.push(...Object.keys(event));
      });
    };

    const store = createStore({
      collections: {
        users: {
          schema: userSchema,
          keyPath: "id",
        },
      },
    }).use(middleware);

    await store.init();
    await store.dispose();

    // Clear previous changes
    changes.length = 0;

    // Make a change after dispose
    store.transact(({ users }) => {
      users.add({ id: "1", name: "Alice", profile: {} });
    });

    // Middleware should not receive the change
    expect(changes).toHaveLength(0);
  });

  test("store works without middleware", () => {
    const store = createStore({
      collections: {
        users: {
          schema: userSchema,
          keyPath: "id",
        },
      },
    });

    // Should be able to use store immediately without init
    store.transact(({ users }) => {
      users.add({ id: "1", name: "Alice", profile: {} });
    });

    const user = store.read(({ users }) => users.get("1"));
    expect(user).toEqual({
      id: "1",
      name: "Alice",
      profile: {},
    });
  });

  test("async middleware init is awaited", async () => {
    const initOrder: string[] = [];
    const middleware = async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      initOrder.push("async");
    };

    const store = createStore({
      collections: {
        users: {
          schema: userSchema,
          keyPath: "id",
        },
      },
    }).use(middleware);

    const initPromise = store.init();
    expect(initOrder).toHaveLength(0); // Should not have run yet

    await initPromise;
    expect(initOrder).toEqual(["async"]);
  });

  test("async middleware dispose is awaited", async () => {
    const disposeOrder: string[] = [];
    const middleware = () => {
      return async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        disposeOrder.push("async");
      };
    };

    const store = createStore({
      collections: {
        users: {
          schema: userSchema,
          keyPath: "id",
        },
      },
    }).use(middleware);

    await store.init();
    const disposePromise = store.dispose();
    expect(disposeOrder).toHaveLength(0); // Should not have run yet

    await disposePromise;
    expect(disposeOrder).toEqual(["async"]);
  });

  test("setState replaces store state", () => {
    const store = createStore({
      collections: {
        users: {
          schema: userSchema,
          keyPath: "id",
        },
      },
    });

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
    store.init();

    // Apply new snapshot
    setStateFn(newSnapshot, { silent: true });

    // Verify old data is gone and new data is present
    expect(store.read(({ users }) => users.get("1"))).toBeUndefined();
    expect(store.read(({ users }) => users.get("2"))).toEqual({
      id: "2",
      name: "Bob",
      profile: {},
    });
  });

  test("setState advances clock", () => {
    const store = createStore({
      collections: {
        users: {
          schema: userSchema,
          keyPath: "id",
        },
      },
    });

    let setStateFn: any = null;
    let getStateFn: any = null;
    const middleware = ({ setState, getState }: any) => {
      setStateFn = setState;
      getStateFn = getState;
    };

    store.use(middleware);
    store.init();

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

  test("setState notifies listeners unless silent", () => {
    const store = createStore({
      collections: {
        users: {
          schema: userSchema,
          keyPath: "id",
        },
      },
    });

    let notified = false;
    let unsubscribe: (() => void) | null = null;

    let setStateFn: any = null;
    const middleware = ({ setState, subscribe }: any) => {
      setStateFn = setState;
      unsubscribe = subscribe((event: any) => {
        if (Object.keys(event).length > 0) {
          notified = true;
        }
      });
    };

    store.use(middleware);
    store.init();

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

    // Silent should not notify
    notified = false;
    setStateFn(snapshot, { silent: true });
    expect(notified).toBe(false);

    // Not silent should notify
    notified = false;
    setStateFn(snapshot, { silent: false });
    expect(notified).toBe(true);

    if (unsubscribe) {
      unsubscribe();
    }
  });
});

describe("mergeSnapshots", () => {
  test("merges two empty snapshots", () => {
    const local = {
      clock: { ms: 1000, seq: 0 },
      collections: {},
      tombstones: {},
    };

    const remote = {
      clock: { ms: 1000, seq: 0 },
      collections: {},
      tombstones: {},
    };

    const result = mergeSnapshots(local, remote);
    expect(result.merged.clock).toEqual({ ms: 1000, seq: 1 });
    expect(result.merged.collections).toEqual({});
    expect(result.merged.tombstones).toEqual({});
    expect(result.diff.collections).toEqual({});
  });

  test("merges snapshots with new documents", () => {
    const local = {
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

    const remote = {
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

    const result = mergeSnapshots(local, remote);
    expect(result.merged.collections.users["1"]).toBeDefined();
    expect(result.merged.collections.users["2"]).toBeDefined();
    expect(result.diff.collections.users).toEqual({
      added: ["2"],
      updated: [],
      removed: [],
    });
  });

  test("merges snapshots with overlapping documents", () => {
    const local = {
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

    const remote = {
      clock: { ms: 2000, seq: 0 },
      collections: {
        users: {
          "1": {
            id: { "~value": "1", "~stamp": "2000:0" },
            name: { "~value": "Alice Updated", "~stamp": "2000:0" },
            profile: { "~value": {}, "~stamp": "2000:0" },
          },
        },
      },
      tombstones: {},
    };

    const result = mergeSnapshots(local, remote);
    expect(result.merged.collections.users["1"].name["~stamp"]).toBe("2000:0");
    expect(result.diff.collections.users).toEqual({
      added: [],
      updated: ["1"],
      removed: [],
    });
  });

  test("handles tombstoned documents", () => {
    const local = {
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

    const remote = {
      clock: { ms: 2000, seq: 0 },
      collections: {
        users: {},
      },
      tombstones: {
        "1": "2000:0",
      },
    };

    const result = mergeSnapshots(local, remote);
    expect(result.merged.tombstones["1"]).toBe("2000:0");
    expect(result.merged.collections.users["1"]).toBeUndefined();
    expect(result.diff.collections.users).toEqual({
      added: [],
      updated: [],
      removed: ["1"],
    });
  });

  test("advances clock correctly", () => {
    const local = {
      clock: { ms: 1000, seq: 5 },
      collections: {},
      tombstones: {},
    };

    const remote = {
      clock: { ms: 2000, seq: 3 },
      collections: {},
      tombstones: {},
    };

    const result = mergeSnapshots(local, remote);
    expect(result.merged.clock).toEqual({ ms: 2000, seq: 3 });
  });

  test("merges tombstones correctly", () => {
    const local = {
      clock: { ms: 1000, seq: 0 },
      collections: {},
      tombstones: {
        "1": "1000:0",
        "2": "1500:0",
      },
    };

    const remote = {
      clock: { ms: 2000, seq: 0 },
      collections: {},
      tombstones: {
        "2": "2000:0",
        "3": "2000:0",
      },
    };

    const result = mergeSnapshots(local, remote);
    expect(result.merged.tombstones["1"]).toBe("1000:0");
    expect(result.merged.tombstones["2"]).toBe("2000:0"); // Later timestamp wins
    expect(result.merged.tombstones["3"]).toBe("2000:0");
  });

  test("filters tombstoned documents from remote collections", () => {
    const local = {
      clock: { ms: 1000, seq: 0 },
      collections: {},
      tombstones: {},
    };

    const remote = {
      clock: { ms: 2000, seq: 0 },
      collections: {
        users: {
          "1": {
            id: { "~value": "1", "~stamp": "2000:0" },
            name: { "~value": "Alice", "~stamp": "2000:0" },
            profile: { "~value": {}, "~stamp": "2000:0" },
          },
        },
      },
      tombstones: {
        "1": "2000:0",
      },
    };

    const result = mergeSnapshots(local, remote);
    // Document should not be added because it's tombstoned
    expect(result.merged.collections  ["users"]?["1"]).toBeUndefined();
    expect(result.diff.collections.users).toBeUndefined(); // No changes
  });

  test("handles multiple collections", () => {
    const local = {
      clock: { ms: 1000, seq: 0 },
      collections: {
        users: {
          "1": {
            id: { "~value": "1", "~stamp": "1000:0" },
            name: { "~value": "Alice", "~stamp": "1000:0" },
            profile: { "~value": {}, "~stamp": "1000:0" },
          },
        },
        notes: {
          "1": {
            id: { "~value": "1", "~stamp": "1000:0" },
            content: { "~value": "Note 1", "~stamp": "1000:0" },
          },
        },
      },
      tombstones: {},
    };

    const remote = {
      clock: { ms: 2000, seq: 0 },
      collections: {
        users: {
          "2": {
            id: { "~value": "2", "~stamp": "2000:0" },
            name: { "~value": "Bob", "~stamp": "2000:0" },
            profile: { "~value": {}, "~stamp": "2000:0" },
          },
        },
        notes: {
          "1": {
            id: { "~value": "1", "~stamp": "2000:0" },
            content: { "~value": "Note 1 Updated", "~stamp": "2000:0" },
          },
        },
      },
      tombstones: {},
    };

    const result = mergeSnapshots(local, remote);
    expect(result.diff.collections.users).toEqual({
      added: ["2"],
      updated: [],
      removed: [],
    });
    expect(result.diff.collections.notes).toEqual({
      added: [],
      updated: ["1"],
      removed: [],
    });
  });
});
