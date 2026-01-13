// ============================================================================
// Manual Caching Patterns for Vanilla JS Observables
// ============================================================================

import type { DocumentId } from "./lib/core/document";
import type { Collection } from "./lib/core/collection";
import { parseCollection } from "./lib/core/collection";
import { makeDocument } from "./lib/core/document";

type CollectionState = {
  documents: Collection["documents"];
  tombstones: Collection["tombstones"];
};

// ============================================================================
// APPROACH 1: Eager Cache (Recompute Immediately on Change)
// ============================================================================
// Pro: getData() is always instant, cache is always fresh
// Con: Recomputes even if nobody is listening or reading

export function createCollection_EagerCache<T>(config: any, clock: any) {
  let state: CollectionState = { documents: {}, tombstones: {} };

  // Cache storage
  let cachedData: ReadonlyMap<DocumentId, T> = new Map();
  let cachedSnapshot: Collection = { documents: {}, tombstones: {} };

  // Recompute cache immediately
  const recompute = () => {
    cachedData = parseCollection<T>(state.documents, state.tombstones);
    cachedSnapshot = { documents: state.documents, tombstones: state.tombstones };
  };

  // Initialize cache
  recompute();

  const dataListeners = new Set<(data: ReadonlyMap<DocumentId, T>) => void>();
  const snapshotListeners = new Set<(snapshot: Collection) => void>();

  const notifyAll = () => {
    recompute(); // ← Recompute BEFORE notifying
    dataListeners.forEach(listener => listener(cachedData));
    snapshotListeners.forEach(listener => listener(cachedSnapshot));
  };

  return {
    // Always returns fresh cached value - instant!
    getData: () => cachedData,
    getSnapshot: () => cachedSnapshot,

    add(item: any) {
      const doc = makeDocument(item, clock.tick());
      state = {
        ...state,
        documents: { ...state.documents, [item.id]: doc }
      };
      notifyAll(); // Recomputes inside here
    },

    onDataChange: (listener: (data: ReadonlyMap<DocumentId, T>) => void) => {
      listener(cachedData); // Use cache
      dataListeners.add(listener);
      return () => dataListeners.delete(listener);
    },

    onSnapshotChange: (listener: (snapshot: Collection) => void) => {
      listener(cachedSnapshot); // Use cache
      snapshotListeners.add(listener);
      return () => snapshotListeners.delete(listener);
    },
  };
}


// ============================================================================
// APPROACH 2: Lazy Cache (Recompute Only When Accessed)
// ============================================================================
// Pro: No wasted computation if nobody reads the data
// Con: First access after change has recomputation cost

export function createCollection_LazyCache<T>(config: any, clock: any) {
  let state: CollectionState = { documents: {}, tombstones: {} };

  // Cache storage
  let cachedData: ReadonlyMap<DocumentId, T> | null = null;
  let cachedSnapshot: Collection | null = null;
  let dirty = true; // ← Track if cache needs refresh

  const dataListeners = new Set<(data: ReadonlyMap<DocumentId, T>) => void>();
  const snapshotListeners = new Set<(snapshot: Collection) => void>();

  const invalidateCache = () => {
    dirty = true;
    cachedData = null;
    cachedSnapshot = null;
  };

  const ensureFreshCache = () => {
    if (dirty) {
      cachedData = parseCollection<T>(state.documents, state.tombstones);
      cachedSnapshot = { documents: state.documents, tombstones: state.tombstones };
      dirty = false;
    }
  };

  const notifyAll = () => {
    invalidateCache(); // Just mark dirty

    // But recompute for listeners (they need the value now)
    ensureFreshCache();
    dataListeners.forEach(listener => listener(cachedData!));
    snapshotListeners.forEach(listener => listener(cachedSnapshot!));
  };

  return {
    // Recomputes on first access after invalidation
    getData: () => {
      ensureFreshCache();
      return cachedData!;
    },

    getSnapshot: () => {
      ensureFreshCache();
      return cachedSnapshot!;
    },

    add(item: any) {
      const doc = makeDocument(item, clock.tick());
      state = {
        ...state,
        documents: { ...state.documents, [item.id]: doc }
      };
      notifyAll();
    },

    onDataChange: (listener: (data: ReadonlyMap<DocumentId, T>) => void) => {
      ensureFreshCache();
      listener(cachedData!);
      dataListeners.add(listener);
      return () => dataListeners.delete(listener);
    },

    onSnapshotChange: (listener: (snapshot: Collection) => void) => {
      ensureFreshCache();
      listener(cachedSnapshot!);
      snapshotListeners.add(listener);
      return () => snapshotListeners.delete(listener);
    },
  };
}


// ============================================================================
// APPROACH 3: Separate Caches (More Granular)
// ============================================================================
// Pro: Can invalidate data and snapshot independently
// Con: More code, only useful if they're computed differently

