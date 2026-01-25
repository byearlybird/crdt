import {
  advanceClock,
  makeStamp,
  mergeCollections,
  mergeTombstones,
  type StoreState,
} from "../core";
import type { AnyObject, CollectionConfig, CollectionName, StoreConfig } from "./schema";
import { executeTransact, type TransactDependencies, type TransactHandle } from "./transact";
import { createReadHandles, type ReadHandle, type ReadHandles } from "./read";
import { createWriteHandles, type WriteHandle, type WriteHandles } from "./write";
import {
  createMiddlewareManager,
  type MiddlewareContext,
  type StoreMiddleware,
} from "./middleware";
import { notifyListeners } from "./events";
import type { StoreChangeEvent } from "./types";
import { createBuildCallbacks } from "./callbacks";

export type StoreCollectionHandles<T extends StoreConfig> = {
  [N in CollectionName<T>]: ReadHandle<T[N]> & WriteHandle<T[N]>;
};

export type StoreAPI<T extends StoreConfig> = {
  transact<K extends (keyof T & string)[], R>(
    collections: [...K],
    callback: (handles: { [P in K[number]]: TransactHandle<T[P]> }) => R,
  ): R;
  subscribe<K extends (keyof T & string)[]>(
    collections: [...K],
    callback: (event: StoreChangeEvent<T>) => void,
  ): () => void;
  use(middleware: StoreMiddleware<T>): StoreAPI<T>;
  init(): Promise<void>;
  dispose(): Promise<void>;
} & ReadHandles<T> &
  WriteHandles<T>;

export function createStore<T extends StoreConfig>(config: { collections: T }): StoreAPI<T> {
  let isInitialized = false;

  const configs = new Map<string, CollectionConfig<AnyObject>>();
  const listeners = new Set<(event: StoreChangeEvent<T>) => void>();
  const middlewareManager = createMiddlewareManager<T>();

  const state: StoreState = {
    clock: { ms: Date.now(), seq: 0 },
    tombstones: {},
    collections: {},
  };

  // Store collection names with type information for use in callbacks
  const collectionNames = Object.keys(config.collections) as CollectionName<T>[];

  for (const [name, collectionConfig] of Object.entries(config.collections)) {
    configs.set(name, collectionConfig);
    state.collections[name] = {};
  }

  const getTransactDeps = (): TransactDependencies => ({
    configs,
    documents: state.collections,
    tombstones: state.tombstones,
    tick,
  });

  const getMiddlewareContext = (): MiddlewareContext<T> => ({
    subscribe: (listener) => {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    notify: (event) => {
      notifyListeners(event, listeners);
    },
    getState: () => ({ ...state }),
    setState: (snapshot) => {
      state.clock = advanceClock(state.clock, { ms: snapshot.clock.ms, seq: snapshot.clock.seq });
      state.tombstones = snapshot.tombstones;

      // Replace collections - ensure all collections from snapshot exist
      for (const [name, collectionData] of Object.entries(snapshot.collections)) {
        state.collections[name] = collectionData;
      }
    },
  });

  const readHandles = createReadHandles<T>({ configs, state });

  const tick = () => {
    state.clock = advanceClock(state.clock, { ms: Date.now(), seq: 0 });
    return makeStamp(state.clock.ms, state.clock.seq);
  };

  const buildCallbacks = createBuildCallbacks<T>({ state, listeners });

  const writeHandles = createWriteHandles<T>({
    configs,
    state,
    tick,
    buildCallbacks,
  });

  // Combine read + write handles per collection
  // We can't just spread both because they have the same keys (collection names),
  // which would cause writeHandles to overwrite readHandles.
  // Instead, we need to merge them per collection.
  const collectionHandles = {} as StoreCollectionHandles<T>;
  for (const collectionName of collectionNames) {
    collectionHandles[collectionName] = {
      ...readHandles[collectionName],
      ...writeHandles[collectionName],
    };
  }

  const api: StoreAPI<T> = {
    ...collectionHandles,
    subscribe(collections, callback) {
      // Validate all collections exist
      for (const collectionName of collections) {
        if (!configs.has(collectionName)) {
          throw new Error(`Collection "${collectionName}" not found`);
        }
      }

      const addListener = (listener: (event: StoreChangeEvent<T>) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      };

      const unsubscribe = addListener((event) => {
        // Check if any of the subscribed collections changed
        const hasRelevantChange = collections.some((name) => event[name as keyof T]);
        if (hasRelevantChange) {
          callback(event);
        }
      });

      return unsubscribe;
    },
    transact(collections, callback) {
      const result = executeTransact(collections, callback, getTransactDeps());

      if (result.changes) {
        state.tombstones = mergeTombstones(state.tombstones, result.changes.tombstones);

        for (const collectionName of Object.keys(result.changes.documents)) {
          const current = state.collections[collectionName]!;
          const updated = result.changes.documents[collectionName]!;
          state.collections[collectionName] = mergeCollections(current, updated, state.tombstones);
        }

        notifyListeners(result.changes.event, listeners);
      }

      return result.value;
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
