import type { StoreConfig } from "./schema";
import type { StoreChangeEvent, StoreState } from "./store";

export type MiddlewareContext<T extends StoreConfig> = {
  subscribe: (listener: (event: StoreChangeEvent<T>) => void) => () => void;
  notify: (event: StoreChangeEvent<T>) => void;
  getState: () => StoreState;
  setState: (snapshot: StoreState, options?: { silent?: boolean }) => void;
};

export type StoreMiddleware<T extends StoreConfig> = (
  context: MiddlewareContext<T>,
) => (() => void | Promise<void>) | void | Promise<void>;

export type MiddlewareManager<T extends StoreConfig> = {
  use: (middleware: StoreMiddleware<T>) => void;
  runInit: (context: MiddlewareContext<T>) => Promise<void>;
  runDispose: () => Promise<void>;
};

export function createMiddlewareManager<T extends StoreConfig>(): MiddlewareManager<T> {
  const middlewares: StoreMiddleware<T>[] = [];
  const cleanupFns: (() => void | Promise<void>)[] = [];

  function use(middleware: StoreMiddleware<T>): void {
    middlewares.push(middleware);
  }

  async function runInit(context: MiddlewareContext<T>): Promise<void> {
    // Wrap subscribe to track unsubscribe functions
    const wrappedContext: MiddlewareContext<T> = {
      ...context,
      subscribe: (listener: (event: StoreChangeEvent<T>) => void) => {
        const unsubscribe = context.subscribe(listener);
        cleanupFns.push(unsubscribe);
        return unsubscribe;
      },
    };

    for (const middleware of middlewares) {
      const cleanup = await middleware(wrappedContext);
      if (cleanup) {
        cleanupFns.push(cleanup);
      }
    }
  }

  async function runDispose(): Promise<void> {
    for (const cleanup of [...cleanupFns].reverse()) {
      await cleanup();
    }
    cleanupFns.length = 0;
  }

  return { use, runInit, runDispose };
}
