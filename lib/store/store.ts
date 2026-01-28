import {
  advanceClock,
  makeStamp,
  mergeCollections,
  createReadLens,
  type CollectionState,
  type StoreState,
  type Document,
  type Stamp,
} from "../core";
import { Emitter } from "../emitter";
import type { CollectionName, DocType, IdType, InputType, StoreConfig } from "./schema";
import { validate } from "./schema";
import type { StoreChangeEvent } from "./types";
import { mergeState } from "./store-utils";
import { doGet, doList, doPatch, doPut, doRemove } from "./operations";

export type TransactionAPI<T extends StoreConfig> = {
  get<N extends CollectionName<T>>(collection: N, id: IdType<T[N]>): DocType<T[N]> | undefined;
  list<N extends CollectionName<T>>(collection: N): DocType<T[N]>[];
  put<N extends CollectionName<T>>(collection: N, data: InputType<T[N]>): DocType<T[N]>;
  patch<N extends CollectionName<T>>(
    collection: N,
    id: IdType<T[N]>,
    data: Partial<DocType<T[N]>>,
  ): DocType<T[N]>;
  remove<N extends CollectionName<T>>(collection: N, id: IdType<T[N]>): void;
};

export class Store<T extends StoreConfig> {
  #config: T;
  #emitter: Emitter<StoreChangeEvent<T>>;
  #state: StoreState;

  constructor(config: T) {
    this.#config = config;
    this.#emitter = new Emitter<StoreChangeEvent<T>>();
    this.#state = {
      clock: { ms: Date.now(), seq: 0 },
      collections: {},
    };

