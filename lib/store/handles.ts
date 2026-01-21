import { parseDocument, type DocumentId } from "../core";
import type { Document } from "../core/document";
import type { AnyObject, CollectionConfig, Output } from "./schema";
import type { Tombstones } from "../core/tombstone";

export function isDeleted(id: DocumentId, tombstones: Tombstones): boolean {
  return tombstones[id] !== undefined;
}

/**
 * Creates a Proxy that lazily initializes collection handles on first access.
 * Used by transactions.
 */
export function createHandleProxy<T>(
  configs: Map<string, CollectionConfig<AnyObject>>,
  onAccess: (collectionName: string, target: any) => void,
): T {
  const target = {} as any;
  return new Proxy(target, {
    get(target, prop: string | symbol) {
      if (typeof prop !== "string") {
        return undefined;
      }

      if (!configs.has(prop)) {
        throw new Error(`Collection "${prop}" not found`);
      }

      if (!(prop in target)) {
        onAccess(prop, target);
      }

      return target[prop];
    },
  });
}

export function getCollectionConfig(
  collectionName: string,
  configs: Map<string, CollectionConfig<AnyObject>>,
): CollectionConfig<AnyObject> {
  // Safe to use non-null assertion: createHandleProxy already validates collection exists
  return configs.get(collectionName)!;
}

export function getCollectionDocuments(
  collectionName: string,
  documents: Record<string, Record<DocumentId, Document>>,
): Record<DocumentId, Document> {
  // Safe to use non-null assertion: createHandleProxy already validates collection exists
  return documents[collectionName]!;
}
