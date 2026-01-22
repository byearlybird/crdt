import type { StoreConfig } from "./schema";
import type { StoreChangeEvent, StoreState } from "./store";

export type MiddlewareContext<T extends StoreConfig> = {
  subscribe: (listener: (event: StoreChangeEvent<T>) => void) => () => void;
  getState: () => StoreState;
  setState: (snapshot: StoreState, options?: { silent?: boolean }) => void;
};

export type StoreMiddleware<T extends StoreConfig> = (
  context: MiddlewareContext<T>,
) => (() => void | Promise<void>) | void | Promise<void>;

export type MiddlewareDependencies<T extends StoreConfig> = {
  listen: (listener: (event: StoreChangeEvent<T>) => void) => () => void;
  getState: () => StoreState;
  setState: (snapshot: StoreState, options?: { silent?: boolean }) => void;
};

export type MiddlewareManager<T extends StoreConfig> = {
  use: (middleware: StoreMiddleware<T>) => void;
  runInit: (deps: MiddlewareDependencies<T>) => Promise<void>;
  runDispose: () => Promise<void>;
};

export function createMiddlewareManager<T extends StoreConfig>(): MiddlewareManager<T> {
  const middlewares: StoreMiddleware<T>[] = [];
  const unsubscribeFns: (() => void)[] = [];
  const cleanupFns: (() => void | Promise<void>)[] = [];

  function use(middleware: StoreMiddleware<T>): void {
    middlewares.push(middleware);
  }

  async function runInit(deps: MiddlewareDependencies<T>): Promise<void> {
    const subscribe = (listener: (event: StoreChangeEvent<T>) => void) => {
      const unsubscribe = deps.listen(listener);
      unsubscribeFns.push(unsubscribe);
      return unsubscribe;
    };

    const context: MiddlewareContext<T> = {
      subscribe,
      getState: deps.getState,
      setState: deps.setState,
    };

    for (const middleware of middlewares) {
      const cleanup = await middleware(context);
      if (cleanup) {
        cleanupFns.push(cleanup);
      }
    }
  }

  async function runDispose(): Promise<void> {
    const reversed = [...cleanupFns].reverse();
    for (const cleanup of reversed) {
      await cleanup();
    }

    cleanupFns.length = 0;
    unsubscribeFns.forEach((fn) => fn());
    unsubscribeFns.length = 0;
  }

  return { use, runInit, runDispose };
}
