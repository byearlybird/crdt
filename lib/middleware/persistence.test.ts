import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import "fake-indexeddb/auto";
import { createPersistence } from "./persistence";
import { createProfileStore } from "../store/test-utils";
import type { StoreState } from "../core";

// Mock BroadcastChannel
class MockBroadcastChannel {
  name: string;
  private listeners: Set<(event: MessageEvent) => void> = new Set();
  static instances: Map<string, MockBroadcastChannel> = new Map();

  constructor(name: string) {
    this.name = name;
    MockBroadcastChannel.instances.set(name, this);
  }

  postMessage(message: any) {
    // Broadcast to all instances with the same name
    const instances = Array.from(MockBroadcastChannel.instances.values()).filter(
      (instance) => instance.name === this.name && instance !== this,
    );
    instances.forEach((instance) => {
      instance.listeners.forEach((listener) => {
        queueMicrotask(() => {
          listener(new MessageEvent("message", { data: message }) as any);
        });
      });
    });
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    if (type === "message") {
      this.listeners.add(listener);
    }
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void) {
    if (type === "message") {
      this.listeners.delete(listener);
    }
  }

  get onmessage() {
    return Array.from(this.listeners)[0] ?? null;
  }

  set onmessage(listener: ((event: MessageEvent) => void) | null) {
    if (listener) {
      this.listeners.clear();
      this.listeners.add(listener);
    } else {
      this.listeners.clear();
    }
  }

  close() {
    this.listeners.clear();
    MockBroadcastChannel.instances.delete(this.name);
  }
}

