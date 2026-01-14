import { createCollection, type CollectionChangeEvent } from "./collection";
import type { CollectionConfig, CollectionApi } from "./collection";
import type { Clock } from "../core/clock";
import type { Collection } from "../core/collection";
import { advanceClock, makeStamp } from "../core/clock";

export type StoreSnapshot = {
  clock: Clock;
  collections: Record<string, Collection>;
};

export type StoreCollections<T extends Record<string, CollectionConfig<any>>> = {
  [K in keyof T]: T[K] extends CollectionConfig<infer S> ? CollectionApi<S> : never;
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

export type StoreAPI<T extends Record<string, CollectionConfig<any>>> = StoreCollections<T> & {
  getSnapshot(): StoreSnapshot;
  merge(snapshot: StoreSnapshot): void;
  onChange(listener: (event: StoreChangeEvent<ExtractSchemas<T>>) => void): () => void;
};

export function createStore<T extends Record<string, CollectionConfig<any>>>(config: {
  collections: T;
}): StoreAPI<T> {
  // Internal clock state
  let clock: Clock = { ms: Date.now(), seq: 0 };

  const tick = (): string => {
    const next = advanceClock(clock, { ms: Date.now(), seq: 0 });
    clock = next;
    return makeStamp(next.ms, next.seq);
  };

  const advance = (ms: number, seq: number): void => {
    clock = advanceClock(clock, { ms, seq });
  };

  // Create collections
  const collections = initCollections(config.collections, tick);

  // Store-level change listeners
  const storeListeners = new Set<(event: StoreChangeEvent<ExtractSchemas<T>>) => void>();

  // Subscribe to each collection and bubble up events
  for (const [name, collection] of Object.entries(collections)) {
    collection.onChange((event: CollectionChangeEvent<any>) => {
      storeListeners.forEach((listener) =>
        listener({ collection: name, event } as StoreChangeEvent<ExtractSchemas<T>>),
      );
    });
  }

  return {
    ...collections,

    getSnapshot(): StoreSnapshot {
      const collectionsSnapshot: Record<string, Collection> = {};
      for (const [name, collection] of Object.entries(collections)) {
        collectionsSnapshot[name] = collection.getSnapshot();
      }
      return {
        clock,
        collections: collectionsSnapshot,
      };
    },

    merge(snapshot: StoreSnapshot): void {
      advance(snapshot.clock.ms, snapshot.clock.seq);
      for (const [name, collectionSnapshot] of Object.entries(snapshot.collections)) {
        const collection = collections[name];
        if (collection) {
          collection.merge(collectionSnapshot);
        }
      }
    },

    onChange(listener: (event: StoreChangeEvent<ExtractSchemas<T>>) => void): () => void {
      storeListeners.add(listener);
      return () => storeListeners.delete(listener);
    },
  };
}

function initCollections<T extends Record<string, CollectionConfig<any>>>(
  collectionsConfig: T,
  tick: () => string,
): StoreCollections<T> {
  return Object.fromEntries(
    Object.entries(collectionsConfig).map(([name, config]) => [
      name,
      createCollection(config, tick),
    ]),
  ) as StoreCollections<T>;
}
