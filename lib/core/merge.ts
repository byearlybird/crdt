import { Atomizer } from "./atomizer";
import { KEYS } from "./types";
import type { Document, Collection, DocumentId } from "./types";
import type { Tombstones } from "./tombstone";

/** Merges incoming doc fields into local. Adds new keys from incoming; LWW on conflicts. */
export function mergeDocs(local: Document<any>, incoming: Document<any>): Document<any> {
  const merged = { ...local } as Document<any>;
  let hasChanges = false;

  for (const key of Object.keys(incoming)) {
    const localAtom = local[key];
    const incomingAtom = incoming[key];
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

  return hasChanges ? merged : local;
}

/**
 * Merges two collections, respecting tombstones.
 * Documents that are tombstoned are excluded from the result.
 * For documents that exist in both collections, fields are merged using LWW semantics.
 */
export function mergeCollections<T extends object>(
  local: Collection<T>,
  incoming: Collection<T>,
  tombstones: Tombstones,
): Collection<T> {
  const mergedCollection: Record<DocumentId, Document<T>> = {};
  const allDocumentIds = new Set([...Object.keys(local), ...Object.keys(incoming)]);

  for (const id of allDocumentIds) {
    // Skip tombstoned documents
    if (tombstones[id]) {
      continue;
    }

    const localDoc = local[id];
    const incomingDoc = incoming[id];

    if (localDoc && incomingDoc) {
      // Both exist: merge documents
      mergedCollection[id] = mergeDocs(localDoc, incomingDoc) as Document<T>;
    } else if (localDoc) {
      // Only in local: keep it
      mergedCollection[id] = localDoc;
    } else if (incomingDoc) {
      // Only in incoming: keep it
      mergedCollection[id] = incomingDoc;
    }
  }

  return mergedCollection;
}
