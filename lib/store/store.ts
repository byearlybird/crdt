import { validate } from "./schema";
import {
  makeDocument,
  parseDocument,
  mergeDocuments,
  mergeCollections,
  type Collection,
  type CollectionData,
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
  collections: Record<string, CollectionData>;
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
  merge(snapshot: StoreSnapshot): void;
  onChange(listener: (event: StoreChangeEvent<T>) => void): () => void;
};

export function createStore<T extends Record<string, CollectionConfig<AnyObject>>>(config: {
  collections: T;
}): StoreAPI<T> {
  let clock: Clock = { ms: Date.now(), seq: 0 };
  let tombstones: Tombstones = {};
  const documents: Record<string, Record<DocumentId, Document>> = {};
  const collectionConfigs = new Map<string, CollectionConfig<AnyObject>>();
  const storeListeners = new Set<(event: StoreChangeEvent<T>) => void>();

  const tick = (): string => {
    advance(Date.now(), 0);
    return makeStamp(clock.ms, clock.seq);
  };

  const advance = (ms: number, seq: number): void => {
    clock = advanceClock(clock, { ms, seq });
  };

  const notify = (collectionName: string, event: { type: string; id?: DocumentId; data?: any }) => {
    storeListeners.forEach((listener) =>
      listener({ collection: collectionName, ...event } as StoreChangeEvent<T>),
    );
  };

  const getConfig = <K extends keyof T & string>(
    collectionName: K,
  ): CollectionConfig<AnyObject> => {
    const config = collectionConfigs.get(collectionName);

    if (!config) {
      throw new Error(`Collection "${String(collectionName)}" not found`);
    }

    return config;
  };

  const getDocs = <K extends keyof T & string>(collectionName: K): Record<DocumentId, Document> => {
    const docs = documents[collectionName];
    if (!docs) {
      throw new Error(`Collection "${String(collectionName)}" not found`);
    }
    return docs;
  };

  // Initialize collections
  for (const [name, collectionConfig] of Object.entries(config.collections)) {
    collectionConfigs.set(name, collectionConfig);
    documents[name] = {};
  }

  return {
    add(collectionName, data) {
      const collectionConfig = getConfig(collectionName);
      const valid = validate(collectionConfig.schema, data);
      const id = valid[collectionConfig.keyPath] as DocumentId;
      const doc = makeDocument(valid, tick());

      documents[collectionName] = {
        ...documents[collectionName],
        [id]: doc,
      };

      notify(collectionName, { type: "add", id, data: valid });
    },

    get(collectionName, id) {
      if (tombstones[id]) return undefined;
      const collectionDocs = getDocs(collectionName);
      const doc = collectionDocs[id];

      if (!doc) return undefined;

      return parseDocument(doc) as Output<T[typeof collectionName]["schema"]>;
    },

    getAll(collectionName, options) {
      const collectionDocs = getDocs(collectionName);
      const resultDocs: Output<T[typeof collectionName]["schema"]>[] = [];

      for (const [id, doc] of Object.entries(collectionDocs)) {
        if (doc && !tombstones[id]) {
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

      documents[collectionName] = { ...collectionDocs, [id]: mergedDoc };

      notify(collectionName, { type: "update", id, data: parsed });
    },

    remove(collectionName, id) {
      const collectionDocs = getDocs(collectionName);
      tombstones = { ...tombstones, [id]: tick() };
      const { [id]: _removed, ...remainingDocs } = collectionDocs;
      documents[collectionName] = remainingDocs;
      notify(collectionName, { type: "remove", id });
    },

    getSnapshot(): StoreSnapshot {
      const collectionsSnapshot: Record<string, CollectionData> = {};
      for (const [name, collectionDocs] of Object.entries(documents)) {
        collectionsSnapshot[name] = { documents: collectionDocs };
      }
      return {
        clock,
        collections: collectionsSnapshot,
        tombstones,
      };
    },

    merge(snapshot: StoreSnapshot): void {
      advance(snapshot.clock.ms, snapshot.clock.seq);

      tombstones = mergeTombstones(tombstones, snapshot.tombstones);

      for (const [name, collectionData] of Object.entries(snapshot.collections)) {
        // Initialize collection if it doesn't exist
        if (!documents[name]) {
          documents[name] = {};
        }

        // Filter out tombstoned documents before merging
        const filteredDocs: Record<DocumentId, Document> = {};
        for (const [id, doc] of Object.entries(collectionData.documents)) {
          if (!tombstones[id]) {
            filteredDocs[id] = doc;
          }
        }

        // Merge collections using core mergeCollections function
        const currentCollection: Collection = {
          documents: documents[name],
          tombstones: {}, // Tombstones are store-level
        };

        const sourceCollection: Collection = {
          documents: filteredDocs,
          tombstones: {}, // Ignore incoming tombstones
        };

        const merged = mergeCollections(currentCollection, sourceCollection);
        documents[name] = merged.documents;

        // Notify merge event
        notify(name, { type: "merge" });
      }
    },

    onChange(listener: (event: StoreChangeEvent<T>) => void): () => void {
      storeListeners.add(listener);
      return () => storeListeners.delete(listener);
    },
  };
}
