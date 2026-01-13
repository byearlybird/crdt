# Storage Adapter API Proposal

## Overview

This proposal introduces a storage adapter pattern to Starling, enabling persistent storage backends like IndexedDB, SQLite, or remote sync servers. All operations become async, and the API is designed for correctness and flexibility from day one.

## Core Interface

See `lib/storage/adapter.ts` for the complete interface definition.

### Key Design Principles

1. **Fully Async** - All operations return Promises (required for IndexedDB, works for everything else)
2. **Granular + Bulk** - Supports both single-document operations (efficient) and full collection operations (sync)
3. **Transaction Support** - Atomic multi-operation updates with rollback
4. **Backend Agnostic** - Works equally well for IndexedDB, SQLite, in-memory, or remote storage

## Adapter Operations

### Initialization
```typescript
const adapter = new IndexedDBAdapter({ collections: ["users", "notes"] });
const state = await adapter.initialize(); // Loads existing data
// state = { clock: { ms, seq }, collections: { users: {...}, notes: {...} } }
```

### Document Operations (Granular)
```typescript
// Single document CRUD
await adapter.setDocument("users", "alice", {
  name: { "~value": "Alice", "~stamp": "..." }
});
const doc = await adapter.getDocument("users", "alice");
await adapter.deleteDocument("users", "alice");

// Tombstones
await adapter.setTombstone("users", "alice", "deletion-stamp");
const tombstone = await adapter.getTombstone("users", "alice");
```

### Collection Operations (Bulk)
```typescript
// Get entire collection
const collection = await adapter.getCollection("users");
// collection = { documents: {...}, tombstones: {...} }

// Replace entire collection (for sync/merge)
await adapter.setCollection("users", newCollection);

// List all IDs (for iteration)
const ids = await adapter.getDocumentIds("users");
```

### Clock Operations
```typescript
const clock = await adapter.getClock();
await adapter.setClock({ ms: Date.now(), seq: 42 });
```

### Transactions (Atomic Updates)
```typescript
await adapter.transaction(async (tx) => {
  // Queue multiple operations - all succeed or all fail
  tx.setDocument("users", "alice", aliceDoc);
  tx.setDocument("users", "bob", bobDoc);
  tx.setTombstone("notes", "note-1", deletionStamp);
  tx.setClock(newClock);
  // Commits automatically on success, rolls back on error
});
```

### Cleanup
```typescript
await adapter.close(); // Release resources, close connections
```

## Store API Changes

The Store API becomes fully async:

### Before (Current)
```typescript
import { createStore } from "@byearlybird/starling";

const store = createStore({
  collections: {
    users: { schema: userSchema }
  }
});

// Synchronous operations
store.users.add({ id: "alice", name: "Alice" });
const user = store.users.get("alice");
store.users.update("alice", { name: "Alice Updated" });
store.users.remove("alice");
```

### After (With Storage Adapter)
```typescript
import { createStore } from "@byearlybird/starling";
import { IndexedDBAdapter } from "@byearlybird/starling/storage";

const store = await createStore({
  collections: {
    users: { schema: userSchema }
  },
  adapter: new IndexedDBAdapter({
    collections: ["users"]
  }),
});

// Async operations
await store.users.add({ id: "alice", name: "Alice" });
const user = await store.users.get("alice");
await store.users.update("alice", { name: "Alice Updated" });
await store.users.remove("alice");

// Cleanup
await store.close();
```

### Default Behavior (In-Memory)
```typescript
// If no adapter provided, uses in-memory storage (current behavior)
const store = await createStore({
  collections: {
    users: { schema: userSchema }
  }
  // adapter defaults to new MemoryAdapter()
});

// Still async for API consistency
await store.users.add({ id: "alice", name: "Alice" });
```

## Collection API Changes

All Collection methods become async:

### Mutations
```typescript
await collection.add(data);          // async
await collection.update(id, data);   // async
await collection.remove(id);         // async
await collection.merge(snapshot);    // async
```

### Queries
```typescript
const doc = await collection.get(id);      // async
const exists = await collection.has(id);   // async
const ids = await collection.keys();       // async
const docs = await collection.values();    // async
const entries = await collection.entries(); // async

// Size becomes a method
const count = await collection.size();     // async
```

### Iteration Pattern
```typescript
// Option 1: Get all and iterate
const users = await store.users.values();
for (const user of users) {
  console.log(user.name);
}

// Option 2: Get IDs then fetch individually (for large collections)
const ids = await store.users.keys();
for (const id of ids) {
  const user = await store.users.get(id);
  console.log(user.name);
}

// Option 3: Async iteration (future enhancement)
for await (const user of store.users) {
  console.log(user.name);
}
```

## Transaction API

For atomic multi-operation updates:

```typescript
// Execute multiple operations atomically
await store.transaction(async (tx) => {
  // All operations must succeed, or all are rolled back
  await tx.users.add({ id: "alice", name: "Alice" });
  await tx.users.add({ id: "bob", name: "Bob" });
  await tx.notes.add({ id: "note-1", userId: "alice", text: "Hello" });
});
```

## Sync/Merge Operations

```typescript
// Export snapshot (for syncing to remote)
const snapshot = await store.getSnapshot();
// snapshot = {
//   clock: { ms, seq },
//   collections: { users: {...}, notes: {...} }
// }

// Import snapshot (from remote sync)
await store.merge(remoteSnapshot);
// Merges using CRDT logic, updates storage
```

## Adapter Implementations

### Built-In Adapters

