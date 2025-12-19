# Starling Architecture

Status: Draft

This document covers the design and internals of Starling, including the state-based Last-Write-Wins merge strategy, eventstamps, the event system, and module organization.

## Repository Layout

| Path | Description |
| --- | --- |
| `packages/starling` | Consolidated package containing core primitives, store layer, and plugins |
| `packages/starling/src/core` | Core CRDT primitives (`StarlingDocument`, `ResourceObject`, `createClock`) for state-based replication |
| `packages/starling/src/store` | Database utilities with typed collections, transactions, and mutation events |
| `packages/starling/src/plugins` | Plugin implementations (IDB, HTTP) for persistence and sync |

**Key points:**

- Follows a Functional Core, Imperative Shell design—core primitives stay predictable while adapters handle IO, frameworks, and persistence.
- Core logic lives under `src/core/` and provides minimal CRDT primitives for document merging and resource management.
- Higher-level database features (collections, transactions, mutation events) live in `src/store/`.
- Plugins for persistence and sync live in `src/plugins/`.
- The package is bundled as a TypeScript module via `tsdown` with four entry points (main, core, plugin-idb, plugin-http).
- Tests live alongside implementation: `packages/starling/src/**/*.test.ts`.

## Eventstamps

Eventstamps power Starling's conflict resolution. Each value is stamped with:

```
YYYY-MM-DDTHH:mm:ss.SSSZ|hexCounter|hexNonce
```

Example: `2025-10-26T10:00:00.000Z|0001|a7f2`

### How They Work

**Monotonic ordering**: The hex counter increments whenever the OS clock stalls (same millisecond) or goes backward. The nonce is a random 4-character hex value that serves as a final tie-breaker, ensuring every write gets a unique, sortable stamp even when timestamp and counter are identical.

**Clock forwarding**: When a client receives a remote eventstamp newer than its local clock, it fast-forwards to that time. This keeps clocks loosely synchronized across devices without requiring a time server.

**Last-Write-Wins**: During merge, the field with the higher eventstamp wins. If Client A writes `name: "Alice"` at `T1` and Client B writes `name: "Bob"` at `T2`, Bob's value persists because `T2 > T1`.

### Design Characteristics

This approach provides predictable, deterministic merging:

**Automatic conflict resolution**: No merge callbacks or conflict detection needed—the newest write always wins. This makes reasoning about state simple and keeps the mental model lightweight.

**Self-synchronizing clocks**: When devices observe newer remote eventstamps, they fast-forward their local clocks. This loosely synchronizes devices without requiring a time server or coordination protocol.

**Graceful clock handling**: The hex counter ensures monotonicity even when system clocks stall, drift backward, or multiple writes happen in the same millisecond.

**Boundaries to consider:**

For apps where devices sync regularly (personal tools, small teams), wall-clock-based ordering works well. However:

- **Clock skew influences merge outcomes**: A device with a clock running ahead will have its writes prevail over logically newer writes from devices with accurate clocks. In practice, modern devices maintain reasonable clock accuracy via NTP.

- **No explicit causality**: Starling tracks time-based ordering but doesn't capture "happened-before" relationships. Concurrent edits rely on timestamp comparison rather than causal dependencies.

- **Requires eventstamp persistence**: Devices must save the highest eventstamp they've seen to prevent clock regression after restarts. External persistence solutions should handle this automatically.

## State-Based Merging

Starling uses **state-based replication**: it syncs full document snapshots, not operation logs. When merging states, Starling compares eventstamps at the field level:

```typescript
// Client A's state
{
  name: ["Alice", "2025-10-26T10:00:00.000Z|0001|a7f2"],
  email: ["alice@old.com", "2025-10-26T10:00:00.000Z|0001|a7f2"]
}

// Client B's state (newer eventstamp for email only)
{
  email: ["alice@new.com", "2025-10-26T10:05:00.000Z|0001|b3d4"]
}

// Merged result: email wins due to higher eventstamp, name preserved from Client A
{
  name: ["Alice", "2025-10-26T10:00:00.000Z|0001|a7f2"],
  email: ["alice@new.com", "2025-10-26T10:05:00.000Z|0001|b3d4"]
}
```

**Why state-based?**

State-based replication keeps the implementation focused and efficient:

- **Simple to reason about**: Syncing is just "send current state, merge on arrival"—no operation logs to manage
- **Small codebase**: Eliminates transformation functions, causality tracking, and replay logic
- **Merge idempotency**: Applying the same state multiple times produces the same result—natural retry safety
- **Works everywhere**: Any transport that can move JSON works—HTTP, WebSocket, filesystem, USB stick

**Current implementation**: Starling ships entire snapshots over the wire. Delta-style helpers could be added later, but the merge model stays state-based.

### Merge Behavior

