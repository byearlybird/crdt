import { describe, expect, test } from "vitest";
import { createMiddlewareManager, type MiddlewareContext } from "./middleware";

// Mock context for testing
const mockContext: MiddlewareContext<any> = {
  subscribe: () => () => {},
  notify: () => {},
  getState: () => ({ clock: { ms: 0, seq: 0 }, collections: {}, tombstones: {} }),
  setState: () => {},
};

describe("createMiddlewareManager", () => {
  test("use() registers middleware and runInit() executes it", async () => {
    const manager = createMiddlewareManager();
    const calls: string[] = [];

    manager.use(() => {
      calls.push("init");
    });
    await manager.runInit(mockContext);

    expect(calls).toEqual(["init"]);
  });

  test("runInit() collects cleanup functions", async () => {
    const manager = createMiddlewareManager();
    const calls: string[] = [];

    manager.use(() => {
      calls.push("init");
      return () => {
        calls.push("cleanup");
      };
    });

    await manager.runInit(mockContext);
    await manager.runDispose();

    expect(calls).toEqual(["init", "cleanup"]);
  });

  test("middleware runs in registration order", async () => {
    const manager = createMiddlewareManager();
    const order: number[] = [];

    manager.use(() => {
      order.push(1);
    });
    manager.use(() => {
      order.push(2);
    });
    manager.use(() => {
      order.push(3);
    });

    await manager.runInit(mockContext);

    expect(order).toEqual([1, 2, 3]);
  });

  test("cleanup runs in reverse order", async () => {
    const manager = createMiddlewareManager();
    const order: number[] = [];

    manager.use(() => () => {
      order.push(1);
    });
    manager.use(() => () => {
      order.push(2);
    });
    manager.use(() => () => {
      order.push(3);
    });

    await manager.runInit(mockContext);
    await manager.runDispose();

    expect(order).toEqual([3, 2, 1]);
  });

  test("supports async middleware", async () => {
    const manager = createMiddlewareManager();
    const calls: string[] = [];

    manager.use(async () => {
      await Promise.resolve();
      calls.push("async");
    });

    await manager.runInit(mockContext);

    expect(calls).toEqual(["async"]);
  });

  test("supports async cleanup", async () => {
    const manager = createMiddlewareManager();
    const calls: string[] = [];

    manager.use(() => {
      return async () => {
        await Promise.resolve();
        calls.push("async-cleanup");
      };
    });

    await manager.runInit(mockContext);
    await manager.runDispose();

    expect(calls).toEqual(["async-cleanup"]);
  });

  test("runDispose() clears cleanup functions", async () => {
    const manager = createMiddlewareManager();
    let cleanupCount = 0;

    manager.use(() => () => {
      cleanupCount++;
    });

    await manager.runInit(mockContext);
    await manager.runDispose();
    await manager.runDispose(); // Second call shouldn't run cleanups again

    expect(cleanupCount).toBe(1);
  });
});
