import type { DocumentId, Tombstones } from "../core";

export function isDeleted(id: DocumentId, tombstones: Tombstones): boolean {
  return tombstones[id] !== undefined;
}
