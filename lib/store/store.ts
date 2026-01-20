import { validate } from "./schema";
import {
  makeDocument,
  parseDocument,
  mergeDocuments,
  mergeCollections,
  type Collection,
  type DocumentId,
} from "../core";
import type { Clock } from "../core/clock";
import { advanceClock, makeStamp } from "../core/clock";
import type { Input, Output, AnyObject } from "./schema";
import type { Tombstones } from "../core/tombstone";
import { mergeTombstones } from "../core/tombstone";
import type { Document } from "../core/document";

export type CollectionConfig<T extends AnyObject> = {
  schema: T;
  keyPath: keyof Output<T> & string;
};

// Handle for a single collection within a transaction
type TransactionHandle<T extends CollectionConfig<AnyObject>> = {
  get(id: DocumentId): Output<T["schema"]> | undefined;
  list(): Output<T["schema"]>[];
  add(data: Input<T["schema"]>): void;
  update(id: DocumentId, data: Partial<Input<T["schema"]>>): void;
  remove(id: DocumentId): void;
};

// Maps collection names to their handles - enables type inference
type TransactionHandles<
  T extends Record<string, CollectionConfig<AnyObject>>,
  K extends (keyof T & string)[],
> = { [I in keyof K]: TransactionHandle<T[K[I] & keyof T]> };

export type StoreSnapshot = {
  clock: Clock;
  collections: Record<string, Collection>;
  tombstones: Tombstones;
};

export type StoreChangeEvent<T extends Record<string, CollectionConfig<AnyObject>>> = {
  [K in keyof T]?: true;
};

export type StoreAPI<T extends Record<string, CollectionConfig<AnyObject>>> = {
  add<K extends keyof T & string>(collection: K, data: Input<T[K]["schema"]>): void;

  get<K extends keyof T & string>(
    collection: K,
    id: DocumentId,
  ): Output<T[K]["schema"]> | undefined;

  list<K extends keyof T & string>(collection: K): Output<T[K]["schema"]>[];

  update<K extends keyof T & string>(
    collection: K,
    id: DocumentId,
    data: Partial<Input<T[K]["schema"]>>,
  ): void;

  remove<K extends keyof T & string>(collection: K, id: DocumentId): void;

  transact<K extends (keyof T & string)[], R>(
    collectionNames: [...K],
    callback: (handles: TransactionHandles<T, K>) => R,
  ): R;

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

  const getConfig = <K extends keyof T & string>(
    collectionName: K,
  ): CollectionConfig<AnyObject> => {
    const config = configs.get(collectionName);

    if (!config) {
      throw new Error(`Collection "${collectionName}" not found`);
    }

    return config;
  };

  const getDocs = <K extends keyof T & string>(collectionName: K): Record<DocumentId, Document> => {
    const docs = state.documents[collectionName];
    if (!docs) {
      throw new Error(`Collection "${collectionName}" not found`);
    }
    return docs;
  };

  // Initialize collections
  for (const [name, collectionConfig] of Object.entries(config.collections)) {
    configs.set(name, collectionConfig);
    state.documents[name] = {};
  }

  const createTransactionHandle = <C extends CollectionConfig<AnyObject>>(
    collectionConfig: C,
    txDocs: Record<DocumentId, Document>,
    txTombstones: Tombstones,
    txTick: () => string,
    recordChange: () => void,
  ): TransactionHandle<C> => {
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
  };

  const transactFn = <K extends (keyof T & string)[], R>(
    collectionNames: [...K],
    callback: (handles: TransactionHandles<T, K>) => R,
  ): R => {
    // Clone documents for each specified collection
    const txDocuments: Record<string, Record<DocumentId, Document>> = {};
    for (const collectionName of collectionNames) {
      const collectionDocs = state.documents[collectionName];
      if (!collectionDocs) {
        throw new Error(`Collection "${collectionName}" not found`);
      }
      // Shallow copy of the documents record
      txDocuments[collectionName] = { ...collectionDocs };
    }

    // Clone tombstones (shallow copy)
    const txTombstones: Tombstones = { ...state.tombstones };

    // Track which collections have changes
    const dirtyCollections = new Set<string>();

    const recordChange = (collectionName: string) => {
      dirtyCollections.add(collectionName);
    };

    // Create handles for each collection
    const handles = collectionNames.map((collectionName) => {
      const collectionConfig = getConfig(collectionName);
      const txDocs = txDocuments[collectionName]!; // Safe: we just set it above
      return createTransactionHandle(
        collectionConfig,
        txDocs,
        txTombstones,
        tick,
        () => recordChange(collectionName),
      );
    }) as TransactionHandles<T, typeof collectionNames>;

    // Execute callback and capture return value
    // On error: discard clones (automatic - just don't merge, execution stops here)
    const result = callback(handles);

    // On success: merge cloned state back

    // Merge tombstones
    state.tombstones = mergeTombstones(state.tombstones, txTombstones);

    // Merge collections
    for (const collectionName of collectionNames) {
      const currentCollection: Collection = {
        documents: state.documents[collectionName]!,
      };

      const txCollection: Collection = {
        documents: txDocuments[collectionName]!,
      };

      const merged = mergeCollections(currentCollection, txCollection, state.tombstones);
      state.documents[collectionName] = merged.documents;
    }

    // Build event with dirty collections
    const event: StoreChangeEvent<T> = {};
    for (const collectionName of dirtyCollections) {
      event[collectionName as keyof T] = true;
    }

    // Notify listeners once with batched event (only if there are changes)
    if (dirtyCollections.size > 0) {
      listeners.forEach((listener) => listener(event));
    }

    // Return the callback's return value
    return result;
  };

  return {
    transact: transactFn,

    add(collectionName, data) {
      transactFn([collectionName], ([handle]) => {
        handle.add(data);
      });
    },

    get(collectionName, id) {
      if (state.tombstones[id]) return undefined;
      const collectionDocs = getDocs(collectionName);
      const doc = collectionDocs[id];

      if (!doc) return undefined;

      return parseDocument(doc) as Output<T[typeof collectionName]["schema"]>;
    },

    list(collectionName) {
      const collectionDocs = getDocs(collectionName);
      const resultDocs: Output<T[typeof collectionName]["schema"]>[] = [];

      for (const [id, doc] of Object.entries(collectionDocs)) {
        if (doc && !state.tombstones[id]) {
          const parsed = parseDocument(doc) as Output<T[typeof collectionName]["schema"]>;
          resultDocs.push(parsed);
        }
      }

      return resultDocs;
    },

    update(collectionName, id, data) {
      transactFn([collectionName], ([handle]) => {
        handle.update(id, data);
      });
    },

    remove(collectionName, id) {
      transactFn([collectionName], ([handle]) => {
        handle.remove(id);
      });
    },

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
