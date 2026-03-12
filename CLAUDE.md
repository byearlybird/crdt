# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Starling is a conflict-free replicated data type (CRDT) primitives library for JavaScript. It implements Last-Write-Wins (LWW) semantics with hybrid logical clocks (HLC) for distributed systems synchronization. The library provides low-level building blocks — not an opinionated store — so users compose them into whatever architecture fits their application.

**Core Concepts:**

- **Atoms**: The smallest CRDT unit — a value paired with a timestamp and integrity hash
- **Documents**: Flat key-to-atom maps representing a single entity with field-level conflict resolution
- **Stamps**: Hybrid logical clock timestamps (`ms@seq@deviceId` in hex) that are lexicographically sortable
- **Clock**: A logical clock that produces monotonically increasing stamps for a given device

## Commands

### Build and Development

- `bun run build` - Build the library via `build.ts` (Bun bundler + tsc for declarations)
- `bun run dev` - Build in watch mode

### Testing

- `bun test` - Run all tests
- `bun test test/crdt/document.test.ts` - Run specific test file
- Test files live in `test/` and use pattern: `*.test.ts`

### Code Quality

- `bun run fmt` - Format code with oxfmt
- `bun run fmt:check` - Check formatting without changes
- `bun run lint` - Lint with oxlint (auto-fix)
- `bun run lint:check` - Lint without auto-fix
- `bun run typecheck` - Type-check with tsc

## Architecture

### Directory Layout

```
src/
├── api/
│   └── clock.ts       - Clock factory (createClock, tick, getStamp)
├── crdt/
│   ├── atom.ts        - Atom primitives (makeAtom, patchAtom, hashAtom)
│   ├── document.ts    - Document operations (makeDoc, patchDoc, makeDataFromPOJO, makePOJO)
│   ├── stamp.ts       - Stamp utilities (makeStamp, parseStamp, laterStamp, latestStamp)
│   └── types.ts       - Core type definitions (Stamp, Atom, Doc, DocData)
├── sync/
│   ├── cipher.ts      - Encode/decode documents for transport with integrity checks
│   └── diff.ts        - Hash-based diffing (takeAtomHashes, takeDiffedData)
├── utils/
│   ├── flatten.ts     - Nested object flattening/unflattening for field-level LWW
│   └── hash.ts        - FNV-1a hashing and hash reduction
└── index.ts           - Public entrypoint re-exporting all modules
```

### Key Design Patterns

1. **Field-level LWW**: Documents are flattened to individual fields, each tracked as an atom with its own timestamp. Conflicts resolve per-field, not per-document.

2. **Hybrid Logical Clock**: Stamps combine physical time (ms), logical sequence (seq), and a hashed device ID. The hex format is lexicographically sortable, enabling simple string comparison for ordering.

3. **Hash-based diffing**: Each atom and document carries an integrity hash. Sync uses `takeAtomHashes` / `takeDiffedData` to compute minimal diffs — only changed atoms transfer.

4. **Cipher layer**: `createCipher` wraps encode/decode functions for encrypting atom values before transport, with hash-based integrity verification on decode.

5. **No framework opinions**: The library provides pure functions and data structures. There is no built-in store, event system, or reactivity — users compose these primitives with their own state management.

## TypeScript Configuration

- Extremely strict mode enabled with `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature`
- `moduleResolution: "bundler"` with `allowImportingTsExtensions`
- Path aliases: `#` → `src/index.ts`, `#*` → `src/*`
- No emit from tsc — build handled by Bun bundler with tsc for declaration files only

## Testing Patterns

Tests use Bun's built-in Jest-compatible test runner (`bun test`) with `describe`/`test`/`expect`. Test files live in `test/` mirroring the `src/` structure and import via `#` path aliases. See `test/integration.test.ts` for a full end-to-end sync flow example.

## Publishing

- Package published as `@byearlybird/crdt` on npm
- `bun run prepublishOnly` runs build automatically before publishing
- Only `dist/` directory is published (see package.json files array)
