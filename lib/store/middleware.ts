import type { StoreConfig } from "./schema";
import type { StoreChangeEvent, StoreSnapshot } from "./store";

export type MiddlewareContext<T extends StoreConfig> = {
  subscribe: (listener: (event: StoreChangeEvent<T>) => void) => () => void;
  getSnapshot: () => StoreSnapshot;
  setSnapshot: (snapshot: StoreSnapshot, options?: { silent?: boolean }) => void;
};

export type StoreMiddleware<T extends StoreConfig> = (
  context: MiddlewareContext<T>,
) => (() => void | Promise<void>) | void | Promise<void>;

export type MiddlewareManager<T extends StoreConfig> = {
  use: (middleware: StoreMiddleware<T>) => void;
  init: (
    onChange: (listener: (event: StoreChangeEvent<T>) => void) => () => void,
    getSnapshot: () => StoreSnapshot,
    setSnapshot: (snapshot: StoreSnapshot, options?: { silent?: boolean }) => void,
  ) => Promise<void>;
  dispose: () => Promise<void>;
};

export function createMiddlewareManager<T extends StoreConfig>(): MiddlewareManager<T> {
  const middlewares: StoreMiddleware<T>[] = [];
  const unsubscribeFns: (() => void)[] = [];
  const cleanupFns: (() => void | Promise<void>)[] = [];
  let isInitialized = false;

  function use(middleware: StoreMiddleware<T>): void {
    if (isInitialized) {
      throw new Error("Cannot add middleware after initialization");
    }
    middlewares.push(middleware);
  }

  async function init(
    onChange: (listener: (event: StoreChangeEvent<T>) => void) => () => void,
    getSnapshot: () => StoreSnapshot,
    setSnapshot: (snapshot: StoreSnapshot, options?: { silent?: boolean }) => void,
  ): Promise<void> {
    if (isInitialized) {
      throw new Error("Middleware already initialized");
    }

    const subscribe = (listener: (event: StoreChangeEvent<T>) => void) => {
      const unsubscribe = onChange(listener);
      unsubscribeFns.push(unsubscribe);
      return unsubscribe;
    };

    const context: MiddlewareContext<T> = {
      subscribe,
      getSnapshot,
      setSnapshot,
    };

    for (const middleware of middlewares) {
      const cleanup = await middleware(context);
      if (cleanup) {
        cleanupFns.push(cleanup);
      }
    }

    isInitialized = true;
  }

  async function dispose(): Promise<void> {
    const reversed = [...cleanupFns].reverse();
    for (const cleanup of reversed) {
      await cleanup();
    }

    cleanupFns.length = 0;
    unsubscribeFns.forEach((fn) => fn());
    unsubscribeFns.length = 0;

    isInitialized = false;
  }

  return { use, init, dispose };
}
