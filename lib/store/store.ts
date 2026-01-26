import { advanceClock, makeStamp, type Collection, type StoreState } from "../core";
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
import {
  applyStateSnapshot,
  hasRelevantChange,
  validateCollectionNames,
} from "./store-utils";

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

  const getNextStamp = () => {
    state.clock = advanceClock(state.clock, { ms: Date.now(), seq: 0 });
    return makeStamp(state.clock.ms, state.clock.seq);
  };

  const middlewareContext: MiddlewareContext<T> = {
    subscribe: (listener) => emitter.subscribe(listener),
    notify: (event) => emitter.emit(event),
    getState: () => ({ ...state }),
    setState: (snapshot) => applyStateSnapshot(state, snapshot),
  };

  const collectionHandles = {} as {
    [N in CollectionName<T>]: Handle<Output<T[N]["schema"]>>;
  };

  for (const collectionName of Object.keys(config.collections) as CollectionName<T>[]) {
    state.collections[collectionName] = {};
    const collectionConfig = config.collections[collectionName];
    if (!collectionConfig) {
      throw new Error(`Collection config not found for "${collectionName}"`);
    }
    collectionHandles[collectionName] = createHandle({
      getCollection: () =>
        state.collections[collectionName] as Collection<Output<T[typeof collectionName]["schema"]>>,
      getTombstones: () => state.tombstones,
      getTimestamp: getNextStamp,
      validate: (data: unknown) =>
        validate(collectionConfig.schema, data as Record<string, unknown>),
      getId: (data: Output<T[typeof collectionName]["schema"]>) =>
        data[collectionConfig.keyPath] as string,
      onMutate: () => emitter.emit({ [collectionName]: true } as StoreChangeEvent<T>),
    });
  }

  const api: StoreAPI<T> = {
    ...collectionHandles,
    subscribe(collections, callback) {
      validateCollectionNames(collections, config.collections);

      const unsubscribe = emitter.subscribe((event) => {
        if (hasRelevantChange(event, collections)) {
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
      await middlewareManager.runInit(middlewareContext);
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
