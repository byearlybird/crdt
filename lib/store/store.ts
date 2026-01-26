import { advanceClock, makeStamp, type Collection, type StoreState } from "../core";
import { createEmitter } from "../emitter";
import { createHandle, type Handle } from "../store-two/collection-handle";
import type { CollectionId, CollectionName, Output, StoreConfig } from "./schema";
import { validate } from "./schema";
import type { StoreChangeEvent } from "./types";
import { mergeState, hasRelevantChange, validateCollectionNames } from "./store-utils";

export type StoreAPI<T extends StoreConfig> = {
  subscribe: {
    (callback: (event: StoreChangeEvent<T>) => void): () => void;
    <K extends (keyof T & string)[]>(
      collections: [...K],
      callback: (event: StoreChangeEvent<T>) => void,
    ): () => void;
  };
  getState(): StoreState;
  merge(snapshot: StoreState): StoreChangeEvent<T>;
} & {
  [N in CollectionName<T>]: Handle<Output<T[N]["schema"]>, CollectionId<T[N]>>;
};

export function createStore<T extends StoreConfig>(config: { collections: T }): StoreAPI<T> {
  const emitter = createEmitter<StoreChangeEvent<T>>();

  const state: StoreState = {
    clock: { ms: Date.now(), seq: 0 },
    tombstones: {},
    collections: {},
  };

  const getNextStamp = () => {
    state.clock = advanceClock(state.clock, { ms: Date.now(), seq: 0 });
    return makeStamp(state.clock.ms, state.clock.seq);
  };

  const collectionHandles = {} as {
    [N in CollectionName<T>]: Handle<Output<T[N]["schema"]>, CollectionId<T[N]>>;
  };

  for (const collectionName of Object.keys(config.collections) as CollectionName<T>[]) {
    state.collections[collectionName] = {};
    const collectionConfig = config.collections[collectionName];
    if (!collectionConfig) {
      throw new Error(`Collection config not found for "${collectionName}"`);
    }
    collectionHandles[collectionName] = createHandle({
      getCollection: () =>
        state.collections[collectionName] as Collection<Output<T[typeof collectionName]["schema"]>>,
      getTombstones: () => state.tombstones,
      getTimestamp: getNextStamp,
      validate: (data: unknown) =>
        validate(collectionConfig.schema, data as Record<string, unknown>),
      getId: (data: Output<T[typeof collectionName]["schema"]>) =>
        collectionConfig.getId(data),
      onMutate: () => emitter.emit({ [collectionName]: true } as StoreChangeEvent<T>),
    });
  }

  return {
    ...collectionHandles,
    subscribe(
      collectionsOrCallback: string[] | ((event: StoreChangeEvent<T>) => void),
      maybeCallback?: (event: StoreChangeEvent<T>) => void,
    ) {
      if (typeof collectionsOrCallback === "function") {
        return emitter.subscribe(collectionsOrCallback);
      }

      const collections = collectionsOrCallback as (keyof T & string)[];
      const callback = maybeCallback!;
      validateCollectionNames(collections, config.collections);

      return emitter.subscribe((event) => {
        if (hasRelevantChange(event, collections)) {
          callback(event);
        }
      });
    },
    getState() {
      return { ...state };
    },
    merge(snapshot) {
      const diff = mergeState(state, snapshot) as StoreChangeEvent<T>;
      emitter.emit(diff);
      return diff;
    },
  } as StoreAPI<T>;
}
