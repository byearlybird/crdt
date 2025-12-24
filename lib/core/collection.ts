import type { Document } from "./document";
import type { Tombstones } from "./tombstone";
import { mergeDocuments } from "./document";
import { mergeTombstones } from "./tombstone";

export type DocumentId = string;

export type Collection = {
  documents: Record<DocumentId, Document>;
  tombstones: Tombstones;
};

export function mergeCollections(
  target: Collection,
  source: Collection,
): Collection {
  const mergedTombstones = mergeTombstones(
    target.tombstones,
    source.tombstones,
  );

  const mergedDocuments: Record<DocumentId, Document> = {};
  const allDocumentIds = new Set([
    ...Object.keys(target.documents),
    ...Object.keys(source.documents),
  ]);

  for (const id of allDocumentIds) {
    const targetDoc = target.documents[id];
    const sourceDoc = source.documents[id];

    if (mergedTombstones[id]) {
      continue;
    }

    if (targetDoc && sourceDoc) {
      mergedDocuments[id] = mergeDocuments(targetDoc, sourceDoc);
    } else if (targetDoc) {
      mergedDocuments[id] = targetDoc;
    } else if (sourceDoc) {
      mergedDocuments[id] = sourceDoc;
    }
  }

  return {
    documents: mergedDocuments,
    tombstones: mergedTombstones,
  };
}
export function mergeCollectionRecords(
  target: Record<string, Collection>,
  source: Record<string, Collection>,
): Record<string, Collection> {
  const result: Record<string, Collection> = { ...target };

  for (const [collectionName, sourceCollection] of Object.entries(source)) {
    const targetCollection = result[collectionName];
    if (targetCollection) {
      result[collectionName] = mergeCollections(
        targetCollection,
        sourceCollection,
      );
    } else {
      result[collectionName] = sourceCollection;
    }
  }

  return result;
}
