import { validate } from "./schema";
import { makeDocument, parseDocument, mergeDocuments, type DocumentId } from "../core";
import type { Document } from "../core/document";
import type { Input, AnyObject, CollectionConfig, StoreConfig, CollectionName } from "./schema";
import type { Tombstones } from "../core/tombstone";
import type { StoreChangeEvent } from "./store";
import { createHandleProxy } from "./handles";
import { createReadHandle, type ReadHandle } from "./read";

export type MutateHandle<T extends CollectionConfig<AnyObject>> = ReadHandle<T> & {
  add(data: Input<T["schema"]>): void;
  update(id: DocumentId, data: Partial<Input<T["schema"]>>): void;
  remove(id: DocumentId): void;
};

export type MutateHandles<T extends StoreConfig> = {
  [N in CollectionName<T>]: MutateHandle<T[N]>;
};

function createMutateHandle<C extends CollectionConfig<AnyObject>>(
  config: C,
  documents: Record<DocumentId, Document>,
  tombstones: Tombstones,
  getTimestamp: () => string,
  markChanged: () => void,
): MutateHandle<C> {
  const readHandle = createReadHandle<C>(documents, tombstones);

  return {
    ...readHandle,

    add(data) {
      const validated = validate(config.schema, data);
      const id = validated[config.keyPath] as DocumentId;
      const document = makeDocument(validated, getTimestamp());
      documents[id] = document;
      markChanged();
    },

    update(id, data) {
      const current = documents[id];
      if (!current) return;

      const changes = makeDocument(data, getTimestamp());
      const merged = mergeDocuments(current, changes);
      const parsed = parseDocument(merged);
      validate(config.schema, parsed);

      documents[id] = merged;
      markChanged();
    },

    remove(id) {
      tombstones[id] = getTimestamp();
      delete documents[id];
      markChanged();
    },
  };
}

export type TransactionDependencies = {
  configs: Map<string, CollectionConfig<AnyObject>>;
  documents: Record<string, Record<DocumentId, Document>>;
  tombstones: Tombstones;
  tick: () => string;
};

export type TransactionChanges<T extends StoreConfig> = {
  documents: Record<string, Record<DocumentId, Document>>;
  tombstones: Tombstones;
  event: StoreChangeEvent<T>;
};

export type TransactionResult<T extends StoreConfig, R> = {
  value: R;
  changes: TransactionChanges<T> | null;
};

export function executeTransaction<T extends StoreConfig, R>(
  callback: (handles: MutateHandles<T>) => R,
  deps: TransactionDependencies,
): TransactionResult<T, R> {
  const documents: Record<string, Record<DocumentId, Document>> = {};
  const tombstones: Tombstones = { ...deps.tombstones };
  const changed = new Set<string>();

  const handles = createHandleProxy<MutateHandles<T>>(deps.configs, (collectionName, target) => {
    // Copy-on-write: isolate collection documents for mutation
    documents[collectionName] = { ...deps.documents[collectionName]! };
    const config = deps.configs.get(collectionName)!;

    target[collectionName] = createMutateHandle(
      config,
      documents[collectionName]!,
      tombstones,
      deps.tick,
      () => changed.add(collectionName),
    );
  });

  const value = callback(handles);

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