export function createCollection_SeparateCaches<T>(config: any, clock: any) {
  let state: CollectionState = { documents: {}, tombstones: {} };

  // Separate cache for each derived value
  let cachedData: ReadonlyMap<DocumentId, T> | null = null;
  let dataDirty = true;

  let cachedSnapshot: Collection | null = null;
  let snapshotDirty = true;

  const dataListeners = new Set<(data: ReadonlyMap<DocumentId, T>) => void>();
  const snapshotListeners = new Set<(snapshot: Collection) => void>();

  const notifyAll = () => {
    // Mark both caches dirty
    dataDirty = true;
    snapshotDirty = true;
    cachedData = null;
    cachedSnapshot = null;

    // Recompute only what listeners need
    if (dataListeners.size > 0) {
      cachedData = parseCollection<T>(state.documents, state.tombstones);
      dataDirty = false;
      dataListeners.forEach(listener => listener(cachedData!));
    }

    if (snapshotListeners.size > 0) {
      cachedSnapshot = { documents: state.documents, tombstones: state.tombstones };
      snapshotDirty = false;
      snapshotListeners.forEach(listener => listener(cachedSnapshot!));
    }
  };

  return {
    getData: () => {
      if (dataDirty || !cachedData) {
        cachedData = parseCollection<T>(state.documents, state.tombstones);
        dataDirty = false;
      }
      return cachedData;
    },

    getSnapshot: () => {
      if (snapshotDirty || !cachedSnapshot) {
        cachedSnapshot = { documents: state.documents, tombstones: state.tombstones };
        snapshotDirty = false;
      }
      return cachedSnapshot;
    },

    add(item: any) {
      const doc = makeDocument(item, clock.tick());
      state = {
        ...state,
        documents: { ...state.documents, [item.id]: doc }
      };
      notifyAll();
    },

    onDataChange: (listener: (data: ReadonlyMap<DocumentId, T>) => void) => {
      listener(this.getData()); // Uses cached version
      dataListeners.add(listener);
      return () => dataListeners.delete(listener);
    },

    onSnapshotChange: (listener: (snapshot: Collection) => void) => {
      listener(this.getSnapshot()); // Uses cached version
      snapshotListeners.add(listener);
      return () => snapshotListeners.delete(listener);
    },
  };
}


// ============================================================================
// APPROACH 4: Hybrid with Smarter Notifications (RECOMMENDED)
// ============================================================================
// Pro: Best balance - lazy cache but eager notification
// Con: Slightly more complex logic

export function createCollection_Hybrid<T>(config: any, clock: any) {
  let state: CollectionState = { documents: {}, tombstones: {} };

  let cachedData: ReadonlyMap<DocumentId, T> | null = null;
  let cachedSnapshot: Collection | null = null;
  let dirty = true;

  const dataListeners = new Set<(data: ReadonlyMap<DocumentId, T>) => void>();
  const snapshotListeners = new Set<(snapshot: Collection) => void>();

  const recomputeData = () => {
    if (cachedData === null || dirty) {
      cachedData = parseCollection<T>(state.documents, state.tombstones);
    }
    return cachedData;
  };

  const recomputeSnapshot = () => {
    if (cachedSnapshot === null || dirty) {
      cachedSnapshot = { documents: state.documents, tombstones: state.tombstones };
    }
    return cachedSnapshot;
  };

  const notifyAll = () => {
    dirty = true;

    // Only recompute what's actually being observed
    if (dataListeners.size > 0) {
      const data = recomputeData();
      dataListeners.forEach(listener => listener(data));
    }

    if (snapshotListeners.size > 0) {
      const snapshot = recomputeSnapshot();
      snapshotListeners.forEach(listener => listener(snapshot));
    }

    // After notifying, mark as clean (but keep cache for getData/getSnapshot calls)
    dirty = false;
  };

  return {
    // Lazy - only recomputes if dirty or cache is null
    getData: () => recomputeData(),
    getSnapshot: () => recomputeSnapshot(),

    add(item: any) {
      const doc = makeDocument(item, clock.tick());
      state = {
        ...state,
        documents: { ...state.documents, [item.id]: doc }
      };
      notifyAll();
    },

    onDataChange: (listener: (data: ReadonlyMap<DocumentId, T>) => void) => {
      listener(recomputeData());
      dataListeners.add(listener);
      return () => dataListeners.delete(listener);
    },

    onSnapshotChange: (listener: (snapshot: Collection) => void) => {
      listener(recomputeSnapshot());
      snapshotListeners.add(listener);
      return () => snapshotListeners.delete(listener);
    },
  };
}


// ============================================================================
// COMPARISON: Performance Characteristics
// ============================================================================

/*
┌─────────────────┬──────────────────┬──────────────────┬────────────────────┐
│ Approach        │ getData() Cost   │ Mutation Cost    │ Best For           │
├─────────────────┼──────────────────┼──────────────────┼────────────────────┤
│ No Cache        │ O(n) always      │ O(1)             │ Rarely read data   │
│ Eager Cache     │ O(1) always      │ O(n)             │ Frequent reads     │
│ Lazy Cache      │ O(n) if dirty    │ O(1)             │ Infrequent reads   │
│ Separate Cache  │ O(n) if dirty    │ O(1)             │ Complex derived    │
│ Hybrid          │ O(n) if dirty    │ O(k) k=listeners │ Balanced (⭐ best) │
└─────────────────┴──────────────────┴──────────────────┴────────────────────┘

Legend:
- n = number of documents in collection
- k = number of active listeners

Notes:
- parseCollection() is typically O(n) where n = number of documents
- Eager recomputes even if no listeners → wasteful
- Lazy is best if getData() is called rarely
- Hybrid only recomputes if someone is watching → optimal
*/


// ============================================================================
// USAGE EXAMPLE
// ============================================================================

/*
// All approaches have the same API:

const collection = createCollection_Hybrid(config, clock);

// Reading (instant if cached)
const data = collection.getData();
console.log(data.size);

// Mutating (invalidates cache)
collection.add({ id: "1", name: "Alice" });

// Subscribing (gets cached value immediately)
const unsub = collection.onDataChange(data => {
  console.log("Data changed:", data.size);
});

// Behind the scenes:
// 1. add() marks cache as dirty
// 2. onDataChange listeners get recomputed value
// 3. Subsequent getData() calls reuse cache until next mutation
*/
