import { mergeCollections, type Collection } from "../core";
import type { Clock } from "../core/clock";
import { advanceClock, makeStamp } from "../core/clock";
import type { AnyObject, CollectionConfig, StoreConfig } from "./schema";
import type { Tombstones } from "../core/tombstone";
import { mergeTombstones } from "../core/tombstone";
import {
  executeTransaction,
  type ReadHandles,
  type MutateHandles,
  type TransactionDependencies,
} from "./transaction";
import { createQuery, QueryManager, type QueryObject } from "./query";

// Re-export transaction types for public API
export type { ReadHandle, MutateHandle, ReadHandles, MutateHandles } from "./transaction";

export type StoreSnapshot = {
  clock: Clock;
  collections: Record<string, Collection>;
  tombstones: Tombstones;
};

export type StoreChangeEvent<T extends StoreConfig> = {
  [K in keyof T]?: true;
};

export type MiddlewareContext<T extends StoreConfig> = {
  subscribe: (listener: (event: StoreChangeEvent<T>) => void) => () => void;
  getSnapshot: () => StoreSnapshot;
  merge: (snapshot: StoreSnapshot, options?: { silent?: boolean }) => void;
};

export type StoreMiddleware<T extends StoreConfig> = (
  context: MiddlewareContext<T>,
) => (() => void | Promise<void>) | void | Promise<void>;

export type StoreAPI<T extends StoreConfig> = {
  // One-off read (returns value directly, no reactivity)
  read<R>(callback: (handles: ReadHandles<T>) => R): R;

  // Reactive subscription (re-executes when dependencies change)
  subscribe<R>(query: (handles: ReadHandles<T>) => R, subscriber: (value: R) => void): () => void;

  // Read-write transaction (full mutations, rollback on error, lazy collection access)
  transact<R>(callback: (handles: MutateHandles<T>) => R): R;

  // Middleware methods
  use(middleware: StoreMiddleware<T>): StoreAPI<T>;
  init(): Promise<void>;
  dispose(): Promise<void>;
};

