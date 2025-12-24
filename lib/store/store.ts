import { atom, computed, type ReadableAtom } from "nanostores";
import type { Clock } from "../core/clock";
import { advanceClock, makeStamp } from "../core/clock";
import { nowClock } from "./collection";
import type {
  CollectionConfig,
  CollectionAPI,
  TickFunction,
} from "./collection";
import {
  createCollectionInternal,
  addDocument,
  removeDocument,
  updateDocument,
  mergeCollectionSnapshot,
} from "./collection";
import type { CollectionSnapshot, DocumentId } from "../core";
import type { StandardSchemaV1 } from "@standard-schema/spec";

// Placeholder types for future implementation
export type Synchronizer = {
  // TODO: Define synchronizer interface
};

export type Persister = {
  // TODO: Define persister interface
};

export type StoreConfig = {
  collections: Record<string, CollectionConfig<any>>;
  synchronizer?: Synchronizer;
  persister?: Persister;
};

// Collection with mutation methods bound to store
type CollectionWithMutations<T extends StandardSchemaV1<any>> =
  CollectionAPI<T> & {
    // ReadonlyMap methods
    get(key: DocumentId): StandardSchemaV1.InferOutput<T> | undefined;
    has(key: DocumentId): boolean;
    keys(): IterableIterator<DocumentId>;
    values(): IterableIterator<StandardSchemaV1.InferOutput<T>>;
    entries(): IterableIterator<[DocumentId, StandardSchemaV1.InferOutput<T>]>;
    forEach(
      callbackfn: (
        value: StandardSchemaV1.InferOutput<T>,
        key: DocumentId,
        map: ReadonlyMap<DocumentId, StandardSchemaV1.InferOutput<T>>,
      ) => void,
      thisArg?: any,
    ): void;
    readonly size: number;
    // Mutation methods
    add(data: any): void;
    remove(id: DocumentId): void;
    update(id: DocumentId, document: Partial<any>): void;
    merge(snapshot: CollectionSnapshot): void;
  };

type StoreCollections<T extends Record<string, CollectionConfig<any>>> = {
  [K in keyof T]: T[K] extends CollectionConfig<infer S>
    ? CollectionWithMutations<S>
    : never;
};

// Helper type to extract collection data type from a collection
type ExtractCollectionData<T> = T extends { $data: ReadableAtom<infer D> }
  ? D
  : never;

// Type helper to create query collections object - data directly exposed
type QueryCollections<
  TCollections extends StoreCollections<any>,
  TKeys extends readonly (keyof TCollections)[],
> = {
  [K in TKeys[number]]: ExtractCollectionData<TCollections[K]>;
};

export type StoreAPI<T extends Record<string, CollectionConfig<any>>> =
  StoreCollections<T> & {
    query<TKeys extends readonly (keyof StoreCollections<T>)[], TResult>(
      collections: TKeys,
      callback: (
        collections: QueryCollections<StoreCollections<T>, TKeys>,
      ) => TResult,
    ): ReadableAtom<TResult>;
  };

export function createStore<T extends Record<string, CollectionConfig<any>>>(
  config: StoreConfig & { collections: T },
): StoreAPI<T> {
  // Create shared clock for the store
  const $clock = atom<Clock>(nowClock());

  // Create tick function that advances the store's clock
  const tick: TickFunction = () => {
    const next = advanceClock($clock.get(), nowClock());
    $clock.set(next);
    return makeStamp(next.ms, next.seq);
  };

  // Create collections and bind mutation methods
  const collections: any = {};

  for (const [name, collectionConfig] of Object.entries(config.collections)) {
    const { $data, $snapshot, $documents, $tombstones } =
      createCollectionInternal($clock);

    // Create collection with mutation methods
    collections[name] = {
      $data,
      $snapshot,
      // ReadonlyMap methods
      get(key: DocumentId) {
        return $data.get().get(key);
      },
      has(key: DocumentId) {
        return $data.get().has(key);
      },
      keys() {
        return $data.get().keys();
      },
      values() {
        return $data.get().values();
      },
      entries() {
        return $data.get().entries();
      },
      get size() {
        return $data.get().size;
      },
      // Mutation methods
      add(data: any) {
        addDocument($documents, collectionConfig, tick, data);
      },
      remove(id: DocumentId) {
        removeDocument($documents, $tombstones, tick, id);
      },
      update(id: DocumentId, document: Partial<any>) {
        updateDocument($documents, collectionConfig, tick, id, document);
      },
      merge(snapshot: CollectionSnapshot) {
        // Merge snapshot clock into store clock
        const currentSnapshot = $snapshot.get();
        mergeCollectionSnapshot(
          $clock,
          $documents,
          $tombstones,
          currentSnapshot,
          snapshot,
        );
      },
    };
  }

  const store = collections as StoreAPI<T>;

  // Add query method
  store.query = function <
    TKeys extends readonly (keyof StoreCollections<T>)[],
    TResult,
  >(
    collectionNames: TKeys,
    callback: (
      collections: QueryCollections<StoreCollections<T>, TKeys>,
    ) => TResult,
  ): ReadableAtom<TResult> {
    // Get the $data atoms for the specified collections
    const atoms = collectionNames.map(
      (name) => store[name].$data,
    ) as ReadableAtom<any>[];

    // Create computed atom - values are the data objects directly
    return computed(atoms, (...values) => {
      // Build the query collections object - data directly exposed
      const queryCollections: any = {};

      for (let i = 0; i < collectionNames.length; i++) {
        const name = collectionNames[i]!;
        const data = values[i];
        queryCollections[name] = data;
      }

      return callback(
        queryCollections as QueryCollections<StoreCollections<T>, TKeys>,
      );
    });
  };

  return store;
}