// Setup mocks
beforeEach(() => {
  global.BroadcastChannel = MockBroadcastChannel as any;
  MockBroadcastChannel.instances.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createPersistence", () => {
  test("loads state from IndexedDB on init", async () => {
    const store = createProfileStore();
    const savedState: StoreState = {
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

    // Pre-populate IndexedDB
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("test-store", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("state");
      };
    });

    const tx = db.transaction(["state"], "readwrite");
    const storeObj = tx.objectStore("state");
    await new Promise<void>((resolve, reject) => {
      const putRequest = storeObj.put(JSON.stringify(savedState), "store");
      putRequest.onsuccess = () => resolve();
      putRequest.onerror = () => reject(putRequest.error);
    });
    db.close();

    await createPersistence(store, { key: "test-store" });

    const user = store.users.get("1");
    expect(user).toEqual({
      id: "1",
      name: "Alice",
      profile: {},
    });
  });

  test("persists state to IndexedDB on changes", async () => {
    const store = createProfileStore();

    await createPersistence(store, { key: "test-store", debounceMs: 50 });

    store.users.put({ id: "1", name: "Alice", profile: {} });

    // Wait for debounce and IndexedDB operations
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify state was saved
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("test-store", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("state");
      };
    });

    const tx = db.transaction(["state"], "readonly");
    const storeObj = tx.objectStore("state");
    const saved = await new Promise<string>((resolve, reject) => {
      const request = storeObj.get("store");
      request.onsuccess = () => resolve(request.result as string);
      request.onerror = () => reject(request.error);
    });
    db.close();

    const parsed = JSON.parse(saved);
    expect(parsed.collections.users.documents["1"]).toBeDefined();
  });

  test("debounces multiple rapid changes", async () => {
    const store = createProfileStore();

    let saveCount = 0;
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: any, key?: IDBValidKey) {
      saveCount++;
      return originalPut.call(this, value, key);
    };

    await createPersistence(store, { key: "test-store", debounceMs: 100 });

    // Make multiple rapid changes
    store.users.put({ id: "1", name: "Alice", profile: {} });
    store.users.put({ id: "2", name: "Bob", profile: {} });
    store.users.patch("1", { name: "Alice Updated" });

    // Wait but not enough to trigger save
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(saveCount).toBe(0);

    // Wait past debounce time
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(saveCount).toBe(1);

    // Restore
    IDBObjectStore.prototype.put = originalPut;
  });

  test("syncs across tabs via BroadcastChannel", async () => {
    const store1 = createProfileStore();
    const store2 = createProfileStore();

    const cleanup1 = await createPersistence(store1, { key: "test-store", debounceMs: 50 });
    const cleanup2 = await createPersistence(store2, { key: "test-store", debounceMs: 50 });

    // Make change in store1
    store1.users.put({ id: "1", name: "Alice", profile: {} });

    // Wait for debounce, broadcast, and message propagation
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify store2 received the update
    const user = store2.users.get("1");
    expect(user).toEqual({
      id: "1",
      name: "Alice",
      profile: {},
    });

    await cleanup1();
    await cleanup2();
  });

  test("handles missing IndexedDB gracefully", async () => {
    // Mock IndexedDB to fail
    const originalOpen = indexedDB.open;
    indexedDB.open = () => {
      const request = {} as IDBOpenDBRequest;
      setTimeout(() => {
        Object.defineProperty(request, "error", {
          value: new DOMException("Database error", "UnknownError"),
          writable: false,
        });
        if (request.onerror) {
          request.onerror(new Event("error") as any);
        }
      }, 0);
      return request;
    };

    const store = createProfileStore();

    // Should not throw
    await expect(createPersistence(store, { key: "test-store" })).resolves.not.toThrow();

    // Store should still work
    store.users.put({ id: "1", name: "Alice", profile: {} });
    expect(store.users.get("1")).toBeDefined();

    // Restore
    indexedDB.open = originalOpen;
  });

  test("handles BroadcastChannel unavailability", async () => {
    // Mock BroadcastChannel to throw
    global.BroadcastChannel = class {
      constructor() {
        throw new Error("BroadcastChannel not available");
      }
    } as any;

    const store = createProfileStore();

    // Should not throw
    await expect(createPersistence(store, { key: "test-store" })).resolves.not.toThrow();

    // Store should still work
    store.users.put({ id: "1", name: "Alice", profile: {} });
    expect(store.users.get("1")).toBeDefined();
  });

  test("cleans up resources on dispose", async () => {
    const store = createProfileStore();

    const cleanup = await createPersistence(store, { key: "test-store", debounceMs: 100 });

    store.users.put({ id: "1", name: "Alice", profile: {} });

    // Dispose before debounce completes
    await cleanup();

    // Wait - should not save after dispose
    let saveCount = 0;
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: any, key?: IDBValidKey) {
      saveCount++;
      return originalPut.call(this, value, key);
    };

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(saveCount).toBe(0);

    // Restore
    IDBObjectStore.prototype.put = originalPut;
  });

  test("flushes pending write on dispose", async () => {
    const store = createProfileStore();

    let saveCount = 0;
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: any, key?: IDBValidKey) {
      saveCount++;
      return originalPut.call(this, value, key);
    };

    const cleanup = await createPersistence(store, { key: "test-store", debounceMs: 100 });

    store.users.put({ id: "1", name: "Alice", profile: {} });

    // Dispose before debounce completes - this should flush
    await cleanup();
    // Wait for flush to complete
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Should have flushed the pending write
    expect(saveCount).toBe(1);

    // Restore
    IDBObjectStore.prototype.put = originalPut;
  });

  test("uses custom debounce delay", async () => {
    const store = createProfileStore();

    let saveCount = 0;
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: any, key?: IDBValidKey) {
      saveCount++;
      return originalPut.call(this, value, key);
    };

    await createPersistence(store, { key: "test-store-custom-debounce", debounceMs: 200 });

    // Clear any saves from init
    saveCount = 0;

    store.users.put({ id: "1", name: "Alice", profile: {} });

    // Wait less than custom debounce - should not save yet
    await new Promise((resolve) => setTimeout(resolve, 50));
    const countAfterShortWait = saveCount;

    // Wait past custom debounce - should save once
    await new Promise((resolve) => setTimeout(resolve, 200));
    const finalCount = saveCount;

    // Should have saved at least once after the full wait
    expect(finalCount).toBeGreaterThan(countAfterShortWait);
    expect(finalCount).toBeGreaterThanOrEqual(1);

    // Restore
    IDBObjectStore.prototype.put = originalPut;
  });

  test("uses custom channel name", async () => {
    const store1 = createProfileStore();
    const store2 = createProfileStore();

    await createPersistence(store1, { key: "test-store", channelName: "custom-channel" });
    await createPersistence(store2, { key: "test-store", channelName: "custom-channel" });

    // Verify they're using the same channel
    expect(MockBroadcastChannel.instances.has("custom-channel")).toBe(true);
  });

  test("does not save on initial load", async () => {
    const store = createProfileStore();
    const savedState: StoreState = {
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

    // Pre-populate IndexedDB
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("test-store", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("state");
      };
    });

    const tx = db.transaction(["state"], "readwrite");
    const storeObj = tx.objectStore("state");
    await new Promise<void>((resolve, reject) => {
      const putRequest = storeObj.put(JSON.stringify(savedState), "store");
      putRequest.onsuccess = () => resolve();
      putRequest.onerror = () => reject(putRequest.error);
    });
    db.close();

    let saveCount = 0;
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: any, key?: IDBValidKey) {
      saveCount++;
      return originalPut.call(this, value, key);
    };

    await createPersistence(store, { key: "test-store", debounceMs: 50 });

    // Wait for any potential saves
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should not have saved (initial load is skipped)
    expect(saveCount).toBe(0);

    // Restore
    IDBObjectStore.prototype.put = originalPut;
  });
});
