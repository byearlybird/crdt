import { validate } from "./schema";
import {
  makeDocument,
  parseDocument,
  mergeDocuments,
  type Collection,
  type DocumentId,
} from "../core";
import type { Document } from "../core/document";
import type { Input, Output, AnyObject, CollectionConfig } from "./schema";
import type { Tombstones } from "../core/tombstone";
import type { StoreChangeEvent } from "./store";

// Handle for a single collection within a transaction
export type TransactionHandle<T extends CollectionConfig<AnyObject>> = {
  get(id: DocumentId): Output<T["schema"]> | undefined;
  list(): Output<T["schema"]>[];
  add(data: Input<T["schema"]>): void;
  update(id: DocumentId, data: Partial<Input<T["schema"]>>): void;
  remove(id: DocumentId): void;
};

// Maps collection names to their handles - enables type inference
export type TransactionHandles<
  T extends Record<string, CollectionConfig<AnyObject>>,
  K extends (keyof T & string)[],
> = { [I in keyof K]: TransactionHandle<T[K[I] & keyof T]> };

function createTransactionHandle<C extends CollectionConfig<AnyObject>>(
  collectionConfig: C,
  txDocs: Record<DocumentId, Document>,
  txTombstones: Tombstones,
  txTick: () => string,
  recordChange: () => void,
): TransactionHandle<C> {
  return {
    get(id) {
      if (txTombstones[id]) return undefined;
      const doc = txDocs[id];
      if (!doc) return undefined;
      return parseDocument(doc) as Output<C["schema"]>;
    },

    list() {
      const resultDocs: Output<C["schema"]>[] = [];
      for (const [id, doc] of Object.entries(txDocs)) {
        if (doc && !txTombstones[id]) {
          const parsed = parseDocument(doc) as Output<C["schema"]>;
          resultDocs.push(parsed);
        }
      }
      return resultDocs;
    },

    add(data) {
      const valid = validate(collectionConfig.schema, data);
      const id = valid[collectionConfig.keyPath] as DocumentId;
      const doc = makeDocument(valid, txTick());
      txDocs[id] = doc;
      recordChange();
    },

    update(id, data) {
      const currentDoc = txDocs[id];
      if (!currentDoc) return;

      const newAttrs = makeDocument(data, txTick());
      const mergedDoc = mergeDocuments(currentDoc, newAttrs);
      const parsed = parseDocument(mergedDoc);
      validate(collectionConfig.schema, parsed);

      txDocs[id] = mergedDoc;
      recordChange();
    },

    remove(id) {
      txTombstones[id] = txTick();
      delete txDocs[id];
      recordChange();
    },
  };
}

export type TransactionDependencies<T extends Record<string, CollectionConfig<AnyObject>>> = {
  getConfig: (name: string) => CollectionConfig<AnyObject>;
  getCollectionDocuments: (name: string) => Record<DocumentId, Document>;
  getTombstones: () => Tombstones;
  tick: () => string;
  notifyListeners: (event: StoreChangeEvent<T>) => void;
  applyMerge: (collectionName: string, documents: Record<DocumentId, Document>) => void;
  applyTombstones: (tombstones: Tombstones) => void;
};

export function executeTransaction<
  T extends Record<string, CollectionConfig<AnyObject>>,
  K extends (keyof T & string)[],
  R,
>(
  collectionNames: [...K],
  callback: (handles: TransactionHandles<T, K>) => R,
  deps: TransactionDependencies<T>,
): R {
  // Clone documents for each specified collection
  const txDocuments: Record<string, Record<DocumentId, Document>> = {};
  for (const collectionName of collectionNames) {
    const collectionDocs = deps.getCollectionDocuments(collectionName);
    // Shallow copy of the documents record
    txDocuments[collectionName] = { ...collectionDocs };
  }

  // Clone tombstones (shallow copy)
  const txTombstones: Tombstones = { ...deps.getTombstones() };

  // Track which collections have changes
  const dirtyCollections = new Set<string>();

  const recordChange = (collectionName: string) => {
    dirtyCollections.add(collectionName);
  };

  // Create handles for each collection
  const handles = collectionNames.map((collectionName) => {
    const collectionConfig = deps.getConfig(collectionName);
    const txDocs = txDocuments[collectionName]!; // Safe: we just set it above
    return createTransactionHandle(
      collectionConfig,
      txDocs,
      txTombstones,
      deps.tick,
      () => recordChange(collectionName),
    );
  }) as TransactionHandles<T, typeof collectionNames>;

  // Execute callback and capture return value
  // On error: discard clones (automatic - just don't merge, execution stops here)
  const result = callback(handles);

  // On success: merge cloned state back

  // Merge tombstones
  deps.applyTombstones(txTombstones);

  // Merge collections
  for (const collectionName of collectionNames) {
    deps.applyMerge(collectionName, txDocuments[collectionName]!);
  }

  // Build event with dirty collections
  const event: StoreChangeEvent<T> = {};
  for (const collectionName of dirtyCollections) {
    event[collectionName as keyof T] = true;
  }

  // Notify listeners once with batched event (only if there are changes)
  if (dirtyCollections.size > 0) {
    deps.notifyListeners(event);
  }

  // Return the callback's return value
  return result;
}
