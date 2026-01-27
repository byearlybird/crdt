import { Atomizer } from "./atomizer";
import { KEYS } from "./types";
import type { Atom, AtomizedDocument, Document, CollectionState } from "./types";
import { mergeTombstones } from "./tombstone";

/** Merges incoming doc fields into local. Adds new keys from incoming; LWW on conflicts. */
export function mergeDocs<T extends Document>(
  local: AtomizedDocument<T>,
  incoming: Partial<AtomizedDocument<T>>,
): AtomizedDocument<T> {
  const merged: Record<string, Atom<unknown>> = { ...local };
  let hasChanges = false;

  for (const key of Object.keys(incoming)) {
    const localAtom = local[key as keyof T];
    const incomingAtom = incoming[key as keyof T];
    if (incomingAtom === undefined) continue;

    if (!localAtom) {
      if (Atomizer.isAtom(incomingAtom)) {
        merged[key] = incomingAtom;
        hasChanges = true;
      }
      continue;
    }

    if (Atomizer.isAtom(localAtom) && Atomizer.isAtom(incomingAtom)) {
      if (incomingAtom[KEYS.TS] > localAtom[KEYS.TS]) {
        merged[key] = incomingAtom;
        hasChanges = true;
      }
    }
  }

  // Type assertion is safe: merged contains only keys from T with Atom<T[K]> values
  // We start with local (AtomizedDocument<T>) and only add/update valid atoms from incoming
  return (hasChanges ? merged : local) as AtomizedDocument<T>;
}

/**
 * Merges two collection states, respecting tombstones.
 * Documents that are tombstoned are excluded from the result.
 * For documents that exist in both collections, fields are merged using LWW semantics.
 */
export function mergeCollections<T extends Document>(
  local: CollectionState<T>,
  incoming: CollectionState<T>,
): CollectionState<T> {
  const mergedTombstones = mergeTombstones(local.tombstones, incoming.tombstones);
  const mergedCollection: Record<string, AtomizedDocument<T>> = {};
  const allDocumentIds = new Set([
    ...Object.keys(local.documents),
    ...Object.keys(incoming.documents),
  ]);

  for (const id of allDocumentIds) {
    // Skip tombstoned documents
    if (mergedTombstones[id]) {
      continue;
    }

    const localDoc = local.documents[id];
    const incomingDoc = incoming.documents[id];

    if (localDoc && incomingDoc) {
      // Both exist: merge documents
      mergedCollection[id] = mergeDocs(localDoc, incomingDoc);
    } else if (localDoc) {
      // Only in local: keep it
      mergedCollection[id] = localDoc;
    } else if (incomingDoc) {
      // Only in incoming: keep it
      mergedCollection[id] = incomingDoc;
    }
  }

  return {
    documents: mergedCollection,
    tombstones: mergedTombstones,
  };
}
