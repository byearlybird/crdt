import type { AnyObject, CollectionConfig, CollectionName, StoreConfig } from "./schema";
import type { Document, DocumentId, Tombstones } from "../core";
import type { StoreChangeEvent } from "./store";
import { createReadHandle, type ReadHandle } from "./read";
import { createWriteHandle, type WriteCallbacks, type WriteHandle } from "./write";

export type BatchHandle<T extends CollectionConfig<AnyObject>> = ReadHandle<T> & WriteHandle<T>;

export type BatchHandles<T extends StoreConfig> = {
  [N in CollectionName<T>]: BatchHandle<T[N]>;
};

export type BatchDependencies = {
  configs: Map<string, CollectionConfig<AnyObject>>;
  documents: Record<string, Record<DocumentId, Document>>;
  tombstones: Tombstones;
  tick: () => string;
};

export type BatchChanges<T extends StoreConfig> = {
  documents: Record<string, Record<DocumentId, Document>>;
  tombstones: Tombstones;
  event: StoreChangeEvent<T>;
};

export type BatchResult<T extends StoreConfig, R> = {
  value: R;
  changes: BatchChanges<T> | null;
};

export function executeBatch<
  T extends StoreConfig,
  K extends (keyof T & string)[],
  R,
>(
  collections: [...K],
  callback: (handles: { [P in K[number]]: BatchHandle<T[P]> }) => R,
  deps: BatchDependencies,
): BatchResult<T, R> {
  const documents: Record<string, Record<DocumentId, Document>> = {};
  const tombstones: Tombstones = { ...deps.tombstones };
  const changed = new Set<string>();

  // Build handles upfront for declared collections only
  const handles = {} as { [P in K[number]]: BatchHandle<T[P]> };

  for (const collectionName of collections) {
    // Validate collection exists
    if (!deps.configs.has(collectionName)) {
      throw new Error(`Collection "${collectionName}" not found`);
    }

    // Copy-on-write: copy declared collections upfront
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

  // Reject async callbacks
  if (value instanceof Promise) {
    throw new TypeError("Batch callback must be synchronous");
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