    // Initialize collections
    for (const collectionName of Object.keys(config) as CollectionName<T>[]) {
      this.#state.collections[collectionName] = {
        documents: {},
        tombstones: {},
      };
    }
  }

  #getNextStamp(): Stamp {
    this.#state.clock = advanceClock(this.#state.clock, { ms: Date.now(), seq: 0 });
    return makeStamp(this.#state.clock.ms, this.#state.clock.seq);
  }

  #getCollection<N extends CollectionName<T>>(collection: N): CollectionState<Document> {
    if (!(collection in this.#config)) {
      throw new Error(`Collection "${collection}" not found`);
    }
    return this.#state.collections[collection]!;
  }

  get<N extends CollectionName<T>>(collection: N, id: IdType<T[N]>): DocType<T[N]> | undefined {
    const col = this.#getCollection(collection);
    return doGet(col.documents, col.tombstones, id);
  }

  list<N extends CollectionName<T>>(collection: N): DocType<T[N]>[] {
    const col = this.#getCollection(collection);
    return doList(col.documents, col.tombstones);
  }

  put<N extends CollectionName<T>>(collection: N, data: InputType<T[N]>): DocType<T[N]> {
    const col = this.#getCollection(collection);
    const collectionConfig = this.#config[collection]!;
    const result = doPut(
      col.documents,
      col.tombstones,
      data as Document,
      this.#getNextStamp(),
      (d: unknown) => validate(collectionConfig.schema, d),
      (d: DocType<T[typeof collection]>) => collectionConfig.getId(d),
    );
    this.#emitter.emit({ [collection]: true } as StoreChangeEvent<T>);
    return result;
  }

  patch<N extends CollectionName<T>>(
    collection: N,
    id: IdType<T[N]>,
    data: Partial<DocType<T[N]>>,
  ): DocType<T[N]> {
    const col = this.#getCollection(collection);
    const collectionConfig = this.#config[collection]!;
    const result = doPatch(col.documents, id, data, this.#getNextStamp(), (d: unknown) =>
      validate(collectionConfig.schema, d),
    );
    this.#emitter.emit({ [collection]: true } as StoreChangeEvent<T>);
    return result;
  }

  remove<N extends CollectionName<T>>(collection: N, id: IdType<T[N]>): void {
    const col = this.#getCollection(collection);
    doRemove(col.documents, col.tombstones, id, this.#getNextStamp());
    this.#emitter.emit({ [collection]: true } as StoreChangeEvent<T>);
  }

  subscribe(callback: (event: StoreChangeEvent<T>) => void): () => void {
    return this.#emitter.subscribe(callback);
  }

  getState(): StoreState {
    return { ...this.#state };
  }

  merge(snapshot: StoreState): StoreChangeEvent<T> {
    const diff = mergeState(this.#state, snapshot, this.#config);
    this.#emitter.emit(diff);
    return diff;
  }

  transact<R>(callback: (tx: TransactionAPI<T>) => R): R {
    // 1. Create event object upfront (will be populated on mutations)
    const event = {} as StoreChangeEvent<T>;

    // 2. Partial overlay - only documents/tombstones modified in this transaction
    const txStates: Record<string, CollectionState<Document>> = {};

    const ensureTxState = (name: string): CollectionState<Document> => {
      if (!txStates[name]) {
        txStates[name] = { documents: {}, tombstones: {} };
      }
      return txStates[name]!;
    };

    const assertCollection = (name: string): void => {
      if (!(name in this.#config)) {
        throw new Error(`Collection "${name}" not found`);
      }
    };

    // 3. Create transaction API object
    const tx: TransactionAPI<T> = {
      get: (collection, id) => {
        assertCollection(collection);
        // Check transaction overlay first
        const txState = txStates[collection];
        if (txState) {
          if (txState.tombstones[id]) return undefined;
          const txDoc = txState.documents[id];
          if (txDoc) return createReadLens(txDoc) as DocType<T[typeof collection]>;
        }
        // Fall through to main store
        const main = this.#state.collections[collection]!;
        return doGet(main.documents, main.tombstones, id);
      },
      list: (collection) => {
        assertCollection(collection);
        const main = this.#state.collections[collection]!;
        const txState = txStates[collection];

        // No transaction modifications for this collection, read main directly
        if (!txState) {
          return doList(main.documents, main.tombstones);
        }

        // Merge overlay with main store view
        const results: DocType<T[typeof collection]>[] = [];
        const seen = new Set<string>();

        // Transaction documents take priority
        for (const [id, doc] of Object.entries(txState.documents)) {
          if (!txState.tombstones[id]) {
            seen.add(id);
            results.push(createReadLens(doc) as DocType<T[typeof collection]>);
          }
        }

        // Include main store documents not overridden or tombstoned
        for (const [id, doc] of Object.entries(main.documents)) {
          if (seen.has(id)) continue;
          if (txState.tombstones[id]) continue;
          if (main.tombstones[id]) continue;
          results.push(createReadLens(doc) as DocType<T[typeof collection]>);
        }

        return results;
      },
      put: (collection, data) => {
        assertCollection(collection);
        const txState = ensureTxState(collection);
        const collectionConfig = this.#config[collection]!;
        event[collection] = true;
        return doPut(
          txState.documents,
          txState.tombstones,
          data,
          this.#getNextStamp(),
          (d: unknown) => validate(collectionConfig.schema, d),
          (d: DocType<T[typeof collection]>) => collectionConfig.getId(d),
        );
      },
      patch: (collection, id, data) => {
        assertCollection(collection);
        const txState = ensureTxState(collection);
        const collectionConfig = this.#config[collection]!;
        event[collection] = true;

        // Copy the individual document into the overlay if not already there
        if (!txState.documents[id]) {
          const main = this.#state.collections[collection]!;
          const mainDoc = main.documents[id];
          if (!mainDoc) {
            throw new Error(`Cannot patch non-existent document "${id}"`);
          }
          txState.documents[id] = structuredClone(mainDoc);
        }

        return doPatch(
          txState.documents,
          id,
          data as Partial<Document>,
          this.#getNextStamp(),
          (d: unknown) => validate(collectionConfig.schema, d),
        );
      },
      remove: (collection, id) => {
        assertCollection(collection);
        const txState = ensureTxState(collection);
        event[collection] = true;
        doRemove(txState.documents, txState.tombstones, id, this.#getNextStamp());
      },
    };

    // 4. Execute callback
    const result = callback(tx);

    // 5. Commit: merge partial overlay into main store
    for (const name of Object.keys(txStates)) {
      this.#state.collections[name] = mergeCollections(
        this.#state.collections[name]!,
        txStates[name]!,
      );
    }

    // 6. Emit event (only includes collections that were actually mutated)
    if (Object.keys(event).length > 0) {
      this.#emitter.emit(event);
    }

    return result;
  }
}

export function createStore<T extends StoreConfig>(config: T): Store<T> {
  return new Store(config);
}
