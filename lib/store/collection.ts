import { atom, computed, type ReadableAtom } from "nanostores";
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
import type { ClockAPI } from "./clock";

export type CollectionConfig<T extends AnyObject> =
  | {
      schema: T;
      getId: (data: Output<T>) => DocumentId;
    }
  | {
      schema: SchemaWithId<T>;
    };

export type CollectionApi<T extends AnyObject> = {
  $data: ReadableAtom<ReadonlyMap<DocumentId, Output<T>>>;
  $snapshot: ReadableAtom<Collection>;
  add(data: Input<T>): void;
  remove(id: DocumentId): void;
  update(id: DocumentId, document: Partial<Input<T>>): void;
  merge(snapshot: Collection): void;
} & Pick<
  ReadonlyMap<DocumentId, Output<T>>,
  "get" | "has" | "keys" | "values" | "entries" | "forEach" | "size"
>;

type TickFunction = () => string;

// Internal state atom that holds both documents and tombstones
// This allows us to update both atomically with a single notification
type CollectionState = {
  documents: Collection["documents"];
  tombstones: Collection["tombstones"];
};

export function addDocument<T extends AnyObject>(
  $state: ReturnType<typeof atom<CollectionState>>,
  config: CollectionConfig<T>,
  tick: TickFunction,
  data: Input<T>,
): void {
  const getId = defineGetId(config);
  const valid = validate(config.schema, data);
  const doc = makeDocument(valid, tick());
  const id = getId(valid);
  const current = $state.get();
  $state.set({
    ...current,
    documents: { ...current.documents, [id]: doc },
  });
}

export function removeDocument(
  $state: ReturnType<typeof atom<CollectionState>>,
  tick: TickFunction,
  id: DocumentId,
): void {
  const current = $state.get();
  const { [id]: _removed, ...remainingDocs } = current.documents;
  $state.set({
    documents: remainingDocs,
    tombstones: { ...current.tombstones, [id]: tick() },
  });
}

export function updateDocument<T extends AnyObject>(
  $state: ReturnType<typeof atom<CollectionState>>,
  config: CollectionConfig<T>,
  tick: TickFunction,
  id: DocumentId,
  document: Partial<Input<T>>,
): void {
  const current = $state.get();
  const currentDoc = current.documents[id];
  if (!currentDoc) return;

  const newAttrs = makeDocument(document, tick());
  const doc = mergeDocuments(currentDoc, newAttrs);

  validate(config.schema, parseDocument(doc));

  $state.set({
    ...current,
    documents: { ...current.documents, [id]: doc },
  });
}

export function mergeCollectionSnapshot(
  $state: ReturnType<typeof atom<CollectionState>>,
  currentSnapshot: Collection,
  incomingSnapshot: Collection,
): void {
  const merged = mergeCollections(currentSnapshot, incomingSnapshot);
  $state.set({
    documents: merged.documents,
    tombstones: merged.tombstones,
  });
}

export function createCollection<T extends AnyObject>(
  config: CollectionConfig<T>,
  clock: ClockAPI,
): CollectionApi<T> {
  const { $data, $snapshot, $state } = createCollectionState<T>();

  return {
    $data,
    $snapshot,
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
    forEach(
      callbackfn: (
        value: Output<T>,
        key: DocumentId,
        map: ReadonlyMap<DocumentId, Output<T>>,
      ) => void,
      thisArg?: any,
    ) {
      return $data.get().forEach(callbackfn, thisArg);
    },
    get size() {
      return $data.get().size;
    },
    add(data: Input<T>) {
      addDocument($state, config, clock.tick, data);
    },
    remove(id: DocumentId) {
      removeDocument($state, clock.tick, id);
    },
    update(id: DocumentId, document: Partial<Input<T>>) {
      updateDocument($state, config, clock.tick, id, document);
    },
    merge(snapshot: Collection) {
      const currentSnapshot = $snapshot.get();
      mergeCollectionSnapshot($state, currentSnapshot, snapshot);
    },
  };
}

function createCollectionState<T extends AnyObject>(): {
  $data: ReadableAtom<ReadonlyMap<DocumentId, Output<T>>>;
  $snapshot: ReadableAtom<Collection>;
  $state: ReturnType<typeof atom<CollectionState>>;
} {
  // Single atom holding both documents and tombstones for atomic updates
  const $state = atom<CollectionState>({
    documents: {},
    tombstones: {},
  });

  const $snapshot = computed($state, (state) => {
    return parseSnapshot(state.documents, state.tombstones);
  });

  const $data = computed($state, (state) => {
    return parseCollection<T>(state.documents, state.tombstones);
  });

  return {
    $data,
    $snapshot,
    $state,
  };
}

function hasIdProperty<T extends AnyObject>(
  data: Output<T>,
): data is { id: DocumentId } {
  return (
    typeof data === "object" &&
    data !== null &&
    "id" in data &&
    typeof (data as any).id === "string"
  );
}

function parseCollection<T extends AnyObject>(
  documents: Collection["documents"],
  tombstones: Collection["tombstones"],
): ReadonlyMap<DocumentId, Output<T>> {
  const result = new Map<DocumentId, Output<T>>();
  for (const [id, doc] of Object.entries(documents)) {
    if (!tombstones[id] && doc) {
      result.set(id, parseDocument(doc));
    }
  }
  return result;
}

function parseSnapshot(
  documents: Collection["documents"],
  tombstones: Collection["tombstones"],
): Collection {
  return {
    documents,
    tombstones,
  };
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
  throw new Error(
    "Schema must have an 'id' property when getId is not provided",
  );
}
