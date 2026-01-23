import { describe, expect, test, vi } from "vitest";
import { createMultiCollectionStore, createProfileStore } from "./test-utils";

describe("query", () => {
  test("invokes callback immediately with initial value", () => {
    const store = createProfileStore();

    store.users.add({ id: "1", name: "Alice", profile: {} });

    const callback = vi.fn();
    store.query(({ users }) => users.list(), callback);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith([{ id: "1", name: "Alice", profile: {} }]);
  });

  test("returns unsubscribe function", () => {
    const store = createProfileStore();

    const callback = vi.fn();
    const unsubscribe = store.query(({ users }) => users.list(), callback);

    expect(typeof unsubscribe).toBe("function");
  });

  test("callback fires when tracked collection changes", () => {
    const store = createProfileStore();

    const callback = vi.fn();
    store.query(({ users }) => users.list(), callback);

    // Clear the initial call
    callback.mockClear();

    // Trigger a change
    store.users.add({ id: "1", name: "Alice", profile: {} });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith([{ id: "1", name: "Alice", profile: {} }]);
  });

  test("callback fires on update", () => {
    const store = createProfileStore();
    store.users.add({ id: "1", name: "Alice", profile: {} });

    const callback = vi.fn();
    store.query(({ users }) => users.get("1"), callback);

    callback.mockClear();

    store.users.update("1", { name: "Alice Updated" });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({
      id: "1",
      name: "Alice Updated",
      profile: {},
    });
  });

  test("callback fires on remove", () => {
    const store = createProfileStore();
    store.users.add({ id: "1", name: "Alice", profile: {} });

    const callback = vi.fn();
    store.query(({ users }) => users.get("1"), callback);

    callback.mockClear();

    store.users.remove("1");

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(undefined);
  });

  test("unsubscribe stops callback execution", () => {
    const store = createProfileStore();

    const callback = vi.fn();
    const unsubscribe = store.query(({ users }) => users.list(), callback);

    callback.mockClear();
    unsubscribe();

    // This should NOT trigger the callback
    store.users.add({ id: "1", name: "Alice", profile: {} });

    expect(callback).not.toHaveBeenCalled();
  });

  test("callback does NOT fire for untracked collections", () => {
    const store = createMultiCollectionStore();

    const callback = vi.fn();
    // Only query users, not notes
    store.query(({ users }) => users.list(), callback);

    callback.mockClear();

    // Change notes - should NOT trigger callback
    store.notes.add({ id: "1", content: "Hello" });

    expect(callback).not.toHaveBeenCalled();

    // Change users - should trigger callback
    store.users.add({ id: "1", name: "Alice", profile: {} });

    expect(callback).toHaveBeenCalledTimes(1);
  });

  test("multi-collection queries track all accessed collections", () => {
    const store = createMultiCollectionStore();

    const callback = vi.fn();
    store.query(
      ({ users, notes }) => ({
        userCount: users.list().length,
        noteCount: notes.list().length,
      }),
      callback,
    );

    callback.mockClear();

    // Change users - should trigger
    store.users.add({ id: "1", name: "Alice", profile: {} });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenLastCalledWith({ userCount: 1, noteCount: 0 });

    callback.mockClear();

    // Change notes - should also trigger
    store.notes.add({ id: "1", content: "Hello" });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenLastCalledWith({ userCount: 1, noteCount: 1 });
  });

  test("conditional access tracks only accessed collections", () => {
    const store = createMultiCollectionStore();
    let useUsers = true;

    const callback = vi.fn();
    // Note: Must use handles.collection syntax (not destructuring) for conditional tracking
    // because destructuring accesses all properties regardless of which branch executes
    store.query((handles) => {
      if (useUsers) {
        return { type: "users" as const, data: handles.users.list() };
      } else {
        return { type: "notes" as const, data: handles.notes.list() };
      }
    }, callback);

    callback.mockClear();

    // Initially tracking users only
    // Change to notes - should NOT trigger (not tracked yet)
    store.notes.add({ id: "1", content: "Hello" });
    expect(callback).not.toHaveBeenCalled();

    // Change to users - should trigger
    store.users.add({ id: "1", name: "Alice", profile: {} });
    expect(callback).toHaveBeenCalledTimes(1);

    callback.mockClear();

    // Now switch to notes branch
    useUsers = false;
    // Trigger re-evaluation by changing users (still tracked from last run)
    store.users.add({ id: "2", name: "Bob", profile: {} });
    expect(callback).toHaveBeenCalledTimes(1);

    callback.mockClear();

    // Now notes should be tracked, users should not
    // Change notes - should trigger
    store.notes.add({ id: "2", content: "World" });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  test("query with get returns single document", () => {
    const store = createProfileStore();
    store.users.add({ id: "1", name: "Alice", profile: { age: 30 } });

    const callback = vi.fn();
    store.query(({ users }) => users.get("1"), callback);

    expect(callback).toHaveBeenCalledWith({
      id: "1",
      name: "Alice",
      profile: { age: 30 },
    });
  });

  test("query with computed value", () => {
    const store = createProfileStore();
    store.users.add({ id: "1", name: "Alice", profile: { age: 30 } });
    store.users.add({ id: "2", name: "Bob", profile: { age: 25 } });

    const callback = vi.fn();
    store.query(({ users }) => {
      const allUsers = users.list();
      return allUsers.reduce((sum, u) => sum + (u.profile?.age ?? 0), 0);
    }, callback);

    expect(callback).toHaveBeenCalledWith(55);

    callback.mockClear();

    store.users.add({ id: "3", name: "Charlie", profile: { age: 35 } });
    expect(callback).toHaveBeenCalledWith(90);
  });

  test("query works with batch changes", () => {
    const store = createProfileStore();

    const callback = vi.fn();
    store.query(({ users }) => users.list().length, callback);

    callback.mockClear();

    store.batch(({ users }) => {
      users.add({ id: "1", name: "Alice", profile: {} });
      users.add({ id: "2", name: "Bob", profile: {} });
    });

    // Batch notifies once for all changes
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(2);
  });

  test("multiple queries can coexist", () => {
    const store = createProfileStore();

    const callback1 = vi.fn();
    const callback2 = vi.fn();

    store.query(({ users }) => users.list().length, callback1);
    store.query(({ users }) => users.list().map((u) => u.name), callback2);

    callback1.mockClear();
    callback2.mockClear();

    store.users.add({ id: "1", name: "Alice", profile: {} });

    expect(callback1).toHaveBeenCalledWith(1);
    expect(callback2).toHaveBeenCalledWith(["Alice"]);
  });

  test("unsubscribing one query does not affect others", () => {
    const store = createProfileStore();

    const callback1 = vi.fn();
    const callback2 = vi.fn();

    const unsub1 = store.query(({ users }) => users.list().length, callback1);
    store.query(({ users }) => users.list().length, callback2);

    callback1.mockClear();
    callback2.mockClear();

    unsub1();

    store.users.add({ id: "1", name: "Alice", profile: {} });

    expect(callback1).not.toHaveBeenCalled();
    expect(callback2).toHaveBeenCalledWith(1);
  });

  test("throws error for non-existent collection", () => {
    const store = createProfileStore();

    expect(() => {
      store.query((handles) => {
        // @ts-expect-error - intentionally accessing non-existent collection
        return (handles as any).nonexistent.list();
      }, vi.fn());
    }).toThrow('Collection "nonexistent" not found');
  });

  test("empty query returns empty results", () => {
    const store = createProfileStore();

    const callback = vi.fn();
    store.query(({ users }) => users.list(), callback);

    expect(callback).toHaveBeenCalledWith([]);
  });

  test("query reads fresh data on each invocation", () => {
    const store = createProfileStore();

    const results: number[] = [];
    store.query(
      ({ users }) => users.list().length,
      (count) => results.push(count),
    );

    store.users.add({ id: "1", name: "Alice", profile: {} });
    store.users.add({ id: "2", name: "Bob", profile: {} });
    store.users.remove("1");

    expect(results).toEqual([0, 1, 2, 1]);
  });
});
