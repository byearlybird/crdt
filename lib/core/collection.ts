import type { Clock } from "./clock";
import type { Document } from "./document";
import type { Tombstones } from "./tombstone";
import { advanceClock } from "./clock";
import { mergeDocuments } from "./document";
import { mergeTombstones } from "./tombstone";

export type DocumentId = string;

export type CollectionSnapshot = {
  clock: Clock;
  documents: Record<DocumentId, Document>;
  tombstones: Tombstones;
};

/**
 * Merges two CollectionSnapshots
 * - Clocks are merged by advancing the target clock with the source clock
 * - Documents are merged by document ID, using mergeDocuments when both exist
 * - Tombstones are merged using mergeTombstones
 * - Documents that are tombstoned are removed from the final documents
 * @param target - The target snapshot to merge into
 * @param source - The source snapshot to merge from
 * @returns The merged snapshot
 */
export function mergeCollections(
  target: CollectionSnapshot,
  source: CollectionSnapshot,
): CollectionSnapshot {
  // Merge clocks by advancing target with source
  const mergedClock = advanceClock(target.clock, source.clock);

  // Merge tombstones
  const mergedTombstones = mergeTombstones(
    target.tombstones,
    source.tombstones,
  );

  // Merge documents
  const mergedDocuments: Record<DocumentId, Document> = {};
  const allDocumentIds = new Set([
    ...Object.keys(target.documents),
    ...Object.keys(source.documents),
  ]);

  for (const id of allDocumentIds) {
    const targetDoc = target.documents[id];
    const sourceDoc = source.documents[id];

    // Skip if tombstoned
    if (mergedTombstones[id]) {
      continue;
    }

    if (targetDoc && sourceDoc) {
      // Both exist, merge them
      mergedDocuments[id] = mergeDocuments(targetDoc, sourceDoc);
    } else if (sourceDoc || targetDoc) {
      // Only one exists, keep it
      mergedDocuments[id] = (sourceDoc ?? targetDoc)!;
    }
  }

  return {
    clock: mergedClock,
    documents: mergedDocuments,
    tombstones: mergedTombstones,
  };
}
