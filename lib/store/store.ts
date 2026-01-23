import {
  advanceClock,
  makeStamp,
  mergeCollections,
  mergeTombstones,
  type Document,
  type DocumentId,
  type StoreState,
} from "../core";
import type { AnyObject, CollectionConfig, CollectionName, StoreConfig } from "./schema";
import {
  executeTransaction,
  type TransactionDependencies,
  type TransactionHandles,
} from "./transaction";
import { createReadHandles, type ReadHandle, type ReadHandles } from "./read";
import { createWriteHandles, type WriteHandle, type WriteHandles } from "./write";
import {
  createMiddlewareManager,
  type MiddlewareContext,
  type StoreMiddleware,
} from "./middleware";
import { createChangeEvent } from "./utils";
import { executeQuery, type QueryDependencies } from "./query";
export type { StoreState } from "../core";

export type StoreChangeEvent<T extends StoreConfig> = {
  [K in keyof T]?: true;
};

export type StoreCollectionHandles<T extends StoreConfig> = {
  [N in CollectionName<T>]: ReadHandle<T[N]> & WriteHandle<T[N]>;
};

export type StoreAPI<T extends StoreConfig> = {
  transact<R>(callback: (handles: TransactionHandles<T>) => R): R;
  query<R>(selector: (handles: ReadHandles<T>) => R, callback: (value: R) => void): () => void;
  use(middleware: StoreMiddleware<T>): StoreAPI<T>;
  init(): Promise<void>;
  dispose(): Promise<void>;
} & ReadHandles<T> &
  WriteHandles<T>;

function notifyListeners<T extends StoreConfig>(
  event: StoreChangeEvent<T>,
  listeners: Set<(event: StoreChangeEvent<T>) => void>,
): void {
  listeners.forEach((listener) => listener(event));
}

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

  const getTransactionDeps = (): TransactionDependencies => ({
    configs,
    documents: state.collections,
    tombstones: state.tombstones,
    tick,
  });

  const getQueryDeps = (): QueryDependencies<T> => ({
    configs,
    state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
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

  const buildCallbacks = (collectionName: CollectionName<T>) => ({
    onAdd: (id: DocumentId, document: Document) => {
      const updated = { [id]: document };
      state.collections[collectionName] = mergeCollections(
        state.collections[collectionName] ?? {},
        updated,
        state.tombstones,
      );
      notifyListeners(createChangeEvent(collectionName), listeners);
    },
    onUpdate: (id: DocumentId, document: Document) => {
      const updated = { [id]: document };
      state.collections[collectionName] = mergeCollections(
        state.collections[collectionName] ?? {},
        updated,
        state.tombstones,
      );
      notifyListeners(createChangeEvent(collectionName), listeners);
    },
    onRemove: (id: DocumentId, tombstoneStamp: string) => {
      state.tombstones = mergeTombstones(state.tombstones, { [id]: tombstoneStamp });
      state.collections[collectionName] = mergeCollections(
        state.collections[collectionName] ?? {},
        {},
        state.tombstones,
      );
      notifyListeners(createChangeEvent(collectionName), listeners);
    },
  });

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
    query(selector, callback) {
      return executeQuery(selector, callback, getQueryDeps());
    },
    transact(callback) {
      const result = executeTransaction(callback, getTransactionDeps());

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
