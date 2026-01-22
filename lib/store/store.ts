import { mergeCollections, type Collection, type StoreState } from "../core";
import type { Clock } from "../core/clock";
import { advanceClock, makeStamp } from "../core/clock";
import type { AnyObject, CollectionConfig, StoreConfig } from "./schema";
import type { Tombstones } from "../core/tombstone";
import { mergeTombstones } from "../core/tombstone";
import {
  executeTransaction,
  type TransactionHandles,
  type TransactionDependencies,
} from "./transaction";
import { createReadHandles, type ReadHandles } from "./read";
import { createMiddlewareManager, type StoreMiddleware } from "./middleware";

export type { StoreState } from "../core";

export type StoreChangeEvent<T extends StoreConfig> = {
  [K in keyof T]?: true;
};

export type StoreAPI<T extends StoreConfig> = {
  read<R>(callback: (handles: ReadHandles<T>) => R): R;
  transact<R>(callback: (handles: TransactionHandles<T>) => R): R;
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
  const state: StoreState = {
    clock: { ms: Date.now(), seq: 0 },
    tombstones: {},
    collections: {},
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

  const getDeps = (): TransactionDependencies => ({
    configs,
    documents: state.collections,
    tombstones: state.tombstones,
    tick,
  });

  const listen = (listener: (event: StoreChangeEvent<T>) => void): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const read = <R>(callback: (handles: ReadHandles<T>) => R): R => {
    const handles = createReadHandles<T>({ configs, state });
    return callback(handles);
  };

  const transact = <R>(callback: (handles: TransactionHandles<T>) => R): R => {
    const result = executeTransaction(callback, getDeps());

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
  };

  const getState = (): StoreState => {
    return { ...state };
  };

  const setState = (snapshot: StoreState): void => {
    advance(snapshot.clock.ms, snapshot.clock.seq);
    state.tombstones = snapshot.tombstones;

    // Replace collections - ensure all collections from snapshot exist
    for (const [name, collectionData] of Object.entries(snapshot.collections)) {
      state.collections[name] = collectionData;
    }
  };

  const notify = (event: StoreChangeEvent<T>): void => {
    notifyListeners(event, listeners);
  };

  const init = async (): Promise<void> => {
    if (isInitialized) {
      throw new Error("Store already initialized");
    }

    await middlewareManager.runInit({ subscribe: listen, notify, getState, setState });

    isInitialized = true;
  };

  const dispose = async (): Promise<void> => {
    if (!isInitialized) {
      throw new Error("Store not initialized");
    }

    await middlewareManager.runDispose();
    isInitialized = false;
  };

  return {
    read,
    transact,
    use(middleware: StoreMiddleware<T>): StoreAPI<T> {
      if (isInitialized) {
        throw new Error("Cannot add middleware after initialization");
      }
      middlewareManager.use(middleware);
      return this;
    },
    init,
    dispose,
  };
}
