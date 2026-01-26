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
  createChangeEvent,
  ensureInitialized,
  ensureNotInitialized,
  getCollectionConfig,
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

  function createMiddlewareContext(): MiddlewareContext<T> {
    return {
      subscribe: (listener) => emitter.subscribe(listener),
      notify: (event) => emitter.emit(event),
      getState: () => ({ ...state }),
      setState: (snapshot) => applyStateSnapshot(state, snapshot),
    };
  }

  const middlewareContext = createMiddlewareContext();

  function createHandleOptions<N extends CollectionName<T>>(
    collectionName: N,
    collectionConfig: T[N],
  ) {
    return {
      getCollection: () =>
        state.collections[collectionName] as Collection<Output<T[typeof collectionName]["schema"]>>,
      getTombstones: () => state.tombstones,
      getTimestamp: getNextStamp,
      validate: (data: unknown) =>
        validate(collectionConfig.schema, data as Record<string, unknown>),
      getId: (data: Output<T[N]["schema"]>) => data[collectionConfig.keyPath] as string,
      onMutate: () => emitter.emit(createChangeEvent(collectionName)),
    };
  }

  function createCollectionHandles(): {
    [N in CollectionName<T>]: Handle<Output<T[N]["schema"]>>;
  } {
    const handles = {} as {
      [N in CollectionName<T>]: Handle<Output<T[N]["schema"]>>;
    };

    for (const collectionName of Object.keys(config.collections) as CollectionName<T>[]) {
      state.collections[collectionName] = {};
      const collectionConfig = getCollectionConfig(config.collections, collectionName);
      handles[collectionName] = createHandle(createHandleOptions(collectionName, collectionConfig));
    }

    return handles;
  }

  const collectionHandles = createCollectionHandles();

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
      ensureNotInitialized(isInitialized, "Cannot add middleware after initialization");
      middlewareManager.use(middleware);
      return this;
    },
    async init() {
      ensureNotInitialized(isInitialized, "Store already initialized");
      await middlewareManager.runInit(middlewareContext);
      isInitialized = true;
    },
    async dispose() {
      ensureInitialized(isInitialized, "Store not initialized");
      await middlewareManager.runDispose();
      isInitialized = false;
    },
  };

  return api;
}
