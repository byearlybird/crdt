# Architecture Decision Log

This log captures accepted architecture decisions for Starling. Each entry summarizes the context, decision, rationale, and alternatives considered.

---

## Decision 001 — Key-Based Serialization

**Context**

Two serialization strategies for persisted and exported data were considered: key-based (object-style) and positional (array-style).

**Decision**

Adopt key-based serialization for all stored and exported data.

**Rationale**

Key-based serialization makes data self-documenting:

- **Human-readable**: Developers can inspect persisted payloads without decoding schemas
- **Tooling-friendly**: LLMs and automation scripts can parse exported data without position mappings
- **Evolution-ready**: Adding fields doesn't break existing parsers

**Alternatives Considered**

- **Array-based serialization** — Offers ~20-30% smaller payloads but requires schema documentation to interpret. The compact representation sacrifices debuggability and makes schema evolution brittle (adding a field shifts all subsequent positions).

---

## Decision 002 — Last-Write-Wins with Hybrid Logical Clock

**Context**

Starling needed a conflict resolution strategy that:
1. Works with plain JSON (no complex CRDT types)
2. Requires minimal per-field metadata
3. Provides deterministic outcomes across devices

**Decision**

Use Last-Write-Wins (LWW) at the field level, with eventstamps (wall clock + hex counter) providing monotonic ordering. Starling uses **state-based replication**—it ships document snapshots, not operation logs.

**Rationale**

This approach balances simplicity and correctness:

- **Simple mental model**: "Newest write wins" is easy to explain and reason about
- **State-based, not operation-based**: Syncing sends document state, not edit histories. This eliminates the need to track, store, and replay operation logs
- **Works with plain objects**: No special data types required—just add an eventstamp to each field
- **Handles clock stalls**: The hex counter increments when the wall clock doesn't advance, and a random nonce provides a final tie-breaker, effectively eliminating the risk of ties
- **Embeddable**: Minimal overhead (~34 bytes per field for the eventstamp)

**Trade-offs**

This design makes specific compromises:

1. **Clock skew affects outcomes**: If Client A's clock is 5 minutes ahead, its writes always win—even if they're logically older. This is acceptable for personal/small-team apps where devices sync regularly.

2. **Silent overwrites**: Concurrent edits to the same field result in one value winning. There's no "conflict detected" callback. Users must structure data to minimize collisions (e.g., keyed records instead of arrays).

3. **Eventstamp persistence required**: Each device must persist the highest eventstamp it's seen. Without this, a device coming back online with a stale clock could lose writes (the `unstorage` plugin handles this automatically).

**Alternatives Considered**

- **Operational Transformation (OT)** — An operation-based approach that provides intent-preserving merges (e.g., two users editing different parts of a text document). Requires complex transformation functions, operation logs, and causality tracking.

**When This Breaks Down**

LWW is insufficient for:
- **Real-time collaborative text editing** (use OT or CRDTs)
- **Distributed systems with high clock skew** (use vector clocks)
- **Scenarios requiring conflict detection** (use CRDTs with multi-value registers)

For these cases, we recommend libraries like [Automerge](https://automerge.org/), [Yjs](https://docs.yjs.dev/), or [Diamond Types](https://github.com/josephg/diamond-types).

---

## Decision 003 — Database-Level Snapshot Sync

**Context**

Two approaches were considered for sync and persistence:
1. Per-collection sync (each collection exported/merged independently)
2. Database-level sync (entire database exported/merged as a unit)

**Decision**

Use database-level snapshots for all sync and persistence operations. The `DatabaseSnapshot` type contains all collections and provides methods `db.toSnapshot()` and `db.mergeSnapshot()`.

**Rationale**

Database-level sync provides the simplest possible implementation:

- **Single unit of operation**: Save, load, and sync the entire database atomically
- **No coordination needed**: Collections don't need to sync independently or track separate states
- **Simpler plugins**: IDB uses one snapshot store instead of per-collection stores; HTTP uses one endpoint (`/database/:name`) instead of per-collection endpoints
- **~50% less plugin code**: Eliminates iteration, collection-level merge logic, and endpoint management
- **Trivial backup/restore**: One JSON blob contains complete database state
- **Easier to reason about**: "The database" is the sync boundary, not individual collections

**Implementation:**

```typescript
// Single export operation
const snapshot = db.toSnapshot();
await storage.save(snapshot);

// Single import/merge operation
const snapshot = await storage.load();
db.mergeSnapshot(snapshot);
```

**Trade-offs**

This design makes specific compromises:

1. **No partial sync**: Can't sync individual collections independently. For apps with large datasets split across collections, this means syncing everything or nothing.

2. **Larger payloads**: Full database snapshot is transferred even if only one collection changed. (Future optimization: delta compression could be added while keeping the snapshot-based model.)

3. **No collection-level access control**: Can't have different sync policies per collection (e.g., "sync tasks but not drafts").

**Alternatives Considered**

- **Per-collection sync** — Allows partial sync and collection-specific policies, but adds significant complexity:
  - Plugins must iterate collections and track state separately
  - Need coordination logic to handle collection dependencies
  - More complex HTTP API (`/database/:name/:collection`)
  - Additional per-collection metadata and merge logic

**When to Reconsider**

Database-level sync may become limiting if:
- Apps need to sync subsets of collections (e.g., "public" vs "private" data)
- Dataset size makes full-database sync impractical (multi-GB databases)
- Different collections require different sync strategies (e.g., immediate vs batched)

For these cases, per-collection sync could be reintroduced alongside database-level sync as an opt-in feature.

---
