import {
  advanceClock,
  makeStamp,
  mergeTombstones,
  type Collection,
  type StoreState,
} from "../core";
import { createEmitter } from "../emitter";
import { createHandle, type Handle } from "../store-two/collection-handle";
import type { CollectionName, Output, StoreConfig } from "./schema";
import { validate } from "./schema";
import {
  createMiddlewareManager,
  type MiddlewareContext,
  type StoreMiddleware,
} from "./middleware";
import type { StoreChangeEvent } from "./types";
import { createChangeEvent } from "./events";

export type StoreAPI<T extends StoreConfig> = {
  subscribe<K extends (keyof T & string)[]>(
    collections: [...K],
    callback: (event: StoreChangeEvent<T>) => void,
  ): () => void;
  use(middleware: StoreMiddleware<T>): StoreAPI<T>;
  init(): Promise<void>;
  dispose(): Promise<void>;
} & {
  [N in CollectionName<T>]: Handle<Output<T[N]["schema"]>>;
};

export function createStore<T extends StoreConfig>(config: { collections: T }): StoreAPI<T> {
  let isInitialized = false;

  const emitter = createEmitter<StoreChangeEvent<T>>();
  const middlewareManager = createMiddlewareManager<T>();

  const state: StoreState = {
    clock: { ms: Date.now(), seq: 0 },
    tombstones: {},
    collections: {},
  };

  const collectionNames = Object.keys(config.collections) as CollectionName<T>[];

  for (const name of Object.keys(config.collections)) {
    state.collections[name] = {};
  }

  const tick = () => {
    state.clock = advanceClock(state.clock, { ms: Date.now(), seq: 0 });
    return makeStamp(state.clock.ms, state.clock.seq);
  };

  const getMiddlewareContext = (): MiddlewareContext<T> => ({
    subscribe: (listener) => {
      return emitter.subscribe(listener);
    },
    notify: (event) => {
      emitter.emit(event);
    },
    getState: () => ({ ...state }),
    setState: (snapshot) => {
      state.clock = advanceClock(state.clock, snapshot.clock);
      state.tombstones = mergeTombstones(state.tombstones, snapshot.tombstones);

      // Replace collections from snapshot (filtered by tombstones)
      for (const [name, collectionData] of Object.entries(snapshot.collections)) {
        const filtered: typeof collectionData = {};
        for (const [id, doc] of Object.entries(collectionData)) {
          if (!state.tombstones[id]) {
            filtered[id] = doc;
          }
        }
        state.collections[name] = filtered;
      }
    },
  });

  // Create handles for each collection
  const collectionHandles = {} as {
    [N in CollectionName<T>]: Handle<Output<T[N]["schema"]>>;
  };

  for (const collectionName of collectionNames) {
    const collectionConfig = config.collections[collectionName];
    if (!collectionConfig) {
      throw new Error(`Collection config for "${collectionName}" not found`);
    }
    const cfg = collectionConfig; // Capture for closure

    collectionHandles[collectionName] = createHandle({
      getCollection: () =>
        state.collections[collectionName] as Collection<Output<T[typeof collectionName]["schema"]>>,
      getTombstones: () => state.tombstones,
      getTimestamp: tick,
      validate: (data) => validate(cfg.schema, data as Record<string, unknown>),
      getId: (data) => data[cfg.keyPath] as string,
      onMutate: () => emitter.emit(createChangeEvent<T>(collectionName)),
    });
  }

  const api: StoreAPI<T> = {
    ...collectionHandles,
    subscribe(collections, callback) {
      // Validate all collections exist
      for (const collectionName of collections) {
        if (!(collectionName in config.collections)) {
          throw new Error(`Collection "${collectionName}" not found`);
        }
      }

      const unsubscribe = emitter.subscribe((event) => {
        // Check if any of the subscribed collections changed
        const hasRelevantChange = collections.some((name) => event[name as keyof T]);
        if (hasRelevantChange) {
          callback(event);
        }
      });

      return unsubscribe;
    },
    use(middleware) {
      if (isInitialized) {
        throw new Error("Cannot add middleware after initialization");
      }
      middlewareManager.use(middleware);
      return this;
    },
    async init() {
      if (isInitialized) {
        throw new Error("Store already initialized");
      }

      await middlewareManager.runInit(getMiddlewareContext());

      isInitialized = true;
    },
    async dispose() {
      if (!isInitialized) {
        throw new Error("Store not initialized");
      }

      await middlewareManager.runDispose();
      isInitialized = false;
    },
  };

  return api;
}
