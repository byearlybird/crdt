import { mergeCollections, type Collection, type DocumentId } from "../core";
import type { Clock } from "../core/clock";
import { advanceClock, makeStamp } from "../core/clock";
import type { AnyObject, CollectionConfig } from "./schema";
import type { Tombstones } from "../core/tombstone";
import { mergeTombstones } from "../core/tombstone";
import type { Document } from "../core/document";
import {
  executeTransaction,
  type ReadHandles,
  type MutateHandles,
  type TransactionDependencies,
} from "./transaction";

// Re-export transaction types for public API
export type { ReadHandle, MutateHandle, ReadHandles, MutateHandles } from "./transaction";

export type StoreSnapshot = {
  clock: Clock;
  collections: Record<string, Collection>;
  tombstones: Tombstones;
};

export type StoreChangeEvent<T extends Record<string, CollectionConfig<AnyObject>>> = {
  [K in keyof T]?: true;
};

export type StoreAPI<T extends Record<string, CollectionConfig<AnyObject>>> = {
  // Read-only (optimized, no copy overhead)
  read<K extends (keyof T & string)[], R>(
    collectionNames: [...K],
    callback: (handles: ReadHandles<T, K>) => R,
  ): R;

  // Read-write transaction (full mutations, rollback on error)
  transact<K extends (keyof T & string)[], R>(
    collectionNames: [...K],
    callback: (handles: MutateHandles<T, K>) => R,
  ): R;

  // Other methods
  getSnapshot(): StoreSnapshot;
  merge(snapshot: StoreSnapshot, options?: { silent?: boolean }): void;
  onChange(listener: (event: StoreChangeEvent<T>) => void): () => void;
};

export function createStore<T extends Record<string, CollectionConfig<AnyObject>>>(config: {
  collections: T;
}): StoreAPI<T> {
  const state = {
    clock: { ms: Date.now(), seq: 0 } as Clock,
    tombstones: {} as Tombstones,
    documents: {} as Record<string, Record<DocumentId, Document>>,
  };

  const configs = new Map<string, CollectionConfig<AnyObject>>();
  const listeners = new Set<(event: StoreChangeEvent<T>) => void>();

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
    state.documents[name] = {};
  }

  const deps: TransactionDependencies<T> = {
    configs,
    documents: state.documents,
    tombstones: state.tombstones,
    tick,
    notifyListeners: (event) => {
      listeners.forEach((listener) => listener(event));
    },
    applyMerge: (collectionName, txDocuments) => {
      const currentCollection: Collection = {
        documents: state.documents[collectionName]!,
      };

      const txCollection: Collection = {
        documents: txDocuments,
      };

      const merged = mergeCollections(currentCollection, txCollection, state.tombstones);
      state.documents[collectionName] = merged.documents;
    },
    applyTombstones: (txTombstones) => {
      state.tombstones = mergeTombstones(state.tombstones, txTombstones);
    },
  };

  const readFn = <K extends (keyof T & string)[], R>(
    collectionNames: [...K],
    callback: (handles: ReadHandles<T, K>) => R,
  ): R => {
    return executeTransaction("read", collectionNames, callback, deps);
  };

  const transactFn = <K extends (keyof T & string)[], R>(
    collectionNames: [...K],
    callback: (handles: MutateHandles<T, K>) => R,
  ): R => {
    return executeTransaction("mutate", collectionNames, callback, deps);
  };

  return {
    read: readFn,
    transact: transactFn,

    getSnapshot(): StoreSnapshot {
      const collectionsSnapshot: Record<string, Collection> = {};
      for (const [name, collectionDocs] of Object.entries(state.documents)) {
        collectionsSnapshot[name] = { documents: collectionDocs };
      }
      return {
        clock: state.clock,
        collections: collectionsSnapshot,
        tombstones: state.tombstones,
      };
    },

    merge(snapshot: StoreSnapshot, options?: { silent?: boolean }): void {
      advance(snapshot.clock.ms, snapshot.clock.seq);

      state.tombstones = mergeTombstones(state.tombstones, snapshot.tombstones);

      const event: StoreChangeEvent<T> = {};

      for (const [name, collectionData] of Object.entries(snapshot.collections)) {
        // Initialize collection if it doesn't exist
        if (!state.documents[name]) {
          state.documents[name] = {};
        }

        // Filter out tombstoned documents before merging
        const filteredDocs: Record<DocumentId, Document> = {};
        for (const [id, doc] of Object.entries(collectionData.documents)) {
          if (!state.tombstones[id]) {
            filteredDocs[id] = doc;
          }
        }

        // Merge collections using core mergeCollections function
        const currentCollection: Collection = {
          documents: state.documents[name],
        };

        const sourceCollection: Collection = {
          documents: filteredDocs,
        };

        const merged = mergeCollections(currentCollection, sourceCollection, state.tombstones);
        state.documents[name] = merged.documents;

        // Mark collection as dirty
        event[name as keyof T] = true;
      }

      // Notify listeners once with batched event (only if there are changes and not silent)
      if (!options?.silent && Object.keys(event).length > 0) {
        listeners.forEach((listener) => listener(event));
      }
    },

    onChange(listener: (event: StoreChangeEvent<T>) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
