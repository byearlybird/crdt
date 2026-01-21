import type { Document } from "./document";
import type { Tombstones } from "./tombstone";
import { mergeDocuments } from "./document";

export type DocumentId = string;

export type Collection = Record<DocumentId, Document>;

export function mergeCollections(
  target: Collection,
  source: Collection,
  tombstones: Tombstones,
): Collection {
  const mergedCollection: Record<DocumentId, Document> = {};
  const allDocumentIds = new Set([...Object.keys(target), ...Object.keys(source)]);

  for (const id of allDocumentIds) {
    const targetDoc = target[id];
    const sourceDoc = source[id];

    if (tombstones[id]) {
      continue;
    }

    if (targetDoc && sourceDoc) {
      mergedCollection[id] = mergeDocuments(targetDoc, sourceDoc);
    } else if (targetDoc) {
      mergedCollection[id] = targetDoc;
    } else if (sourceDoc) {
      mergedCollection[id] = sourceDoc;
    }
  }

  return mergedCollection;
}
export function mergeCollectionRecords(
  target: Record<string, Collection>,
  source: Record<string, Collection>,
  tombstones: Tombstones,
): Record<string, Collection> {
  const result: Record<string, Collection> = { ...target };

  for (const [collectionName, sourceCollection] of Object.entries(source)) {
    const targetCollection = result[collectionName];
    if (targetCollection) {
      result[collectionName] = mergeCollections(targetCollection, sourceCollection, tombstones);
    } else {
      result[collectionName] = sourceCollection;
    }
  }

  return result;
}
