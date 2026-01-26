import { describe, expect, test, vi } from "vitest";
import { createMultiCollectionStore, createProfileStore } from "./test-utils";

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
    store.users.add({ id: "1", name: "Alice", profile: {} });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({ users: true });
  });

  test("callback fires on update", () => {
    const store = createProfileStore();
    store.users.add({ id: "1", name: "Alice", profile: {} });

    const callback = vi.fn();
    store.subscribe(["users"], callback);

    callback.mockClear();

    store.users.update("1", { name: "Alice Updated" });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({ users: true });
  });

  test("callback fires on remove", () => {
    const store = createProfileStore();
    store.users.add({ id: "1", name: "Alice", profile: {} });

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
    store.users.add({ id: "1", name: "Alice", profile: {} });

    expect(callback).not.toHaveBeenCalled();
  });

  test("callback does NOT fire for unsubscribed collections", () => {
    const store = createMultiCollectionStore();

    const callback = vi.fn();
    // Only subscribe to users, not notes
    store.subscribe(["users"], callback);

    callback.mockClear();

    // Change notes - should NOT trigger callback
    store.notes.add({ id: "1", content: "Hello" });

    expect(callback).not.toHaveBeenCalled();

    // Change users - should trigger callback
    store.users.add({ id: "1", name: "Alice", profile: {} });

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({ users: true });
  });

  test("multi-collection subscriptions track all subscribed collections", () => {
    const store = createMultiCollectionStore();

    const callback = vi.fn();
    store.subscribe(["users", "notes"], callback);

    callback.mockClear();

    // Change users - should trigger
    store.users.add({ id: "1", name: "Alice", profile: {} });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({ users: true });

    callback.mockClear();

    // Change notes - should also trigger
    store.notes.add({ id: "1", content: "Hello" });
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

    store.users.add({ id: "1", name: "Alice", profile: {} });

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

    store.users.add({ id: "1", name: "Alice", profile: {} });

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
    store.users.add({ id: "1", name: "Alice", profile: {} });

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

    store.users.add({ id: "1", name: "Alice", profile: {} });
    store.users.add({ id: "2", name: "Bob", profile: {} });
    store.users.remove("1");

    expect(events).toEqual([{ users: true }, { users: true }, { users: true }]);
  });

  test("global subscribe receives all collection events", () => {
    const store = createMultiCollectionStore();

    const events: any[] = [];
    store.subscribe((event) => events.push(event));

    store.users.add({ id: "1", name: "Alice", profile: {} });
    store.notes.add({ id: "1", content: "Hello" });

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ users: true });
    expect(events[1]).toEqual({ notes: true });
  });

  test("global subscribe returns unsubscribe function", () => {
    const store = createProfileStore();

    const callback = vi.fn();
    const unsubscribe = store.subscribe(callback);

    store.users.add({ id: "1", name: "Alice", profile: {} });
    expect(callback).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.users.add({ id: "2", name: "Bob", profile: {} });
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
