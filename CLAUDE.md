# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Starling is a conflict-free replicated data type (CRDT) library built on nanostores for reactive state management. It implements Last-Write-Wins (LWW) semantics with hybrid logical clocks (HLC) for distributed systems synchronization.

**Core Concepts:**
- **Documents**: Key-value objects where each field has a value and timestamp (stamp)
- **Collections**: Groups of documents with tombstones for deletion tracking
- **Clock**: Hybrid logical clock (milliseconds + sequence counter + nonce) for ordering operations
- **Store**: Reactive store managing multiple collections with nanostores integration

## Commands

### Build and Development
- `bun run build` - Build the library using tsdown
- `bun run dev` - Build in watch mode

### Testing
- `bun test` - Run all tests
- `bun test <file>` - Run specific test file
- Test files use pattern: `*.test.ts`

### Code Quality
- `bun run format` - Format code with Prettier
- `bun run format:check` - Check formatting without changes

## Architecture

### Layer Structure

**Core Layer** (`lib/core/`):
- Pure CRDT logic without reactive bindings
- `clock.ts` - Hybrid logical clock implementation (advanceClock, makeStamp, parseStamp)
- `document.ts` - Document CRDT operations (makeDocument, parseDocument, mergeDocuments)
- `collection.ts` - Collection-level merging (mergeCollections, mergeCollectionRecords)
- `tombstone.ts` - Deletion tracking
- `flatten.ts` - Nested object flattening for field-level LWW resolution
- `hex.ts` - Hex encoding utilities and nonce generation

**Store Layer** (`lib/store/`):
- Reactive nanostores integration
- `store.ts` - Main store API with multi-collection management and query support
- `collection.ts` - Reactive collection API wrapping core CRDT logic
- `clock.ts` - Reactive clock that provides tick() function for stamp generation
- `schema.ts` - StandardSchema validation utilities

### Key Design Patterns

1. **Field-level LWW**: Documents are flattened to individual fields, each with its own timestamp. This enables field-level conflict resolution rather than document-level.

2. **Hybrid Logical Clock**: Stamps combine physical time (ms), logical sequence (seq), and random nonce to ensure total ordering across distributed nodes while allowing offline operations.

3. **Reactive Snapshots**: All state changes flow through nanostores atoms (`$data`, `$snapshot`), enabling reactive UI updates and time-travel debugging.

4. **Schema Flexibility**: Collections accept any StandardSchema-compatible validator (Zod, etc.). Schemas must have an `id` field or provide a custom `getId` function.

5. **Merge Semantics**:
   - Store.merge() syncs entire store state from remote snapshot
   - Collection.merge() syncs individual collection
   - Field conflicts resolved by timestamp comparison
   - Tombstones prevent deleted documents from reappearing

## TypeScript Configuration

- Extremely strict mode enabled with `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature`
- `moduleResolution: "bundler"` with `allowImportingTsExtensions`
- No emit - build handled by tsdown

## Testing Patterns

Tests use bun:test framework with describe/test/expect:
```ts
import { describe, test, expect } from "bun:test";

test("documents merge with LWW semantics", () => {
  const stamp1 = makeStamp(1000, 1);
  const stamp2 = makeStamp(2000, 1);
  const doc1 = makeDocument({ name: "Alice" }, stamp1);
  const doc2 = makeDocument({ name: "Bob" }, stamp2);
  const merged = mergeDocuments(doc1, doc2);
  expect(parseDocument(merged)).toEqual({ name: "Bob" });
});
```

See `lib/core/integration.test.ts` for comprehensive CRDT behavior tests and `lib/store/store.test.ts` for store API usage examples.

## Publishing

- Package published as `@byearlybird/starling` on npm
- `bun run prepublishOnly` runs build automatically before publishing
- Only `dist/` directory is published (see package.json files array)
