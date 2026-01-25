import type { AnyObject, CollectionConfig, CollectionName, StoreConfig } from "./schema";
import type { Document, DocumentId, Tombstones } from "../core";
import type { StoreChangeEvent } from "./store";
import { createReadHandle, type ReadHandle } from "./read";
import { createWriteHandle, type WriteCallbacks, type WriteHandle } from "./write";

export type TransactHandle<T extends CollectionConfig<AnyObject>> = ReadHandle<T> & WriteHandle<T>;

export type TransactHandles<T extends StoreConfig> = {
  [N in CollectionName<T>]: TransactHandle<T[N]>;
};

export type TransactDependencies = {
  configs: Map<string, CollectionConfig<AnyObject>>;
  documents: Record<string, Record<DocumentId, Document>>;
  tombstones: Tombstones;
  tick: () => string;
};

export type TransactChanges<T extends StoreConfig> = {
  documents: Record<string, Record<DocumentId, Document>>;
  tombstones: Tombstones;
  event: StoreChangeEvent<T>;
};

export type TransactResult<T extends StoreConfig, R> = {
  value: R;
  changes: TransactChanges<T> | null;
};

/**
 * Executes a transactional operation with copy-on-write isolation.
 * Provides ACId guarantees: Atomicity (rollback on error), Consistency (schema validation),
 * Isolation (consistent snapshot), and durability (via persistence middleware).
 *
 * @param collections - Explicit list of collections to access in this transaction
 * @param callback - Synchronous function that performs reads and writes
 * @param deps - Transaction dependencies (configs, documents, tombstones, tick)
 * @returns Result containing the callback's return value and any changes made
 */
export function executeTransact<T extends StoreConfig, K extends (keyof T & string)[], R>(
  collections: [...K],
  callback: (handles: { [P in K[number]]: TransactHandle<T[P]> }) => R,
  deps: TransactDependencies,
): TransactResult<T, R> {
  const documents: Record<string, Record<DocumentId, Document>> = {};
  const tombstones: Tombstones = { ...deps.tombstones };
  const changed = new Set<string>();

  // Build handles upfront for declared collections only
  const handles = {} as { [P in K[number]]: TransactHandle<T[P]> };

  for (const collectionName of collections) {
    // Validate collection exists
    if (!deps.configs.has(collectionName)) {
      throw new Error(`Collection "${collectionName}" not found`);
    }

    // Copy-on-write: copy declared collections upfront for isolation
    documents[collectionName] = { ...deps.documents[collectionName] };
    const config = deps.configs.get(collectionName)!;

    const callbacks: WriteCallbacks = {
      onAdd: (id, document) => {
        documents[collectionName]![id] = document;
        changed.add(collectionName);
      },
      onUpdate: (id, document) => {
        documents[collectionName]![id] = document;
        changed.add(collectionName);
      },
      onRemove: (id, tombstoneStamp) => {
        tombstones[id] = tombstoneStamp;
        delete documents[collectionName]![id];
        changed.add(collectionName);
      },
    };

    handles[collectionName as K[number]] = {
      ...createReadHandle(documents[collectionName]!, tombstones),
      ...createWriteHandle({
        config,
        documents: () => documents[collectionName]!,
        getTimestamp: deps.tick,
        callbacks,
      }),
    };
  }

  const value = callback(handles);

  // Reject async callbacks to maintain ACId isolation guarantees
  if (value instanceof Promise) {
    throw new TypeError("Transaction callback must be synchronous");
  }

  // Build changes only if something was modified
  if (changed.size === 0) {
    return { value, changes: null };
  }

  const event: StoreChangeEvent<T> = {};
  const changedDocuments: Record<string, Record<DocumentId, Document>> = {};
  for (const collectionName of changed) {
    event[collectionName as keyof T] = true;
    changedDocuments[collectionName] = documents[collectionName]!;
  }

  return {
    value,
    changes: {
      documents: changedDocuments,
      tombstones,
      event,
    },
  };
}
