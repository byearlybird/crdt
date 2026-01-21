import { validate } from "./schema";
import { makeDocument, parseDocument, mergeDocuments, type DocumentId } from "../core";
import type { Document } from "../core/document";
import type { Input, Output, AnyObject, CollectionConfig } from "./schema";
import type { Tombstones } from "../core/tombstone";
import type { StoreChangeEvent } from "./store";

// Read-only handle for a single collection (no mutations)
export type ReadHandle<T extends CollectionConfig<AnyObject>> = {
  get(id: DocumentId): Output<T["schema"]> | undefined;
  list(options?: { where?: (item: Output<T["schema"]>) => boolean }): Output<T["schema"]>[];
};

// Read-write handle for a single collection (includes mutations)
export type MutateHandle<T extends CollectionConfig<AnyObject>> = ReadHandle<T> & {
  add(data: Input<T["schema"]>): void;
  update(id: DocumentId, data: Partial<Input<T["schema"]>>): void;
  remove(id: DocumentId): void;
};

// Maps collection names to read-only handles (all collections available via proxy)
export type ReadHandles<T extends Record<string, CollectionConfig<AnyObject>>> = {
  [N in keyof T & string]: ReadHandle<T[N]>;
};

// Maps collection names to read-write handles (all collections available via proxy)
export type MutateHandles<T extends Record<string, CollectionConfig<AnyObject>>> = {
  [N in keyof T & string]: MutateHandle<T[N]>;
};

function createReadHandle<C extends CollectionConfig<AnyObject>>(
  txDocs: Record<DocumentId, Document>,
  txTombstones: Tombstones,
): ReadHandle<C> {
  return {
    get(id) {
      if (txTombstones[id]) return undefined;
      const doc = txDocs[id];
      if (!doc) return undefined;
      return parseDocument(doc) as Output<C["schema"]>;
    },

    list(options) {
      const resultDocs: Output<C["schema"]>[] = [];
      for (const [id, doc] of Object.entries(txDocs)) {
        if (doc && !txTombstones[id]) {
          const parsed = parseDocument(doc) as Output<C["schema"]>;
          if (!options?.where || options.where(parsed)) {
            resultDocs.push(parsed);
          }
        }
      }
      return resultDocs;
    },
  };
}

function createMutateHandle<C extends CollectionConfig<AnyObject>>(
  collectionConfig: C,
  txDocs: Record<DocumentId, Document>,
  txTombstones: Tombstones,
  txTick: () => string,
  recordChange: () => void,
): MutateHandle<C> {
  const readHandle = createReadHandle<C>(txDocs, txTombstones);

  return {
    ...readHandle,

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
  configs: Map<string, CollectionConfig<AnyObject>>;
  documents: Record<string, Record<DocumentId, Document>>;
  tombstones: Tombstones;
  tick: () => string;
  notifyListeners: (event: StoreChangeEvent<T>) => void;
  applyMerge: (collectionName: string, documents: Record<DocumentId, Document>) => void;
  applyTombstones: (tombstones: Tombstones) => void;
};

export function executeTransaction<
  T extends Record<string, CollectionConfig<AnyObject>>,
  R,
  Mode extends "read" | "mutate" = "mutate",
>(
  mode: Mode,
  callback: (handles: Mode extends "read" ? ReadHandles<T> : MutateHandles<T>) => R,
  deps: TransactionDependencies<T>,
): R {
  const readonly = mode === "read";

  // Lazy initialization: track which collections have been accessed
  const accessedCollections = new Set<string>();
  const txDocuments: Record<string, Record<DocumentId, Document>> = {};
  const handleCache: Record<string, any> = {};

  // Clone tombstones only if we might mutate
  const txTombstones: Tombstones = readonly ? deps.tombstones : { ...deps.tombstones };

  // Track which collections have changes (only for mutate mode)
  const dirtyCollections = new Set<string>();

  const recordChange = (collectionName: string) => {
    dirtyCollections.add(collectionName);
  };

  // Lazy initialization function
  const initializeCollection = (collectionName: string): void => {
    if (accessedCollections.has(collectionName)) {
      return; // Already initialized
    }

    accessedCollections.add(collectionName);

    const collectionDocs = deps.documents[collectionName];
    if (!collectionDocs) {
      throw new Error(`Collection "${collectionName}" not found`);
    }

    // For read-only: use original documents (no copy)
    // For mutate: clone documents for rollback capability
    txDocuments[collectionName] = readonly ? collectionDocs : { ...collectionDocs };

    const collectionConfig = deps.configs.get(collectionName);
    if (!collectionConfig) {
      throw new Error(`Collection "${collectionName}" not found`);
    }

    const txDocs = txDocuments[collectionName]!;

    // Create and cache the handle
    if (readonly) {
      handleCache[collectionName] = createReadHandle(txDocs, txTombstones);
    } else {
      handleCache[collectionName] = createMutateHandle(
        collectionConfig,
        txDocs,
        txTombstones,
        deps.tick,
        () => recordChange(collectionName),
      );
    }
  };

  // Create proxy that intercepts property access
  const proxy = new Proxy({} as Mode extends "read" ? ReadHandles<T> : MutateHandles<T>, {
    get(_target, prop: string | symbol) {
      // Handle symbol properties (like Symbol.iterator, etc.)
      if (typeof prop !== "string") {
        return undefined;
      }

      // Check if it's a valid collection name
      if (!deps.configs.has(prop)) {
        throw new Error(`Collection "${prop}" not found`);
      }

      // Lazy initialize if not already done
      if (!accessedCollections.has(prop)) {
        initializeCollection(prop);
      }

      // Return cached handle
      return handleCache[prop];
    },
  });

  // Execute callback and capture return value
  // On error: discard clones (automatic - just don't merge, execution stops here)
  const result = callback(proxy);

  // On success: merge cloned state back (only for mutate mode)
  if (!readonly) {
    // Merge tombstones
    deps.applyTombstones(txTombstones);

    // Merge collections that were accessed
    for (const collectionName of accessedCollections) {
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
  }

  // Return the callback's return value
  return result;
}
