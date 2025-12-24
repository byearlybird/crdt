import { atom, batched, map, type ReadableAtom } from "nanostores";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { validate } from "./schema";
import {
  type Clock,
  makeDocument,
  parseDocument,
  mergeDocuments,
  mergeCollections,
  type CollectionSnapshot,
  type DocumentId,
} from "../core";
import type { AnyStandardObject } from "./schema";

export type CollectionData<T extends AnyStandardObject> = ReadonlyMap<
  DocumentId,
  StandardSchemaV1.InferOutput<T>
>;

/**
 * Helper type that checks if a schema's output type has an 'id' property.
 */
type SchemaWithId<T extends AnyStandardObject> =
  StandardSchemaV1.InferOutput<T> extends {
    id: any;
  }
    ? T
    : never;

export type CollectionConfig<T extends AnyStandardObject> =
  | {
      schema: T;
      getId: (data: StandardSchemaV1.InferOutput<T>) => DocumentId;
    }
  | {
      schema: SchemaWithId<T>;
    };

export type CollectionAPI<T extends AnyStandardObject> = {
  // Store access for listeners
  $data: ReadableAtom<CollectionData<T>>;
  $snapshot: ReadableAtom<CollectionSnapshot>;
};

// Helper functions for collection mutations (used by Store)
export type TickFunction = () => string;

export function addDocument<T extends AnyStandardObject>(
  $documents: ReturnType<typeof map<CollectionSnapshot["documents"]>>,
  config: CollectionConfig<T>,
  tick: TickFunction,
  data: StandardSchemaV1.InferInput<T>,
): void {
  const getId = defineGetId(config);
  const valid = validate(config.schema, data);
  const doc = makeDocument(valid, tick());
  const id = getId(valid);
  $documents.setKey(id, doc);
}

export function removeDocument(
  $documents: ReturnType<typeof map<CollectionSnapshot["documents"]>>,
  $tombstones: ReturnType<typeof map<CollectionSnapshot["tombstones"]>>,
  tick: TickFunction,
  id: DocumentId,
): void {
  $tombstones.setKey(id, tick());
  $documents.setKey(id, undefined);
}

export function updateDocument<T extends AnyStandardObject>(
  $documents: ReturnType<typeof map<CollectionSnapshot["documents"]>>,
  config: CollectionConfig<T>,
  tick: TickFunction,
  id: DocumentId,
  document: Partial<StandardSchemaV1.InferInput<T>>,
): void {
  const current = $documents.get()[id];
  if (!current) return;

  const newAttrs = makeDocument(document, tick());
  const doc = mergeDocuments(current, newAttrs);

  validate(config.schema, parseDocument(doc));

  $documents.setKey(id, doc);
}

export function mergeCollectionSnapshot(
  $clock: ReturnType<typeof atom<Clock>>,
  $documents: ReturnType<typeof map<CollectionSnapshot["documents"]>>,
  $tombstones: ReturnType<typeof map<CollectionSnapshot["tombstones"]>>,
  currentSnapshot: CollectionSnapshot,
  incomingSnapshot: CollectionSnapshot,
): void {
  const merged = mergeCollections(currentSnapshot, incomingSnapshot);
  $clock.set(merged.clock);
  $documents.set(merged.documents);
  $tombstones.set(merged.tombstones);
}

// Internal helper to create a collection (used by Store)
// Collections share the store's clock - they don't have their own
export function createCollectionInternal<T extends AnyStandardObject>(
  $clock: ReturnType<typeof atom<Clock>>,
): CollectionAPI<T> & {
  $documents: ReturnType<typeof map<CollectionSnapshot["documents"]>>;
  $tombstones: ReturnType<typeof map<CollectionSnapshot["tombstones"]>>;
} {
  const $documents = map<CollectionSnapshot["documents"]>({});
  const $tombstones = map<CollectionSnapshot["tombstones"]>({});
  const $snapshot = batched([$clock, $documents, $tombstones], parseSnapshot);
  const $data = batched([$documents, $tombstones], parseCollection<T>);

  return {
    $data,
    $snapshot,
    $documents,
    $tombstones,
  };
}

function parseCollection<T extends AnyStandardObject>(
  documents: CollectionSnapshot["documents"],
  tombstones: CollectionSnapshot["tombstones"],
): CollectionData<T> {
  const result = new Map<DocumentId, StandardSchemaV1.InferOutput<T>>();
  for (const [id, doc] of Object.entries(documents)) {
    if (!tombstones[id] && doc) {
      result.set(id, parseDocument(doc));
    }
  }
  return result;
}

function parseSnapshot(
  clock: Clock,
  documents: CollectionSnapshot["documents"],
  tombstones: CollectionSnapshot["tombstones"],
): CollectionSnapshot {
  return {
    clock,
    documents,
    tombstones,
  };
}

export function nowClock(): Clock {
  return { ms: Date.now(), seq: 0 };
}

function defineGetId<T extends AnyStandardObject>(
  config: CollectionConfig<T>,
): (data: StandardSchemaV1.InferOutput<T>) => DocumentId {
  return "getId" in config && config.getId ? config.getId : defaultGetId;
}

function defaultGetId<T extends AnyStandardObject>(
  data: StandardSchemaV1.InferOutput<T>,
): DocumentId {
  if (typeof data === "object" && data !== null && "id" in data) {
    return (data as { id: DocumentId }).id;
  }
  throw new Error(
    "Schema must have an 'id' property when getId is not provided",
  );
}
