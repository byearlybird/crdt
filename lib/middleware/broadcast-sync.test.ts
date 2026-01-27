import { describe, test, expect, beforeEach, vi } from "vitest";
import { BroadcastSync } from "./broadcast-sync";
import type { StoreState } from "../core";

// Mock BroadcastChannel
class MockBroadcastChannel {
  name: string;
  private listeners: Set<(event: MessageEvent) => void> = new Set();
  static instances: Map<string, MockBroadcastChannel[]> = new Map();

  constructor(name: string) {
    this.name = name;
    const existing = MockBroadcastChannel.instances.get(name) ?? [];
    existing.push(this);
    MockBroadcastChannel.instances.set(name, existing);
  }

  postMessage(message: unknown) {
    // Broadcast to all OTHER instances with the same name
    const instances = MockBroadcastChannel.instances.get(this.name) ?? [];
    instances
      .filter((instance) => instance !== this)
      .forEach((instance) => {
        instance.listeners.forEach((listener) => {
          queueMicrotask(() => {
            listener(new MessageEvent("message", { data: message }));
          });
        });
      });
  }

  get onmessage() {
    return Array.from(this.listeners)[0] ?? null;
  }

  set onmessage(listener: ((event: MessageEvent) => void) | null) {
    this.listeners.clear();
    if (listener) {
      this.listeners.add(listener);
    }
  }

  close() {
    this.listeners.clear();
    const instances = MockBroadcastChannel.instances.get(this.name) ?? [];
    const index = instances.indexOf(this);
    if (index > -1) {
      instances.splice(index, 1);
    }
  }
}

beforeEach(() => {
  global.BroadcastChannel = MockBroadcastChannel as unknown as typeof BroadcastChannel;
  MockBroadcastChannel.instances.clear();
});

describe("BroadcastSync", () => {
  test("available is true when BroadcastChannel works", () => {
    const sync = new BroadcastSync({
      channelName: "test",
      onMessage: () => {},
    });

    expect(sync.available).toBe(true);
    sync.close();
  });

  test("available is false when BroadcastChannel throws", () => {
    global.BroadcastChannel = class {
      constructor() {
        throw new Error("Not supported");
      }
    } as unknown as typeof BroadcastChannel;

    const sync = new BroadcastSync({
      channelName: "test",
      onMessage: () => {},
    });

    expect(sync.available).toBe(false);
  });

  test("broadcasts state to other instances", async () => {
    const received: StoreState[] = [];

    const sync1 = new BroadcastSync({
      channelName: "test-channel",
      onMessage: () => {},
    });

    const sync2 = new BroadcastSync({
      channelName: "test-channel",
      onMessage: (state) => received.push(state),
    });

    const state: StoreState = {
      clock: { ms: 1000, seq: 0 },
      collections: {},
    };

    sync1.broadcast(state);

    // Wait for async message delivery
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(state);

    sync1.close();
    sync2.close();
  });

  test("does not receive own broadcasts", async () => {
    const received: StoreState[] = [];

    const sync = new BroadcastSync({
      channelName: "test-channel",
      onMessage: (state) => received.push(state),
    });

    const state: StoreState = {
      clock: { ms: 1000, seq: 0 },
      collections: {},
    };

    sync.broadcast(state);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(received).toHaveLength(0);

    sync.close();
  });

  test("ignores malformed messages", async () => {
    const received: StoreState[] = [];

    const sync1 = new BroadcastSync({
      channelName: "test-channel",
      onMessage: () => {},
    });

    const sync2 = new BroadcastSync({
      channelName: "test-channel",
      onMessage: (state) => received.push(state),
    });

    // Access the underlying channel to send malformed messages
    const instances = MockBroadcastChannel.instances.get("test-channel") ?? [];
    const channel = instances[0]!;

    channel.postMessage({ type: "wrong-type" });
    channel.postMessage({ type: "state-update" }); // missing state
    channel.postMessage(null);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(received).toHaveLength(0);

    sync1.close();
    sync2.close();
  });

  test("close stops receiving messages", async () => {
    const received: StoreState[] = [];

    const sync1 = new BroadcastSync({
      channelName: "test-channel",
      onMessage: () => {},
    });

    const sync2 = new BroadcastSync({
      channelName: "test-channel",
      onMessage: (state) => received.push(state),
    });

    sync2.close();

    const state: StoreState = {
      clock: { ms: 1000, seq: 0 },
      collections: {},
    };

    sync1.broadcast(state);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(received).toHaveLength(0);
    expect(sync2.available).toBe(false);

    sync1.close();
  });

  test("broadcast does nothing when unavailable", () => {
    global.BroadcastChannel = class {
      constructor() {
        throw new Error("Not supported");
      }
    } as unknown as typeof BroadcastChannel;

    const sync = new BroadcastSync({
      channelName: "test",
      onMessage: () => {},
    });

    const state: StoreState = {
      clock: { ms: 1000, seq: 0 },
      collections: {},
    };

    // Should not throw
    expect(() => sync.broadcast(state)).not.toThrow();
  });

  test("handles onMessage errors gracefully", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const sync1 = new BroadcastSync({
      channelName: "test-channel",
      onMessage: () => {},
    });

    const sync2 = new BroadcastSync({
      channelName: "test-channel",
      onMessage: () => {
        throw new Error("Handler error");
      },
    });

    const state: StoreState = {
      clock: { ms: 1000, seq: 0 },
      collections: {},
    };

    sync1.broadcast(state);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(consoleWarn).toHaveBeenCalledWith(
      "[BroadcastSync] Failed to process message:",
      expect.any(Error),
    );

    consoleWarn.mockRestore();
    sync1.close();
    sync2.close();
  });
});
