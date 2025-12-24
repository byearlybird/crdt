import { computed, type ReadableAtom } from "nanostores";
import { createCollection } from "./collection";
import { createClock, type ClockAPI } from "./clock";
import type { CollectionConfig, CollectionApi } from "./collection";
import type { Clock } from "../core/clock";
import type { Collection } from "../core/collection";

export type StoreSnapshot = {
  clock: Clock;
  collections: Record<string, Collection>;
};

export type StoreCollections<T extends Record<string, CollectionConfig<any>>> =
  {
    [K in keyof T]: T[K] extends CollectionConfig<infer S>
      ? CollectionApi<S>
      : never;
  };

export type QueryCollections<
  TCollections extends StoreCollections<any>,
  TKeys extends readonly (keyof TCollections)[],
> = {
  [K in TKeys[number]]: TCollections[K] extends { $data: ReadableAtom<infer D> }
    ? D
    : never;
};

export type StoreAPI<T extends Record<string, CollectionConfig<any>>> =
  StoreCollections<T> & {
    $snapshot: ReadableAtom<StoreSnapshot>;
    query<TKeys extends readonly (keyof StoreCollections<T>)[], TResult>(
      collections: TKeys,
      callback: (
        collections: QueryCollections<StoreCollections<T>, TKeys>,
      ) => TResult,
    ): ReadableAtom<TResult>;
    merge(snapshot: StoreSnapshot): void;
  };

export function createStore<
  T extends Record<string, CollectionConfig<any>>,
>(config: { collections: T }): StoreAPI<T> {
  const clock = createClock();
  const collections = initCollections(config.collections, clock);
  const $snapshot = parseCollections(collections, clock.$state);

  function getCollectionDataStores(
    collectionNames: readonly (keyof StoreCollections<T>)[],
  ): ReadableAtom<any>[] {
    return collectionNames.map((name) => collections[name]!.$data);
  }

  return {
    ...collections,
    $snapshot,
    query: <TKeys extends readonly (keyof StoreCollections<T>)[], TResult>(
      collectionNames: TKeys,
      callback: (
        collections: QueryCollections<StoreCollections<T>, TKeys>,
      ) => TResult,
    ) => {
      const atoms = getCollectionDataStores(collectionNames);

      return computed(atoms, (...values) => {
        const entries = collectionNames.map((name, i) => [name, values[i]]);
        return callback(
          Object.fromEntries(entries) as QueryCollections<
            StoreCollections<T>,
            TKeys
          >,
        );
      });
    },
    merge: (snapshot) => {
      clock.advance(snapshot.clock.ms, snapshot.clock.seq);
      mergeCollections(collections, snapshot.collections);
    },
  };
}

function initCollections<T extends Record<string, CollectionConfig<any>>>(
  collectionsConfig: T,
  clock: ClockAPI,
): StoreCollections<T> {
  return Object.fromEntries(
    Object.entries(collectionsConfig).map(([name, config]) => [
      name,
      createCollection(config, clock),
    ]),
  ) as StoreCollections<T>;
}

function parseCollections<T extends Record<string, CollectionConfig<any>>>(
  collections: StoreCollections<T>,
  clockState: ReadableAtom<Clock>,
): ReadableAtom<StoreSnapshot> {
  const collectionNames = Object.keys(collections);
  const collectionSnapshotAtoms: ReadableAtom<Collection>[] = [];

  for (const name of collectionNames) {
    const collection = collections[name];
    if (collection) {
      collectionSnapshotAtoms.push(collection.$snapshot);
    }
  }

  // Note: We don't include clockState in the dependency array because the clock
  // is always updated together with collection changes (via tick()). Including it
  // would cause double notifications. Instead, we read it synchronously inside.
  return computed(collectionSnapshotAtoms, (...snapshots) => {
    const clock = clockState.get();
    const collectionsSnapshot: Record<string, Collection> = {};
    for (let i = 0; i < collectionNames.length; i++) {
      const name = collectionNames[i];
      const snapshot = snapshots[i];
      if (name && snapshot !== undefined) {
        collectionsSnapshot[name] = snapshot;
      }
    }

    return {
      clock,
      collections: collectionsSnapshot,
    };
  });
}

function mergeCollections(
  target: Record<string, CollectionApi<any>>,
  source: Record<string, Collection>,
) {
  for (const [collectionName, collectionSnapshot] of Object.entries(source)) {
    const collection = target[collectionName];
    if (collection) {
      collection.merge(collectionSnapshot);
    }
  }
}
