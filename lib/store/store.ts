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
import { createQuery } from "./query";
import { createMiddlewareManager, type StoreMiddleware } from "./middleware";

export type StoreSnapshot = {
  clock: Clock;
  collections: Record<string, Collection>;
  tombstones: Tombstones;
};

export type StoreChangeEvent<T extends StoreConfig> = {
  [K in keyof T]?: true;
};

export type StoreAPI<T extends StoreConfig> = {
  read<R>(callback: (handles: ReadHandles<T>) => R): R;
  subscribe<R>(query: (handles: ReadHandles<T>) => R, subscriber: (value: R) => void): () => void;
  transact<R>(callback: (handles: MutateHandles<T>) => R): R;
  use(middleware: StoreMiddleware<T>): StoreAPI<T>;
  init(): Promise<void>;
  dispose(): Promise<void>;
};

function notifyListeners<T extends StoreConfig>(
  event: StoreChangeEvent<T>,
  listeners: Set<(event: StoreChangeEvent<T>) => void>,
): void {
  listeners.forEach((listener) => listener(event));
}

export function createStore<T extends StoreConfig>(config: { collections: T }): StoreAPI<T> {
  const state = {
    clock: { ms: Date.now(), seq: 0 } as Clock,
    tombstones: {} as Tombstones,
    collections: {} as Record<string, Collection>,
  };

  const configs = new Map<string, CollectionConfig<AnyObject>>();
  const listeners = new Set<(event: StoreChangeEvent<T>) => void>();

  const middlewareManager = createMiddlewareManager<T>();
  let isInitialized = false;

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

  const onChange = (listener: (event: StoreChangeEvent<T>) => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const read = <R>(callback: (handles: ReadHandles<T>) => R): R => {
    const query = createQuery(
      callback,
      { configs, documents: state.collections, tombstones: state.tombstones },
      onChange,
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
      onChange,
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

      notifyListeners(result.changes.event, listeners);
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
      notifyListeners(event, listeners);
    }
  };

  const init = async (): Promise<void> => {
    if (isInitialized) {
      throw new Error("Store already initialized");
    }

    await middlewareManager.init(onChange, getSnapshot, merge);

    isInitialized = true;
  };

  const dispose = async (): Promise<void> => {
    await middlewareManager.dispose();
    isInitialized = false;
  };

  return {
    read,
    subscribe,
    transact,
    use(middleware: StoreMiddleware<T>): StoreAPI<T> {
      middlewareManager.use(middleware);
      return this;
    },
    init,
    dispose,
  };
}
