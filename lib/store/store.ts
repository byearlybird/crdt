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
import { createQuery, createQueryManager, type QueryManager, type QueryObject } from "./query";

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
  read<R>(callback: (handles: ReadHandles<T>) => R): R;
  subscribe<R>(query: (handles: ReadHandles<T>) => R, subscriber: (value: R) => void): () => void;
  transact<R>(callback: (handles: MutateHandles<T>) => R): R;
  use(middleware: StoreMiddleware<T>): StoreAPI<T>;
  init(): Promise<void>;
  dispose(): Promise<void>;
};

function getChangedCollections<T extends StoreConfig>(event: StoreChangeEvent<T>): Set<string> {
  const changed = new Set<string>();
  for (const key in event) {
    if (event[key]) {
      changed.add(key);
    }
  }
  return changed;
}

function notifyListenersAndQueries<T extends StoreConfig>(
  event: StoreChangeEvent<T>,
  listeners: Set<(event: StoreChangeEvent<T>) => void>,
  queryManager: QueryManager,
): void {
  listeners.forEach((listener) => listener(event));

  const changed = getChangedCollections(event);
  if (changed.size > 0) {
    queryManager.reexecuteQueries(changed);
  }
}

export function createStore<T extends StoreConfig>(config: { collections: T }): StoreAPI<T> {
  const state = {
    clock: { ms: Date.now(), seq: 0 } as Clock,
    tombstones: {} as Tombstones,
    collections: {} as Record<string, Collection>,
  };

  const configs = new Map<string, CollectionConfig<AnyObject>>();
  const listeners = new Set<(event: StoreChangeEvent<T>) => void>();
  const queryManager = createQueryManager();

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

  for (const [name, collectionConfig] of Object.entries(config.collections)) {
    configs.set(name, collectionConfig);
    state.collections[name] = {};
  }

  const deps: TransactionDependencies<T> = {
    configs,
    documents: state.collections,
    tombstones: state.tombstones,
    tick,
  };

  const read = <R>(callback: (handles: ReadHandles<T>) => R): R => {
    const query = createQuery(
      callback,
      { configs, documents: state.collections, tombstones: state.tombstones },
      queryManager,
    );
    return query.result();
  };

  const subscribe = <R>(
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

  const transact = <R>(callback: (handles: MutateHandles<T>) => R): R => {
    const result = executeTransaction("mutate", callback, deps);

    if (result.changes) {
      state.tombstones = mergeTombstones(state.tombstones, result.changes.tombstones);

      for (const collectionName of result.changes.accessed) {
        const current = state.collections[collectionName]!;
        const updated = result.changes.documents[collectionName]!;
        state.collections[collectionName] = mergeCollections(current, updated, state.tombstones);
      }

      notifyListenersAndQueries(result.changes.event, listeners, queryManager);
    }

    return result.value;
  };

  const getSnapshot = (): StoreSnapshot => {
    return {
      clock: state.clock,
      collections: { ...state.collections },
      tombstones: state.tombstones,
    };
  };

  const merge = (snapshot: StoreSnapshot, options?: { silent?: boolean }): void => {
    advance(snapshot.clock.ms, snapshot.clock.seq);
    state.tombstones = mergeTombstones(state.tombstones, snapshot.tombstones);

    const event: StoreChangeEvent<T> = {};

    for (const [name, collectionData] of Object.entries(snapshot.collections)) {
      if (!state.collections[name]) {
        state.collections[name] = {};
      }

      const filtered: Collection = {};
      for (const [id, doc] of Object.entries(collectionData)) {
        if (!state.tombstones[id]) {
          filtered[id] = doc;
        }
      }

      const current = state.collections[name];
      const merged = mergeCollections(current, filtered, state.tombstones);
      state.collections[name] = merged;

      event[name as keyof T] = true;
    }

    if (!options?.silent && Object.keys(event).length > 0) {
      notifyListenersAndQueries(event, listeners, queryManager);
    }
  };

  const onChange = (listener: (event: StoreChangeEvent<T>) => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const init = async (): Promise<void> => {
    if (isInitialized) {
      throw new Error("Store already initialized");
    }

    const context: MiddlewareContext<T> = {
      subscribe: (listener) => {
        const unsubscribe = onChange(listener);
        unsubscribeFns.push(unsubscribe);
        return unsubscribe;
      },
      getSnapshot,
      merge,
    };

    for (const middleware of middlewares) {
      const cleanup = await middleware(context);
      if (cleanup) {
        cleanupFns.push(cleanup);
      }
    }

    isInitialized = true;
  };

  const dispose = async (): Promise<void> => {
    const reversed = [...cleanupFns].reverse();
    for (const cleanup of reversed) {
      await cleanup();
    }

    cleanupFns.length = 0;
    unsubscribeFns.forEach((fn) => fn());
    unsubscribeFns.length = 0;

    isInitialized = false;
  };

  return {
    read,
    subscribe,
    transact,
    use(middleware: StoreMiddleware<T>): StoreAPI<T> {
      if (isInitialized) {
        throw new Error("Cannot add middleware after initialization");
      }
      middlewares.push(middleware);
      return this;
    },
    init,
    dispose,
  };
}
