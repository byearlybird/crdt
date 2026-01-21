import { parseDocument, type DocumentId } from "../core";
import type { Document } from "../core/document";
import type { AnyObject, CollectionConfig, Output } from "./schema";
import type { Tombstones } from "../core/tombstone";

export function isDeleted(id: DocumentId, tombstones: Tombstones): boolean {
  return tombstones[id] !== undefined;
}

export type HandleCache = Record<string, unknown>;

/**
 * Creates a Proxy that lazily initializes collection handles on first access.
 * Used by both transactions and read operations.
 */
export function createHandleProxy<T>(
  configs: Map<string, CollectionConfig<AnyObject>>,
  accessed: Set<string>,
  handleCache: HandleCache,
  onAccess: (collectionName: string) => void,
): T {
  return new Proxy({} as T, {
    get(_target, prop: string | symbol) {
      if (typeof prop !== "string") {
        return undefined;
      }

      if (!configs.has(prop)) {
        throw new Error(`Collection "${prop}" not found`);
      }

      if (!accessed.has(prop)) {
        onAccess(prop);
      }

      return handleCache[prop];
    },
  });
}

export function createReadHandle<C extends CollectionConfig<AnyObject>>(
  documents: Record<DocumentId, Document>,
  tombstones: Tombstones,
) {
  return {
    get(id: DocumentId) {
      if (isDeleted(id, tombstones)) return undefined;
      const document = documents[id];
      if (!document) return undefined;
      return parseDocument<Output<C["schema"]>>(document);
    },

    list() {
      const results: Output<C["schema"]>[] = [];
      for (const [id, document] of Object.entries(documents)) {
        if (document && !isDeleted(id, tombstones)) {
          results.push(parseDocument<Output<C["schema"]>>(document));
        }
      }
      return results;
    },
  };
}

export function getCollectionConfig(
  collectionName: string,
  configs: Map<string, CollectionConfig<AnyObject>>,
): CollectionConfig<AnyObject> {
  const config = configs.get(collectionName);
  if (!config) {
    throw new Error(`Collection "${collectionName}" not found`);
  }
  return config;
}

export function getCollectionDocuments(
  collectionName: string,
  documents: Record<string, Record<DocumentId, Document>>,
): Record<DocumentId, Document> {
  const collectionDocs = documents[collectionName];
  if (!collectionDocs) {
    throw new Error(`Collection "${collectionName}" not found`);
  }
  return collectionDocs;
}
