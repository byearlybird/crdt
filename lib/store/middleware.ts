import type { StoreConfig } from "./schema";
import type { StoreChangeEvent, StoreState } from "./store";

export type MiddlewareContext<T extends StoreConfig> = {
  subscribe: (listener: (event: StoreChangeEvent<T>) => void) => () => void;
  notify: (event: StoreChangeEvent<T>) => void;
  getState: () => StoreState;
  setState: (snapshot: StoreState) => void;
};

export type StoreMiddleware<T extends StoreConfig> = (
  context: MiddlewareContext<T>,
) =>
  | (() => void | Promise<void>)
  | void
  | Promise<void>
  | Promise<() => void | Promise<void>>;

export type MiddlewareManager<T extends StoreConfig> = {
  use: (middleware: StoreMiddleware<T>) => void;
  runInit: (context: MiddlewareContext<T>) => Promise<void>;
  runDispose: () => Promise<void>;
};

export function createMiddlewareManager<T extends StoreConfig>(): MiddlewareManager<T> {
  const middlewares: StoreMiddleware<T>[] = [];
  const cleanupFns: (() => void | Promise<void>)[] = [];

  return {
    use: (middleware) => {
      middlewares.push(middleware);
    },
    runInit: async (context) => {
      for (const middleware of middlewares) {
        const cleanup = await middleware(context);
        if (cleanup) {
          cleanupFns.push(cleanup);
        }
      }
    },
    runDispose: async () => {
      for (const cleanup of [...cleanupFns].reverse()) {
        await cleanup();
      }
      cleanupFns.length = 0;
    },
  };
}
