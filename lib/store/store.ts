import {
  advanceClock,
  makeStamp,
  atomize,
  createReadLens,
  mergeDocs,
  type CollectionState,
  type StoreState,
  type Document,
  type Stamp,
  type AtomizedDocument,
} from "../core";
import { Emitter } from "../emitter";
import type { CollectionName, DocType, IdType, InputType, StoreConfig } from "./schema";
import { validate } from "./schema";
import type { StoreChangeEvent } from "./types";
import { doGet, doList, doPatch, doPut, doRemove, mergeState } from "./operations";

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
    // Track document-level modifications per collection
    type CollectionModifications = {
      modifiedDocs: Record<string, AtomizedDocument<Document>>;
      modifiedTombstones: Set<string>;
      revivedDocs: Set<string>;
    };

    const modifications: Record<string, CollectionModifications> = {};
    const event = {} as StoreChangeEvent<T>;

    // Helper to initialize modification tracking for a collection
    const ensureModifications = (name: string): CollectionModifications => {
      if (!(name in this.#config)) {
        throw new Error(`Collection "${name}" not found`);
      }
      if (!modifications[name]) {
        modifications[name] = {
          modifiedDocs: {},
          modifiedTombstones: new Set(),
          revivedDocs: new Set(),
        };
      }
      return modifications[name]!;
    };

    // Create transaction API
    const tx: TransactionAPI<T> = {
      get: (collection, id) => {
        // Validate collection exists
        if (!(collection in this.#config)) {
          throw new Error(`Collection "${collection}" not found`);
        }

        // Check modifications first for uncommitted writes
        const mods = modifications[collection];
        if (mods) {
          if (mods.modifiedDocs[id]) {
            return createReadLens(mods.modifiedDocs[id]!);
          }
          if (mods.modifiedTombstones.has(id)) {
            return undefined; // Deleted in transaction
          }
        }
        // Fallback to main state
        const col = this.#state.collections[collection]!;
        return doGet(col.documents, col.tombstones, id);
      },

      list: (collection) => {
        // Validate collection exists
        if (!(collection in this.#config)) {
          throw new Error(`Collection "${collection}" not found`);
        }

        const col = this.#state.collections[collection]!;
        const mods = modifications[collection];
        const results: DocType<T[typeof collection]>[] = [];

        // Collect all IDs to process
        const allIds = new Set<string>();
        for (const id in col.documents) allIds.add(id);
        if (mods) {
          for (const id in mods.modifiedDocs) allIds.add(id);
        }

        // Build result list
        for (const id of allIds) {
          // Skip if tombstoned
          if (mods?.modifiedTombstones.has(id)) continue;
          if (!mods?.revivedDocs.has(id) && col.tombstones[id]) continue;

          // Use modified doc if available, otherwise main state
          const doc = mods?.modifiedDocs[id] ?? col.documents[id];
          if (doc) {
            results.push(createReadLens(doc));
          }
        }

        return results;
      },

      put: (collection, data) => {
        const mods = ensureModifications(collection);
        const collectionConfig = this.#config[collection]!;
        const col = this.#state.collections[collection]!;
        event[collection] = true;

        // Validate and extract ID
        const validated = validate(collectionConfig.schema, data);
        const id = collectionConfig.getId(validated);

        // Handle tombstone revival
        if (col.tombstones[id]) {
          mods.revivedDocs.add(id);
          mods.modifiedTombstones.delete(id);
        }

        // Create new atomized document
        mods.modifiedDocs[id] = atomize(validated, this.#getNextStamp());
        return createReadLens(mods.modifiedDocs[id]!);
      },

      patch: (collection, id, data) => {
        const mods = ensureModifications(collection);
        const collectionConfig = this.#config[collection]!;
        const col = this.#state.collections[collection]!;
        event[collection] = true;

        // Get current document (from modifications or main state)
        let current = mods.modifiedDocs[id];
        if (!current) {
          current = col.documents[id];
          if (!current) {
            throw new Error(`Cannot patch non-existent document "${id}"`);
          }
          // Clone document into modifications
          mods.modifiedDocs[id] = structuredClone(current);
        }

        // Apply patch using field-level merge
        const changes = atomize(data, this.#getNextStamp()) as Partial<
          AtomizedDocument<DocType<T[typeof collection]>>
        >;
        const merged = mergeDocs(mods.modifiedDocs[id]!, changes);

        // Validate merged result
        const plain = createReadLens(merged);
        validate(collectionConfig.schema, plain);

        mods.modifiedDocs[id] = merged;
        return plain;
      },

      remove: (collection, id) => {
        const mods = ensureModifications(collection);
        event[collection] = true;

        mods.modifiedTombstones.add(id);
        delete mods.modifiedDocs[id]; // Remove if was newly created
      },
    };

    // Execute callback
    const result = callback(tx);

    // Commit: merge modifications into main state
    for (const [name, mods] of Object.entries(modifications)) {
      const col = this.#state.collections[name]!;

      // Merge modified documents
      for (const [id, doc] of Object.entries(mods.modifiedDocs)) {
        col.documents[id] = doc;
      }

      // Apply tombstones
      for (const id of mods.modifiedTombstones) {
        col.tombstones[id] = this.#getNextStamp();
        delete col.documents[id];
      }

      // Revive documents (remove tombstones)
      for (const id of mods.revivedDocs) {
        delete col.tombstones[id];
      }
    }

    // Emit event (only for mutated collections)
    if (Object.keys(event).length > 0) {
      this.#emitter.emit(event);
    }

    return result;
  }
}

export function createStore<T extends StoreConfig>(config: T): Store<T> {
  return new Store(config);
}
