import type { Clock } from "./clock";
import type { Tombstones } from "./tombstone";

// CONSTANTS
export const KEYS = { VAL: "~val", TS: "~ts" } as const;

export type Atom<T> = {
  [KEYS.VAL]: T;
  [KEYS.TS]: string;
};

type Fieldname = string;
export type DocumentId = string;

/**
 * Document with plain shape T. Each key K is stored as Atom<T[K]> (per-field).
 */
export type Document<T extends object = Record<Fieldname, unknown>> = {
  [K in keyof T]: Atom<T[K]>;
};

/**
 * Collection of documents with shape T. Map from DocumentId to Document<T>.
 */
export type Collection<T extends object = Record<Fieldname, unknown>> = Record<
  DocumentId,
  Document<T>
>;

/**
 * Collection state containing documents and tombstones.
 */
export type CollectionState<T extends object = Record<Fieldname, unknown>> = {
  documents: Collection<T>;
  tombstones: Tombstones;
};

/** Map of collection name → document shape (plain view). Use for State inference. */
export type StateSchema = Record<string, object>;

export type State<S extends StateSchema = Record<string, object>> = {
  [K in keyof S]: Collection<S[K]>;
};

export type StoreState = {
  clock: Clock;
  collections: Record<string, CollectionState>;
};
