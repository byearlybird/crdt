import type { Clock } from "./clock";
import { advanceClock } from "./clock";
import type { DocumentId } from "./collection";
import type { Collection } from "../core-two";
import { mergeCollections } from "../core-two";
import type { Tombstones } from "./tombstone";
import { mergeTombstones } from "./tombstone";

export type StoreState = {
  clock: Clock;
  collections: Record<string, Collection>;
  tombstones: Tombstones;
};

export type CollectionDiff = {
  added: DocumentId[]; // IDs new to local
  updated: DocumentId[]; // IDs that existed in both (merged)
  removed: DocumentId[]; // IDs tombstoned by remote
};

export type SnapshotDiff = {
  collections: Record<string, CollectionDiff>;
};

export type MergeResult = {
  merged: StoreState;
  diff: SnapshotDiff;
};

export function mergeSnapshots(local: StoreState, remote: StoreState): MergeResult {
  // Merge clocks
  const mergedClock = advanceClock(local.clock, remote.clock);

  // Merge tombstones
  const mergedTombstones = mergeTombstones(local.tombstones, remote.tombstones);

  // Merge collections and compute diff
  const mergedCollections: Record<string, Collection> = {};
  const diff: SnapshotDiff = { collections: {} };

  const allCollectionNames = new Set([
    ...Object.keys(local.collections),
    ...Object.keys(remote.collections),
  ]);

  for (const name of allCollectionNames) {
    const localCollection = local.collections[name] ?? {};
    const remoteCollection = remote.collections[name] ?? {};

    // Filter remote by merged tombstones (documents that are tombstoned shouldn't be added)
    const filteredRemote: Collection = {};
    for (const [id, doc] of Object.entries(remoteCollection)) {
      if (!mergedTombstones[id]) {
        filteredRemote[id] = doc;
      }
    }

    // Merge collections
    const mergedCollection = mergeCollections(localCollection, filteredRemote, mergedTombstones);
    mergedCollections[name] = mergedCollection;

    // Compute diff
    const added: DocumentId[] = [];
    const updated: DocumentId[] = [];
    const removed: DocumentId[] = [];

    // Get live (non-tombstoned) document IDs from local
    const localLive = new Set<DocumentId>();
    for (const id of Object.keys(localCollection)) {
      if (!local.tombstones[id]) {
        localLive.add(id);
      }
    }

    // Get live document IDs from merged result
    const mergedLive = new Set<DocumentId>();
    for (const id of Object.keys(mergedCollection)) {
      if (!mergedTombstones[id]) {
        mergedLive.add(id);
      }
    }

    // Documents in remote that weren't in local (after filtering tombstones)
    for (const id of Object.keys(filteredRemote)) {
      if (!localLive.has(id)) {
        added.push(id);
      }
    }

    // Documents that existed in both local and remote (merged)
    for (const id of Object.keys(filteredRemote)) {
      if (localLive.has(id)) {
        updated.push(id);
      }
    }

    // Documents that were in local but are now tombstoned by remote
    for (const id of localLive) {
      if (!mergedLive.has(id)) {
        removed.push(id);
      }
    }

    // Only include collection in diff if there are changes
    if (added.length > 0 || updated.length > 0 || removed.length > 0) {
      diff.collections[name] = { added, updated, removed };
    }
  }

  return {
    merged: {
      clock: mergedClock,
      collections: mergedCollections,
      tombstones: mergedTombstones,
    },
    diff,
  };
}
