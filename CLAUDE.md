# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Starling is a conflict-free replicated data type (CRDT) library for JavaScript. It implements Last-Write-Wins (LWW) semantics with hybrid logical clocks (HLC) for distributed systems synchronization. The library is framework-agnostic - users integrate it with their preferred reactive system via change events.

**Core Concepts:**

- **Documents**: Key-value objects where each field has a value and timestamp (stamp)
- **Collections**: Groups of documents with tombstones for deletion tracking
- **Clock**: Hybrid logical clock (milliseconds + sequence counter + nonce) for ordering operations
- **Store**: Coordination layer managing multiple collections with clock synchronization

## Commands

### Build and Development

- `bun run build` - Build the library using tsdown
- `bun run dev` - Build in watch mode

### Testing

- `bun test` - Run all tests
- `bun test lib/core/document.test.ts` - Run specific test file
- Test files use pattern: `*.test.ts`

### Code Quality

- `bun run fmt` - Format code with oxfmt
- `bun run fmt:check` - Check formatting without changes

### Benchmarks

- `bun run bench` - Run all benchmarks (core + store)
- `bun run bench:core` - Run core CRDT benchmarks (merge, read, write operations)
- `bun run bench:store` - Run store-level benchmarks
- See `lib/core/BENCHMARKS.md` for detailed documentation

## Architecture

### Layer Structure

**Core Layer** (`lib/core/`):

- Pure CRDT logic with no dependencies
- `clock.ts` - Hybrid logical clock implementation (advanceClock, makeStamp, parseStamp)
- `document.ts` - Document CRDT operations (makeDocument, parseDocument, mergeDocuments)
- `collection.ts` - Collection-level merging (mergeCollections, mergeCollectionRecords)
- `tombstone.ts` - Deletion tracking
- `flatten.ts` - Nested object flattening for field-level LWW resolution
- `hex.ts` - Hex encoding utilities and nonce generation

**Store Layer** (`lib/store/`):

- Simple coordination layer with change events
- `store.ts` - Main store API with clock management and multi-collection coordination
- `collection.ts` - Collection API wrapping core CRDT logic with change events
- `schema.ts` - StandardSchema validation utilities

### Key Design Patterns

1. **Field-level LWW**: Documents are flattened to individual fields, each with its own timestamp. This enables field-level conflict resolution rather than document-level.

2. **Hybrid Logical Clock**: Stamps combine physical time (ms), logical sequence (seq), and random nonce to ensure total ordering across distributed nodes while allowing offline operations.

3. **Change Events**: Collections and stores emit change events. Users integrate with their own reactive systems (TanStack Query, useSyncExternalStore, Svelte stores, etc.).

4. **Schema Flexibility**: Collections accept any StandardSchema-compatible validator (Zod, etc.). Each collection configuration requires an `getId` function that extracts the document ID from the validated data.

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

Tests use Bun's built-in Jest-compatible test runner (`bun test`) with `describe`/`test`/`expect`. See the `lib/**/**.test.ts` files for examples of typical patterns and `lib/store/store.test.ts` for store API usage examples.

## Publishing

- Package published as `@byearlybird/starling` on npm
- `bun run prepublishOnly` runs build automatically before publishing
- Only `dist/` directory is published (see package.json files array)