**Objects**: Merge recursively at the field level. Each nested field carries its own eventstamp, enabling fine-grained conflict resolution:

```typescript
// Both clients edit different fields simultaneously
Client A: { name: "Alice Smith" }  // Updates name
Client B: { email: "alice@new.com" }  // Updates email

// Both changes preserved
Merged: { name: "Alice Smith", email: "alice@new.com" }
```

**Arrays**: Treated as atomic values—the entire array is replaced rather than merged element-by-element. This provides predictable behavior and avoids ambiguous merge scenarios. For collections that need concurrent edits, use keyed records:

```typescript
// Array (atomic replacement)
{ tags: ["work", "urgent"] }  // Entire array wins/loses as a unit

// Keyed record (field-level merging)
{ todos: { "id1": { text: "..." }, "id2": { text: "..." } } }  // Each todo merges independently
```

**Deletions**: Deleted resources are removed from the `resources` map and tracked in the `tombstones` map with their deletion eventstamp. Deletion is final—tombstones prevent resurrection during merge. This provides true data deletion for privacy compliance while ensuring deletion events propagate correctly during sync.

### Document Format

The `StarlingDocument` type represents the complete persistent state of a collection, containing a type identifier, latest eventstamp, and resources as a keyed object:

```typescript
export type StarlingDocument<T extends AnyObject> = {
  type: string;
  latest: string;
  resources: Record<string, ResourceObject<T>>;
  tombstones: Record<string, string>;
};
```

**Design notes:**

- **`type`**: Resource type identifier for this collection (e.g., "users", "todos", "posts")
- **`latest`**: The highest eventstamp observed by the document, including tombstone eventstamps. When merging documents, the clock forwards to the newest eventstamp to prevent collisions across sync boundaries
- **`resources`**: Object mapping resource IDs to ResourceObjects. Only contains active (non-deleted) resources
- **`tombstones`**: Object mapping deleted resource IDs to deletion eventstamps. Ensures deletion events propagate during sync and prevents resurrection of deleted resources

Example document:

```typescript
{
  type: "users",
  latest: "2025-10-26T10:00:00.000Z|0001|a7f2",
  resources: {
    "user-1": {
      id: "user-1",
      attributes: {
        name: "Alice",
        email: "alice@example.com"
      },
      meta: {
        eventstamps: {
          name: "2025-10-26T10:00:00.000Z|0001|a7f2",
          email: "2025-10-26T10:00:00.000Z|0001|a7f2"
        },
        latest: "2025-10-26T10:00:00.000Z|0001|a7f2"
      }
    }
  },
  tombstones: {
    "user-2": "2025-10-26T09:55:00.000Z|0001|b8c9"
  }
}
```

### Resource Object Format

Each resource in the `resources` object follows this structure:

```typescript
export type ResourceObject<T extends AnyObject> = {
  id: string;
  attributes: T;
  meta: {
    eventstamps: Record<string, string>;
    latest: string;
  };
};
```

**Design notes:**

- **`id`**: Unique identifier for this resource
- **`attributes`**: The resource's data as a nested object structure (plain values, not wrapped)
- **`meta.eventstamps`**: Mirrored structure containing eventstamps for each attribute field
- **`meta.latest`**: The greatest eventstamp in this resource

Note: The resource type is stored at the document level (`StarlingDocument.type`), not on individual resources. Deletion state is tracked separately in the document's `tombstones` map.

### Merging Documents

The `mergeDocuments(into, from)` function handles document-level merging with automatic change detection using a 4-phase process:

1. **Merge tombstones**: Union both tombstone maps, using LWW on eventstamps for conflicts
2. **Remove tombstoned resources**: Filter out resources that have tombstones from the base document
3. **Merge active resources**: Each resource pair merges using `mergeResources`, preserving the newest eventstamp for each field. Resources with tombstones are skipped (deletion is final)
4. **Forward clock**: The resulting document's latest value is the maximum of all resource eventstamps and tombstone eventstamps
5. **Track changes**: Returns categorized changes (added, updated, deleted) for event notifications

**Deletion finality**: Once a resource has a tombstone, it will not be resurrected during merge, even if a remote document contains an updated version of the resource. This ensures deleted data stays deleted.

This design separates merge logic from higher-level store implementations, enabling independent testing and reuse of document operations.

### Database Snapshot Format

Starling uses store-level snapshots for persistence and sync operations. The `StoreSnapshot` type represents the complete state of a database:

```typescript
export type StoreSnapshot<Schemas> = {
  version: string;  // Snapshot format version (e.g., "1.0")
  name: string;     // Database name
  latest: string;   // Highest eventstamp across all collections
  collections: {
    [K in keyof Schemas]: StarlingDocument<InferOutput<Schemas[K]>>;
  };
};
```