export function createStore<T extends StoreConfig>(config: {
  collections: T;
}): StoreAPI<T> {
  const state = {
    clock: { ms: Date.now(), seq: 0 } as Clock,
    tombstones: {} as Tombstones,
    collections: {} as Record<string, Collection>,
  };

  const configs = new Map<string, CollectionConfig<AnyObject>>();
  const listeners = new Set<(event: StoreChangeEvent<T>) => void>();
  const queryManager = new QueryManager();

  // Middleware state
  const middlewares: StoreMiddleware<T>[] = [];
  let isInitialized = false;
  const unsubscribeFns: (() => void)[] = [];
  const cleanupFns: (() => void | Promise<void>)[] = [];

  const advance = (ms: number, seq: number): void => {
    state.clock = advanceClock(state.clock, { ms, seq });
  };

  const tick = (): string => {
    advance(Date.now(), 0);
    return makeStamp(state.clock.ms, state.clock.seq);
  };

  // Initialize collections
  for (const [name, collectionConfig] of Object.entries(config.collections)) {
    configs.set(name, collectionConfig);
    state.collections[name] = {};
  }

  const deps: TransactionDependencies<T> = {
    configs,
    documents: state.collections,
    tombstones: state.tombstones,
    tick,
    notifyListeners: (event) => {
      listeners.forEach((listener) => listener(event));

      // Re-execute queries that depend on changed collections
      const changedCollections = new Set<string>();
      for (const key in event) {
        if (event[key]) {
          changedCollections.add(key);
        }
      }
      if (changedCollections.size > 0) {
        queryManager.reexecuteQueries(changedCollections);
      }
    },
    applyMerge: (collectionName, txDocuments) => {
      const currentCollection: Collection = state.collections[collectionName]!;
      const txCollection: Collection = txDocuments;

      const merged = mergeCollections(currentCollection, txCollection, state.tombstones);
      state.collections[collectionName] = merged;
    },
    applyTombstones: (txTombstones) => {
      state.tombstones = mergeTombstones(state.tombstones, txTombstones);
    },
  };

  const readFn = <R>(callback: (handles: ReadHandles<T>) => R): R => {
    const query = createQuery(
      callback,
      { configs, documents: state.collections, tombstones: state.tombstones },
      queryManager,
    );
    return query.result();
  };

  const subscribeFn = <R>(
    query: (handles: ReadHandles<T>) => R,
    subscriber: (value: R) => void,
  ): (() => void) => {
    const queryObject = createQuery(
      query,
      { configs, documents: state.collections, tombstones: state.tombstones },
      queryManager,
    );
    return queryObject.subscribe(subscriber);
  };

  const transactFn = <R>(callback: (handles: MutateHandles<T>) => R): R => {
    return executeTransaction("mutate", callback, deps);
  };

  const getSnapshotFn = (): StoreSnapshot => {
    const collectionsSnapshot: Record<string, Collection> = {};
    for (const [name, collection] of Object.entries(state.collections)) {
      collectionsSnapshot[name] = collection;
    }
    return {
      clock: state.clock,
      collections: collectionsSnapshot,
      tombstones: state.tombstones,
    };
  };

  const mergeFn = (snapshot: StoreSnapshot, options?: { silent?: boolean }): void => {
    advance(snapshot.clock.ms, snapshot.clock.seq);

    state.tombstones = mergeTombstones(state.tombstones, snapshot.tombstones);

    const event: StoreChangeEvent<T> = {};

    for (const [name, collectionData] of Object.entries(snapshot.collections)) {
      // Initialize collection if it doesn't exist
      if (!state.collections[name]) {
        state.collections[name] = {};
      }

      // Filter out tombstoned documents before merging
      const filteredCollection: Collection = {};
      for (const [id, doc] of Object.entries(collectionData)) {
        if (!state.tombstones[id]) {
          filteredCollection[id] = doc;
        }
      }

      // Merge collections using core mergeCollections function
      const currentCollection: Collection = state.collections[name];
      const sourceCollection: Collection = filteredCollection;

      const merged = mergeCollections(currentCollection, sourceCollection, state.tombstones);
      state.collections[name] = merged;

      // Mark collection as dirty
      event[name as keyof T] = true;
    }

    // Notify listeners once with batched event (only if there are changes and not silent)
    if (!options?.silent && Object.keys(event).length > 0) {
      listeners.forEach((listener) => listener(event));

      // Re-execute queries that depend on changed collections
      const changedCollections = new Set<string>();
      for (const key in event) {
        if (event[key]) {
          changedCollections.add(key);
        }
      }
      if (changedCollections.size > 0) {
        queryManager.reexecuteQueries(changedCollections);
      }
    }
  };

  const onChangeFn = (listener: (event: StoreChangeEvent<T>) => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const initFn = async (): Promise<void> => {
    if (isInitialized) {
      throw new Error("Store already initialized");
    }

    // Create context for middleware
    const context: MiddlewareContext<T> = {
      subscribe: (listener) => {
        const unsub = onChangeFn(listener);
        unsubscribeFns.push(unsub);
        return unsub;
      },
      getSnapshot: getSnapshotFn,
      merge: mergeFn,
    };

    // Call all middleware sequentially and collect cleanup functions
    for (const middleware of middlewares) {
      const cleanup = await middleware(context);
      if (cleanup) {
        cleanupFns.push(cleanup);
      }
    }

    isInitialized = true;
  };

  const disposeFn = async (): Promise<void> => {
    // Run cleanups in reverse order
    const reversed = [...cleanupFns].reverse();
    for (const cleanup of reversed) {
      await cleanup();
    }

    cleanupFns.length = 0;

    // Unsubscribe all middleware subscriptions
    unsubscribeFns.forEach((fn) => fn());
    unsubscribeFns.length = 0;

    isInitialized = false;
  };

  const storeAPI: StoreAPI<T> = {
    read: readFn,
    subscribe: subscribeFn,
    transact: transactFn,
    use(middleware: StoreMiddleware<T>): StoreAPI<T> {
      if (isInitialized) {
        throw new Error("Cannot add middleware after initialization");
      }
      middlewares.push(middleware);
      return storeAPI;
    },
    init: initFn,
    dispose: disposeFn,
  };

  return storeAPI;
}
