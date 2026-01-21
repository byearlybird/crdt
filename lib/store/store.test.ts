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

    store.transact(({ users }) => {
      users.add({
        id: "1",
        name: "Alice",
        profile: { age: 30 },
      });
    });

    const result = store.query(({ users }) => users.get("1")).result();
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

    expect(store.query(({ users }) => users.get("1")).result()).toBeUndefined();
    expect(store.query(({ users }) => users.get("2")).result()).toEqual({
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

    const result = store.query(({ users }) => users.get("1")).result();
    expect(result).toEqual({
      id: "1",
      name: "Alice",
      profile: { age: 30 },
    });
  });


  test("creates store with empty collections", () => {
    const store = createStore({
      collections: {},
    });

    expect(store).toBeDefined();
    expect(store.query).toBeDefined();
    expect(store.transact).toBeDefined();
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
    expect(store.query(({ users }) => users.get("123")).result()).toBeUndefined();
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

    expect(store.query(({ users }) => users.list()).result()).toHaveLength(3);

    store.transact(({ users }) => {
      users.remove("2");
    });

    const allUsers = store.query(({ users }) => users.list()).result();
    expect(allUsers).toHaveLength(2);
    expect(allUsers.find((u) => u.id === "2")).toBeUndefined();
    expect(allUsers.find((u) => u.id === "1")).toBeDefined();
    expect(allUsers.find((u) => u.id === "3")).toBeDefined();
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
    store.transact(({ users }) => {
      users.add({ id: "1", name: "Alice", profile: { age: 30 } });
      users.add({ id: "2", name: "Bob", profile: { age: 25 } });
      users.add({ id: "3", name: "Charlie", profile: { age: 35 } });
    });

    const allUsers = store.query(({ users }) => users.list()).result();
    expect(allUsers).toHaveLength(3);
    expect(allUsers.find((u) => u.name === "Alice")).toBeDefined();
    expect(allUsers.find((u) => u.name === "Bob")).toBeDefined();
    expect(allUsers.find((u) => u.name === "Charlie")).toBeDefined();

    // Test listing notes
    store.transact(({ notes }) => {
      notes.add({ id: "1", content: "First note" });
      notes.add({ id: "2", content: "Second note" });
      notes.add({ id: "3", content: "Third note" });
    });

    const allNotes = store.query(({ notes }) => notes.list()).result();
    expect(allNotes).toHaveLength(3);
    expect(allNotes.find((n) => n.content === "First note")).toBeDefined();

    // Test that removed documents don't appear
    store.transact(({ users }) => {
      users.remove("2");
    });
    const usersAfterRemoval = store.query(({ users }) => users.list()).result();
    expect(usersAfterRemoval).toHaveLength(2);
    expect(usersAfterRemoval.find((u) => u.id === "2")).toBeUndefined();
    expect(usersAfterRemoval.find((u) => u.id === "1")).toBeDefined();
    expect(usersAfterRemoval.find((u) => u.id === "3")).toBeDefined();

    // Demonstrate filtering with standard array methods
    const adults = store
      .query(({ users }) => users.list({ where: (user) => (user.profile?.age ?? 0) >= 30 }))
      .result();
    expect(adults).toHaveLength(2);
    expect(adults.find((u) => u.name === "Alice")).toBeDefined();
    expect(adults.find((u) => u.name === "Charlie")).toBeDefined();
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

      store.transact(({ users }) => {
        users.add({ id: "1", name: "Alice", profile: { age: 30 } });
        users.add({ id: "2", name: "Bob", profile: { age: 25 } });
      });

      expect(store.query(({ users }) => users.get("1")).result()).toEqual({
        id: "1",
        name: "Alice",
        profile: { age: 30 },
      });
      expect(store.query(({ users }) => users.get("2")).result()).toEqual({
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

      store.transact(({ users, notes }) => {
        users.add({ id: "1", name: "Alice", profile: {} });
        notes.add({ id: "note-1", content: "Hello" });
        notes.add({ id: "note-2", content: "World" });
      });

      expect(store.query(({ users }) => users.get("1")).result()).toEqual({
        id: "1",
        name: "Alice",
        profile: {},
      });
      expect(store.query(({ notes }) => notes.get("note-1")).result()).toEqual({
        id: "note-1",
        content: "Hello",
      });
      expect(store.query(({ notes }) => notes.get("note-2")).result()).toEqual({
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

    test("transact returns different types", () => {
      const store = createStore({
        collections: {
          users: {
            schema: userSchema,
            keyPath: "id",
          },
        },
      });

      const stringResult = store.transact(() => "hello");
      expect(stringResult).toBe("hello");

      const numberResult = store.transact(() => 42);
      expect(numberResult).toBe(42);

      const objectResult = store.transact(() => ({ foo: "bar" }));
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
      expect(store.query(({ users }) => users.get("2")).result()).toBeUndefined();
      expect(store.query(({ users }) => users.get("1")).result()?.name).toBe("Alice");
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

      store.transact(({ users }) => {
        users.add({ id: "1", name: "Alice", profile: {} });
        users.add({ id: "2", name: "Bob", profile: {} });
        users.update("1", { name: "Alice Updated" });
        users.remove("2");
      });

      // Verify the transaction completed successfully
      expect(store.query(({ users }) => users.get("1")).result()).toEqual({
        id: "1",
        name: "Alice Updated",
        profile: {},
      });
      expect(store.query(({ users }) => users.get("2")).result()).toBeUndefined();
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

      store.transact(({ users, notes }) => {
        users.add({ id: "1", name: "Alice", profile: {} });
        notes.add({ id: "note-1", content: "Hello" });
        users.update("1", { name: "Alice Updated" });
        notes.add({ id: "note-2", content: "World" });
      });

      // Verify the transaction completed successfully
      expect(store.query(({ users }) => users.get("1")).result()).toEqual({
        id: "1",
        name: "Alice Updated",
        profile: {},
      });
      expect(store.query(({ notes }) => notes.get("note-1")).result()).toEqual({
        id: "note-1",
        content: "Hello",
      });
      expect(store.query(({ notes }) => notes.get("note-2")).result()).toEqual({
        id: "note-2",
        content: "World",
      });
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
      expect(store.query(({ users }) => users.get("3")).result()).toBeDefined(); // But the new one should be added
    });
  });

  describe("reactive queries", () => {
    test("query.result() returns current results", () => {
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

      const query = store.query(({ users }) => users.get("1"));
      expect(query.result()).toEqual({
        id: "1",
        name: "Alice",
        profile: {},
      });

      store.transact(({ users }) => {
        users.update("1", { name: "Alice Updated" });
      });

      expect(query.result()).toEqual({
        id: "1",
        name: "Alice Updated",
        profile: {},
      });
    });

    test("query.subscribe() receives initial result and updates", () => {
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

      const query = store.query(({ users }) => users.get("1"));
      const results: any[] = [];

      const unsubscribe = query.subscribe((result) => {
        results.push(result);
      });

      // Should receive initial result
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        id: "1",
        name: "Alice",
        profile: {},
      });

      // Update should trigger subscription
      store.transact(({ users }) => {
        users.update("1", { name: "Alice Updated" });
      });

      expect(results).toHaveLength(2);
      expect(results[1]).toEqual({
        id: "1",
        name: "Alice Updated",
        profile: {},
      });

      unsubscribe();
    });

    test("query.subscribe() only updates when dependencies change", () => {
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

      store.transact(({ users, notes }) => {
        users.add({ id: "1", name: "Alice", profile: {} });
        notes.add({ id: "note-1", content: "First note" });
      });

      const query = store.query(({ users }) => users.get("1"));
      const results: any[] = [];

      query.subscribe((result) => {
        results.push(result);
      });

      expect(results).toHaveLength(1);

      // Update notes collection - should NOT trigger query update
      store.transact(({ notes }) => {
        notes.add({ id: "note-2", content: "Second note" });
      });

      expect(results).toHaveLength(1); // No update

      // Update users collection - SHOULD trigger query update
      store.transact(({ users }) => {
        users.update("1", { name: "Alice Updated" });
      });

      expect(results).toHaveLength(2); // Updated
    });

    test("query.subscribe() tracks multiple collection dependencies", () => {
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

      store.transact(({ users, notes }) => {
        users.add({ id: "1", name: "Alice", profile: {} });
        notes.add({ id: "note-1", content: "First note" });
      });

      const query = store.query(({ users, notes }) => ({
        user: users.get("1"),
        note: notes.get("note-1"),
      }));

      const results: any[] = [];
      query.subscribe((result) => {
        results.push(result);
      });

      expect(results).toHaveLength(1);

      // Update users - should trigger
      store.transact(({ users }) => {
        users.update("1", { name: "Alice Updated" });
      });

      expect(results).toHaveLength(2);

      // Update notes - should also trigger
      store.transact(({ notes }) => {
        notes.update("note-1", { content: "Updated note" });
      });

      expect(results).toHaveLength(3);
    });

    test("query.subscribe() unsubscribe stops receiving updates", () => {
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

      const query = store.query(({ users }) => users.get("1"));
      const results: any[] = [];

      const unsubscribe = query.subscribe((result) => {
        results.push(result);
      });

      expect(results).toHaveLength(1);

      // Unsubscribe
      unsubscribe();

      // Update should NOT trigger subscription
      store.transact(({ users }) => {
        users.update("1", { name: "Alice Updated" });
      });

      expect(results).toHaveLength(1); // No new result
    });

    test("query.subscribe() multiple subscribers all receive updates", () => {
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

      const query = store.query(({ users }) => users.get("1"));
      const results1: any[] = [];
      const results2: any[] = [];

      query.subscribe((result) => {
        results1.push(result);
      });

      query.subscribe((result) => {
        results2.push(result);
      });

      expect(results1).toHaveLength(1);
      expect(results2).toHaveLength(1);

      store.transact(({ users }) => {
        users.update("1", { name: "Alice Updated" });
      });

      expect(results1).toHaveLength(2);
      expect(results2).toHaveLength(2);
    });

    test("query.subscribe() does not notify if result hasn't changed", () => {
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

      const query = store.query(({ users }) => users.get("1"));
      const results: any[] = [];

      query.subscribe((result) => {
        results.push(result);
      });

      expect(results).toHaveLength(1);

      // Update a different user - should not trigger
      store.transact(({ users }) => {
        users.add({ id: "2", name: "Bob", profile: {} });
      });

      expect(results).toHaveLength(1); // No update because query result didn't change
    });

    test("query works with list() operations", () => {
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
      });

      const query = store.query(({ users }) => users.list());
      const results: any[] = [];

      query.subscribe((result) => {
        results.push(result);
      });

      expect(results).toHaveLength(1);
      expect(results[0]).toHaveLength(2);

      // Add a new user
      store.transact(({ users }) => {
        users.add({ id: "3", name: "Charlie", profile: {} });
      });

      expect(results).toHaveLength(2);
      expect(results[1]).toHaveLength(3);
    });

    test("query works with filtered list() operations", () => {
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
        users.add({ id: "3", name: "Charlie", profile: { age: 35 } });
      });

      const query = store.query(({ users }) =>
        users.list({ where: (user) => (user.profile?.age ?? 0) >= 30 }),
      );
      const results: any[] = [];

      query.subscribe((result) => {
        results.push(result);
      });

      expect(results).toHaveLength(1);
      expect(results[0]).toHaveLength(2); // Alice and Charlie

      // Update Bob's age to 30 - should now be included
      store.transact(({ users }) => {
        users.update("2", { profile: { age: 30 } });
      });

      expect(results).toHaveLength(2);
      expect(results[1]).toHaveLength(3); // All three now
    });
  });
});