**Design notes:**

- **`version`**: Snapshot format version for future compatibility checks
- **`name`**: Database name, used in HTTP plugin endpoints (`/database/:name`)
- **`latest`**: The maximum eventstamp across all collections, enabling global clock synchronization
- **`collections`**: Object mapping collection names to their StarlingDocuments

**Database-level operations:**

```typescript
// Export entire database
const snapshot = db.toSnapshot();

// Import/merge entire database (field-level LWW across all collections)
db.mergeSnapshot(remoteSnapshot);
```

**Benefits of store-level sync:**

- **Single unit of sync**: No coordination between collections needed
- **Atomic operations**: Save/load entire database in one operation
- **Simpler plugins**: IDB uses single snapshot store, HTTP uses single endpoint
- **Easy backup/restore**: One JSON blob contains everything

## Design Scope

Starling focuses on the 80/20 of sync for personal and small-team apps:

- Automatic convergence via field-level LWW so all replicas eventually agree.
- Simple mental model: “newest write wins” at each field.
- Small, embeddable core with no runtime dependencies.
- Works with any framework that can run JavaScript.

For real-time collaborative editing, strict causal ordering, or complex operational transforms, specialized CRDT libraries (for example, Automerge or Yjs) are usually a better fit. Starling can manage application state alongside those tools.

## Module Overview

Each module handles a distinct responsibility in the state-based replication model:

| Module | Responsibility |
| --- | --- |
| [`clock/clock.ts`](../packages/starling/src/core/clock/clock.ts) | Monotonic logical clock that increments a hex counter when the OS clock stalls, forwards itself when observing newer remote stamps, and exposes the shared clock used across resources and documents |
| [`clock/eventstamp.ts`](../packages/starling/src/core/clock/eventstamp.ts) | Encoder/decoder for sortable `YYYY-MM-DDTHH:mm:ss.SSSZ\|counter\|nonce` strings, comparison helpers, and utilities used by resources to apply Last-Write-Wins semantics |
| [`document/resource.ts`](../packages/starling/src/core/document/resource.ts) | Defines resource objects (`id`, `attributes`, `meta`), handles soft deletion, and merges field-level values with eventstamp comparisons |
| [`document/document.ts`](../packages/starling/src/core/document/document.ts) | Coordinates `StarlingDocument` creation and `mergeDocuments`, tracks added/updated/deleted resources, and keeps document metadata (latest eventstamp) synchronized |

### Data Flow

**Document merging:**
```
mergeDocuments(into, from) → Resource merge (mergeResources)
              ↓                              ↓
      Clock forwarding                 Field-level LWW
              ↓                              ↓
    Update meta.latest              Track changes (add/update/delete)
              ↓
    Return merged document + changes
```

## Package Exports

Starling ships as a single consolidated package with subpath exports.

### `@byearlybird/starling` (main export)

**Store layer exports:**

- Store: `createDatabase`, types `Database`, `DbConfig`, `StoreSnapshot`
- Collections: `Collection`, `CollectionHandle`, `CollectionConfig`
- Transactions and events: `TransactionContext`, `DatabaseMutationEvent`
- Schema utilities: `StandardSchemaV1`
- Re-exported core types: `StarlingDocument`, `AnyObject`

The main export provides typed collections with CRUD operations, transactions, mutation events, and store-level snapshot sync built on top of core primitives.

### `@byearlybird/starling/core` (core primitives)

**Core CRDT primitives exports:**

- Clocks: `createClock`, `createClockFromEventstamp`, `MIN_EVENTSTAMP`, `isValidEventstamp`
- Documents: `makeDocument`, `mergeDocuments`, types `StarlingDocument`, `AnyObject`, `DocumentChanges`, `MergeDocumentsResult`
- Resources: `makeResource`, `mergeResources`, `deleteResource`, type `ResourceObject`

These primitives implement state-based replication, document merging, resource management, and hybrid logical clocks.

### `@byearlybird/starling/plugin-idb` (IndexedDB plugin)

Provides `idbPlugin()` for IndexedDB persistence with cross-tab sync via BroadcastChannel API. Uses a single snapshot store for the entire database.

### `@byearlybird/starling/plugin-http` (HTTP plugin)

Provides `httpPlugin()` for HTTP-based sync with polling, debouncing, and retry logic. Uses endpoint `/database/:name` for fetching and pushing database snapshots.

## Testing Strategy

- **Unit tests**: Cover core modules (`clock`, `eventstamp`, `document`, `resource`)
- **Merge tests**: Verify field-level LWW behavior and document merging
- **Sync tests**: Verify merge behavior and state replication
- **Property-based tests**: Validate eventstamp monotonicity and merge commutativity

Tests live alongside implementation: `packages/starling/src/**/*.test.ts`