#### 1. MemoryAdapter (Default)
```typescript
import { MemoryAdapter } from "@byearlybird/starling/storage";

const adapter = new MemoryAdapter({
  collections: ["users"]
});
```
- In-memory storage (current behavior)
- Fast, no persistence
- Good for testing and development

#### 2. IndexedDBAdapter (Browser)
```typescript
import { IndexedDBAdapter } from "@byearlybird/starling/storage";

const adapter = new IndexedDBAdapter({
  collections: ["users", "notes"],
  dbName: "my-app", // Optional, defaults to "starling"
  version: 1,       // Optional, for migrations
});
```
- Browser-based persistent storage
- Survives page refreshes
- ~50MB default quota (can request more)
- Multi-tab support via BroadcastChannel (future)

#### 3. SQLiteAdapter (Node.js/Bun) - Future
```typescript
import { SQLiteAdapter } from "@byearlybird/starling/storage";

const adapter = new SQLiteAdapter({
  collections: ["users", "notes"],
  dbPath: "./data.db",
  library: "better-sqlite3", // or "bun:sqlite" or "@databases/sqlite"
});
```
- Server-side persistent storage
- File-based (easy backup/restore)
- Excellent performance
- ACID transactions
- Unlimited storage

### Custom Adapters

Users can implement custom adapters for:
- LocalStorage (simple key-value)
- Remote HTTP API (cloud sync)
- PouchDB / CouchDB
- AWS DynamoDB
- Google Cloud Firestore
- Custom database backends

Example:
```typescript
class CustomAdapter implements StorageAdapter {
  async initialize(): Promise<StorageState> {
    // Load from your backend
  }

  async getDocument(collection: string, id: string): Promise<Document | undefined> {
    // Fetch single document
  }

  async setDocument(collection: string, id: string, doc: Document): Promise<void> {
    // Save single document
  }

  // ... implement remaining methods
}

const store = await createStore({
  collections: { users: { schema } },
  adapter: new CustomAdapter(),
});
```

## Migration Strategy

### Breaking Changes

This is a **major version bump** (v2.0.0) with breaking changes:

1. ✅ `createStore()` becomes async
2. ✅ All Collection methods become async
3. ✅ `collection.size` becomes `collection.size()` method
4. ✅ Must call `await store.close()` for cleanup

### Migration Guide

```typescript
// v1.x (Before)
const store = createStore({ collections: { users: { schema } } });
store.users.add({ id: "alice", name: "Alice" });
const user = store.users.get("alice");
const count = store.users.size;

// v2.x (After)
const store = await createStore({ collections: { users: { schema } } });
await store.users.add({ id: "alice", name: "Alice" });
const user = await store.users.get("alice");
const count = await store.users.size();
await store.close(); // Important: cleanup
```

## Benefits

### For Users

1. **Persistence** - Data survives page refreshes (IndexedDB) or app restarts (SQLite)
2. **Scalability** - Don't need to keep all data in memory
3. **Flexibility** - Choose the right storage backend for your use case
4. **Offline-first** - Works without network connection
5. **Atomic operations** - Transaction support prevents inconsistent state

### For Library

1. **Clean architecture** - Clear separation of concerns
2. **Testability** - Easy to test with MemoryAdapter
3. **Extensibility** - Users can implement custom adapters
4. **Future-proof** - Can add new backends without changing core CRDT logic
5. **Performance** - Adapters can optimize for their backend (indexes, bulk operations, caching)

## Implementation Timeline

1. **Phase 1** - Adapter interface + MemoryAdapter (1 week)
2. **Phase 2** - Update Store/Collection to use adapter (1 week)
3. **Phase 3** - IndexedDBAdapter implementation (1-2 weeks)
4. **Phase 4** - Testing, error handling, documentation (1 week)
5. **Phase 5** - SQLiteAdapter (future, 1-2 weeks)

Total: 4-6 weeks for IndexedDB support

## Open Questions

### 1. Event Timing
When should `onChange` events fire?

**Option A**: After storage write completes
```typescript
await store.users.add(data); // Returns after storage write
// onChange event already fired
```

**Option B**: Before storage write completes (optimistic)
```typescript
await store.users.add(data); // onChange fires immediately, storage write continues
// Returns after storage write
```

**Recommendation**: Option A (fire after storage) for consistency guarantees

### 2. Error Handling
What happens when storage writes fail?

**Option A**: Throw error, don't update in-memory state
```typescript
try {
  await store.users.add(data);
} catch (err) {
  // Storage failed, state unchanged
}
```

**Option B**: Update in-memory, provide error callback
```typescript
const store = await createStore({
  adapter,
  onStorageError: (err) => console.error("Storage failed:", err),
});
await store.users.add(data); // Always succeeds in-memory
// Storage error reported to callback
```

**Recommendation**: Option A (throw on error) for correctness

### 3. Caching Layer
Should we add an optional in-memory cache?

```typescript
const store = await createStore({
  adapter,
  cache: {
    enabled: true,
    maxDocuments: 1000, // LRU cache
  }
});

// First call: loads from storage
await store.users.get("alice"); // Cache miss

// Second call: returns from cache
await store.users.get("alice"); // Cache hit
```

**Recommendation**: Not for v1, but design should allow it

## Conclusion

This proposal provides a clean, fully async API that:
- ✅ Works seamlessly with IndexedDB (async, transactions)
- ✅ Works perfectly with SQLite (async wrapper, transactions)
- ✅ Maintains in-memory performance (MemoryAdapter)
- ✅ Enables custom adapters (remote sync, etc.)
- ✅ Provides transaction support for consistency
- ✅ Future-proof for new backends

The API is straightforward to implement and use, with clear semantics and strong guarantees.