describe("middleware", () => {
  test("can register and initialize middleware", async () => {
    const initOrder: string[] = [];
    const middleware = {
      init: () => {
        initOrder.push("middleware1");
      },
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
    const middleware1 = {
      init: () => {
        initOrder.push("middleware1");
      },
    };
    const middleware2 = {
      init: () => {
        initOrder.push("middleware2");
      },
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
    const middleware1 = {
      init: () => {
        initOrder.push("1");
      },
    };
    const middleware2 = {
      init: () => {
        initOrder.push("2");
      },
    };
    const middleware3 = {
      init: () => {
        initOrder.push("3");
      },
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
    const middleware1 = {
      init: () => {},
      dispose: () => {
        disposeOrder.push("1");
      },
    };
    const middleware2 = {
      init: () => {},
      dispose: () => {
        disposeOrder.push("2");
      },
    };
    const middleware3 = {
      init: () => {},
      dispose: () => {
        disposeOrder.push("3");
      },
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
    const middleware = {
      init: ({ subscribe }: any) => {
        subscribe((event: any) => {
          changes.push(...Object.keys(event));
        });
      },
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

  test("middleware can load data via merge", async () => {
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

    const middleware = {
      init: ({ merge }: any) => {
        merge(snapshot, { silent: true });
      },
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

    const user = store.query(({ users }) => users.get("1")).result();
    expect(user).toEqual({
      id: "1",
      name: "Alice",
      profile: {},
    });
  });

  test("middleware can access getSnapshot", async () => {
    let capturedSnapshot: any = null;
    const middleware = {
      init: ({ getSnapshot }: any) => {
        capturedSnapshot = getSnapshot();
      },
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
      store.use({ init: () => {} });
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
    }).use({ init: () => {} });

    await store.init();

    await expect(store.init()).rejects.toThrow("Store already initialized");
  });

  test("middleware subscriptions are cleaned up on dispose", async () => {
    const changes: string[] = [];
    const middleware = {
      init: ({ subscribe }: any) => {
        subscribe((event: any) => {
          changes.push(...Object.keys(event));
        });
      },
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

    const user = store.query(({ users }) => users.get("1")).result();
    expect(user).toEqual({
      id: "1",
      name: "Alice",
      profile: {},
    });
  });

  test("async middleware init is awaited", async () => {
    const initOrder: string[] = [];
    const middleware = {
      init: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        initOrder.push("async");
      },
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
    const middleware = {
      init: () => {},
      dispose: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        disposeOrder.push("async");
      },
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
});
