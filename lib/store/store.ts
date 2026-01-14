import { createCollection, type CollectionChangeEvent } from "./collection";
import type { CollectionConfig, CollectionApi } from "./collection";
import type { Clock } from "../core/clock";
import type { CollectionData, DocumentId } from "../core/collection";
import { advanceClock, makeStamp } from "../core/clock";
import type { Input, Output } from "./schema";
import type { Tombstones } from "../core/tombstone";
import { mergeTombstones } from "../core/tombstone";
import type { Document } from "../core/document";

export type StoreSnapshot = {
  clock: Clock;
  collections: Record<string, CollectionData>;
  tombstones: Tombstones;
};

// Helper type to extract schemas from collection configs for cleaner type inference
type ExtractSchemas<T extends Record<string, CollectionConfig<any>>> = {
  [K in keyof T]: T[K] extends CollectionConfig<infer S> ? S : never;
};

export type StoreChangeEvent<T extends Record<string, any>> = {
  [K in keyof T]: {
    collection: K;
    event: CollectionChangeEvent<T[K]>;
  };
}[keyof T];

export type StoreAPI<T extends Record<string, CollectionConfig<any>>> = {
  add<K extends keyof T & string>(
    collection: K,
    data: Input<ExtractSchemas<T>[K]>
  ): void;

  get<K extends keyof T & string>(
    collection: K,
    id: DocumentId
  ): Output<ExtractSchemas<T>[K]> | undefined;

  getAll<K extends keyof T & string>(
    collection: K,
    options?: { where?: (item: Output<ExtractSchemas<T>[K]>) => boolean }
  ): Output<ExtractSchemas<T>[K]>[];

  update<K extends keyof T & string>(
    collection: K,
    id: DocumentId,
    data: Partial<Input<ExtractSchemas<T>[K]>>
  ): void;

  remove<K extends keyof T & string>(collection: K, id: DocumentId): void;

  getSnapshot(): StoreSnapshot;
  merge(snapshot: StoreSnapshot): void;
  onChange(listener: (event: StoreChangeEvent<ExtractSchemas<T>>) => void): () => void;
};

export function createStore<T extends Record<string, CollectionConfig<any>>>(config: {
  collections: T;
}): StoreAPI<T> {
  // Internal clock state
  let clock: Clock = { ms: Date.now(), seq: 0 };

  // Store-level tombstones
  let tombstones: Tombstones = {};

  const tick = (): string => {
    const next = advanceClock(clock, { ms: Date.now(), seq: 0 });
    clock = next;
    return makeStamp(next.ms, next.seq);
  };

  const advance = (ms: number, seq: number): void => {
    clock = advanceClock(clock, { ms, seq });
  };

  // Internal collections - not exposed in API
  const collectionConfigs = new Map<string, CollectionConfig<any>>();
  const collections = new Map<string, CollectionApi<any>>();

  for (const [name, collectionConfig] of Object.entries(config.collections)) {
    collectionConfigs.set(name, collectionConfig);
    const collection = createCollection(collectionConfig, tick);
    collections.set(name, collection);
  }

  // Helper to extract ID from data based on collection config
  function getIdForCollection(collectionName: string, data: any): DocumentId {
    const collectionConfig = collectionConfigs.get(collectionName);
    if (!collectionConfig) {
      throw new Error(`Collection "${collectionName}" not found`);
    }

    if ("getId" in collectionConfig) {
      return collectionConfig.getId(data);
    } else {
      return data.id;
    }
  }

  // Store-level change listeners
  const storeListeners = new Set<(event: StoreChangeEvent<ExtractSchemas<T>>) => void>();

  // Subscribe to each collection and bubble up events
  for (const [name, collection] of collections.entries()) {
    collection.onChange((event: CollectionChangeEvent<any>) => {
      storeListeners.forEach((listener) =>
        listener({ collection: name, event } as StoreChangeEvent<ExtractSchemas<T>>),
      );
    });
  }

  return {
    add(collectionName, data) {
      const collection = collections.get(collectionName as string);
      if (!collection) {
        throw new Error(`Collection "${String(collectionName)}" not found`);
      }
      collection.add(data);
    },

    get(collectionName, id) {
      // Check global tombstones first
      if (tombstones[id]) {
        return undefined;
      }

      const collection = collections.get(collectionName as string);
      if (!collection) {
        throw new Error(`Collection "${String(collectionName)}" not found`);
      }
      return collection.get(id);
    },

    getAll(collectionName, options) {
      const collection = collections.get(collectionName as string);
      if (!collection) {
        throw new Error(`Collection "${String(collectionName)}" not found`);
      }

      // Filter out globally tombstoned documents
      let allDocs = collection.values();
      allDocs = allDocs.filter((doc) => {
        const id = getIdForCollection(collectionName as string, doc);
        return !tombstones[id];
      });

      // Apply where predicate if provided
      if (options?.where) {
        allDocs = allDocs.filter(options.where);
      }

      return allDocs;
    },

    update(collectionName, id, data) {
      const collection = collections.get(collectionName as string);
      if (!collection) {
        throw new Error(`Collection "${String(collectionName)}" not found`);
      }
      collection.update(id, data);
    },

    remove(collectionName, id) {
      const collection = collections.get(collectionName as string);
      if (!collection) {
        throw new Error(`Collection "${String(collectionName)}" not found`);
      }

      // Add to global tombstones BEFORE removing from collection
      tombstones = { ...tombstones, [id]: tick() };

      collection.remove(id);
    },

    getSnapshot(): StoreSnapshot {
      const collectionsSnapshot: Record<string, CollectionData> = {};
      for (const [name, collection] of collections.entries()) {
        const snapshot = collection.getSnapshot();
        // Extract only documents, not per-collection tombstones
        collectionsSnapshot[name] = { documents: snapshot.documents };
      }
      return {
        clock,
        collections: collectionsSnapshot,
        tombstones, // Store-level tombstones
      };
    },

    merge(snapshot: StoreSnapshot): void {
      advance(snapshot.clock.ms, snapshot.clock.seq);

      // Merge store-level tombstones
      tombstones = mergeTombstones(tombstones, snapshot.tombstones);

      for (const [name, collectionData] of Object.entries(snapshot.collections)) {
        const collection = collections.get(name);
        if (collection) {
          // Filter out tombstoned documents before merging
          const filteredDocs: Record<DocumentId, Document> = {};
          for (const [id, doc] of Object.entries(collectionData.documents)) {
            if (!tombstones[id]) {
              filteredDocs[id] = doc;
            }
          }

          // Merge with empty tombstones since tombstones are now store-level
          collection.merge({
            documents: filteredDocs,
            tombstones: {},
          });
        }
      }
    },

    onChange(listener: (event: StoreChangeEvent<ExtractSchemas<T>>) => void): () => void {
      storeListeners.add(listener);
      return () => storeListeners.delete(listener);
    },
  };
}
