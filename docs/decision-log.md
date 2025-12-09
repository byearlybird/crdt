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
