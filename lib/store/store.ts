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

export type StoreSnapshot = {
  clock: Clock;
  collections: Record<string, Collection>;
  tombstones: Tombstones;
};

export type StoreChangeEvent<T extends Record<string, CollectionConfig<AnyObject>>> = {
  [K in keyof T]:
    | { type: "add"; collection: K; id: DocumentId; data: Output<T[K]["schema"]> }
    | { type: "update"; collection: K; id: DocumentId; data: Output<T[K]["schema"]> }
    | { type: "remove"; collection: K; id: DocumentId }
    | { type: "merge"; collection: K };
}[keyof T];

export type StoreAPI<T extends Record<string, CollectionConfig<AnyObject>>> = {
  add<K extends keyof T & string>(collection: K, data: Input<T[K]["schema"]>): void;

  get<K extends keyof T & string>(
    collection: K,
    id: DocumentId,
  ): Output<T[K]["schema"]> | undefined;

  getAll<K extends keyof T & string>(
    collection: K,
    options?: { where?: (item: Output<T[K]["schema"]>) => boolean },
  ): Output<T[K]["schema"]>[];

  update<K extends keyof T & string>(
    collection: K,
    id: DocumentId,
    data: Partial<Input<T[K]["schema"]>>,
  ): void;

  remove<K extends keyof T & string>(collection: K, id: DocumentId): void;

  getSnapshot(): StoreSnapshot;
  merge(snapshot: StoreSnapshot, options?: { silent?: boolean }): void;
  onChange(listener: (event: StoreChangeEvent<T>) => void): () => void;
};

/**
 * Creates a CRDT Store instance with encapsulated mutable state.
 *
 * The store maintains internal state including clock, documents, tombstones,
 * and event listeners. All mutations are tracked via the onChange callback.
 *
 * @param config - Store configuration with collection schemas
 * @returns A stateful Store instance with methods for CRUD operations
 */
export function createStore<T extends Record<string, CollectionConfig<AnyObject>>>(config: {
  collections: T;
}): StoreAPI<T> {
  // Encapsulated mutable state
  const state = {
    clock: { ms: Date.now(), seq: 0 } as Clock,
    tombstones: {} as Tombstones,
    documents: {} as Record<string, Record<DocumentId, Document>>,
    configs: new Map<string, CollectionConfig<AnyObject>>(),
    listeners: new Set<(event: StoreChangeEvent<T>) => void>(),
  };

  const tick = (): string => {
    advance(Date.now(), 0);
    return makeStamp(state.clock.ms, state.clock.seq);
  };

  const advance = (ms: number, seq: number): void => {
    state.clock = advanceClock(state.clock, { ms, seq });
  };

  const notify = (collectionName: string, event: { type: string; id?: DocumentId; data?: any }) => {
    state.listeners.forEach((listener) =>
      listener({ collection: collectionName, ...event } as StoreChangeEvent<T>),
    );
  };

  const getConfig = <K extends keyof T & string>(
    collectionName: K,
  ): CollectionConfig<AnyObject> => {
    const config = state.configs.get(collectionName);

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
    state.configs.set(name, collectionConfig);
    state.documents[name] = {};
  }

  return {
    add(collectionName, data) {
      const collectionConfig = getConfig(collectionName);
      const valid = validate(collectionConfig.schema, data);
      const id = valid[collectionConfig.keyPath] as DocumentId;
      const doc = makeDocument(valid, tick());

      state.documents[collectionName] = {
        ...state.documents[collectionName],
        [id]: doc,
      };

      notify(collectionName, { type: "add", id, data: valid });
    },

    get(collectionName, id) {
      if (state.tombstones[id]) return undefined;
      const collectionDocs = getDocs(collectionName);
      const doc = collectionDocs[id];

      if (!doc) return undefined;

      return parseDocument(doc) as Output<T[typeof collectionName]["schema"]>;
    },

    getAll(collectionName, options) {
      const collectionDocs = getDocs(collectionName);
      const resultDocs: Output<T[typeof collectionName]["schema"]>[] = [];

      for (const [id, doc] of Object.entries(collectionDocs)) {
        if (doc && !state.tombstones[id]) {
          const parsed = parseDocument(doc) as Output<T[typeof collectionName]["schema"]>;
          if (!options?.where || options?.where(parsed)) {
            resultDocs.push(parsed);
          }
        }
      }

      return resultDocs;
    },

    update(collectionName, id, data) {
      const collectionDocs = getDocs(collectionName);
      const currentDoc = collectionDocs[id];

      if (!currentDoc) return;

      const collectionConfig = getConfig(collectionName);
      const newAttrs = makeDocument(data, tick());
      const mergedDoc = mergeDocuments(currentDoc, newAttrs);

      const parsed = parseDocument(mergedDoc);
      validate(collectionConfig.schema, parsed);

      state.documents[collectionName] = { ...collectionDocs, [id]: mergedDoc };

      notify(collectionName, { type: "update", id, data: parsed });
    },

    remove(collectionName, id) {
      const collectionDocs = getDocs(collectionName);
      state.tombstones = { ...state.tombstones, [id]: tick() };
      const { [id]: _removed, ...remainingDocs } = collectionDocs;
      state.documents[collectionName] = remainingDocs;
      notify(collectionName, { type: "remove", id });
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

        // Notify merge event only if not silent
        if (!options?.silent) {
          notify(name, { type: "merge" });
        }
      }
    },

    onChange(listener: (event: StoreChangeEvent<T>) => void): () => void {
      state.listeners.add(listener);
      return () => state.listeners.delete(listener);
    },
  };
}
