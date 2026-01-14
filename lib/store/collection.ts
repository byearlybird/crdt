import { validate } from "./schema";
import {
  makeDocument,
  parseDocument,
  mergeDocuments,
  mergeCollections,
  type Collection,
  type DocumentId,
} from "../core";
import type { AnyObject, SchemaWithId, Output, Input } from "./schema";

export type CollectionConfig<T extends AnyObject> =
  | {
      schema: T;
      getId: (data: Output<T>) => DocumentId;
    }
  | {
      schema: SchemaWithId<T>;
    };

export type CollectionChangeEvent<T extends AnyObject> =
  | { type: "add"; id: DocumentId; data: Output<T> }
  | { type: "update"; id: DocumentId; data: Output<T> }
  | { type: "remove"; id: DocumentId }
  | { type: "merge" };

export type CollectionApi<T extends AnyObject> = {
  // Getters
  get(id: DocumentId): Output<T> | undefined;
  has(id: DocumentId): boolean;
  keys(): DocumentId[];
  values(): Output<T>[];
  entries(): [DocumentId, Output<T>][];
  size: number;

  // Mutations
  add(data: Input<T>): void;
  remove(id: DocumentId): void;
  update(id: DocumentId, document: Partial<Input<T>>): void;

  // Sync
  getSnapshot(): Collection;
  merge(snapshot: Collection): void;

  // Events
  onChange(listener: (event: CollectionChangeEvent<T>) => void): () => void;
};

type TickFunction = () => string;

// Internal state that holds both documents and tombstones
type CollectionState = {
  documents: Collection["documents"];
  tombstones: Collection["tombstones"];
};

export function createCollection<T extends AnyObject>(
  config: CollectionConfig<T>,
  tick: TickFunction,
): CollectionApi<T> {
  let state: CollectionState = {
    documents: {},
    tombstones: {},
  };

  const listeners = new Set<(event: CollectionChangeEvent<T>) => void>();

  const notify = (event: CollectionChangeEvent<T>) => {
    listeners.forEach((listener) => listener(event));
  };

  const getId = defineGetId(config);

  const parseData = (): ReadonlyMap<DocumentId, Output<T>> => {
    const result = new Map<DocumentId, Output<T>>();
    for (const [id, doc] of Object.entries(state.documents)) {
      if (!state.tombstones[id] && doc) {
        result.set(id, parseDocument(doc));
      }
    }
    return result;
  };

  return {
    // Getters
    get(id: DocumentId): Output<T> | undefined {
      if (state.tombstones[id]) return undefined;
      const doc = state.documents[id];
      return doc ? parseDocument(doc) : undefined;
    },

    has(id: DocumentId): boolean {
      return !state.tombstones[id] && !!state.documents[id];
    },

    keys(): DocumentId[] {
      return Array.from(parseData().keys());
    },

    values(): Output<T>[] {
      return Array.from(parseData().values());
    },

    entries(): [DocumentId, Output<T>][] {
      return Array.from(parseData().entries());
    },

    get size(): number {
      return parseData().size;
    },

    // Mutations
    add(data: Input<T>): void {
      const valid = validate(config.schema, data);
      const doc = makeDocument(valid, tick());
      const id = getId(valid);

      state = {
        ...state,
        documents: { ...state.documents, [id]: doc },
      };

      notify({ type: "add", id, data: valid });
    },

    remove(id: DocumentId): void {
      const { [id]: _removed, ...remainingDocs } = state.documents;

      state = {
        documents: remainingDocs,
        tombstones: { ...state.tombstones, [id]: tick() },
      };

      notify({ type: "remove", id });
    },

    update(id: DocumentId, document: Partial<Input<T>>): void {
      const currentDoc = state.documents[id];
      if (!currentDoc) return;

      const newAttrs = makeDocument(document, tick());
      const doc = mergeDocuments(currentDoc, newAttrs);

      const parsed = parseDocument(doc);
      validate(config.schema, parsed);

      state = {
        ...state,
        documents: { ...state.documents, [id]: doc },
      };

      notify({ type: "update", id, data: parsed });
    },

    // Sync
    getSnapshot(): Collection {
      return {
        documents: state.documents,
        tombstones: state.tombstones,
      };
    },

    merge(snapshot: Collection): void {
      const currentSnapshot = {
        documents: state.documents,
        tombstones: state.tombstones,
      };

      const merged = mergeCollections(currentSnapshot, snapshot);

      state = {
        documents: merged.documents,
        tombstones: merged.tombstones,
      };

      notify({ type: "merge" });
    },

    // Events
    onChange(listener: (event: CollectionChangeEvent<T>) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function hasIdProperty<T extends AnyObject>(data: Output<T>): data is { id: DocumentId } {
  return (
    typeof data === "object" &&
    data !== null &&
    "id" in data &&
    typeof (data as any).id === "string"
  );
}

function hasGetId<T extends AnyObject>(
  config: CollectionConfig<T>,
): config is {
  schema: T;
  getId: (data: Output<T>) => DocumentId;
} {
  return "getId" in config && typeof config.getId === "function";
}

function defineGetId<T extends AnyObject>(
  config: CollectionConfig<T>,
): (data: Output<T>) => DocumentId {
  return hasGetId(config) ? config.getId : defaultGetId;
}

function defaultGetId<T extends AnyObject>(data: Output<T>): DocumentId {
  if (hasIdProperty(data)) {
    return data.id;
  }
  throw new Error("Schema must have an 'id' property when getId is not provided");
}
