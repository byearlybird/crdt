# Contributing to Starling

Thanks for helping improve Starling! This document captures the basics for checking out the repo, running tests, and keeping docs/code consistent.

## Prerequisites

- [Bun](https://bun.sh/) 1.0+ (used for scripts, builds, and tests)
- Node.js 18+ (for editor tooling, though Bun drives most commands)

Install dependencies from the workspace root:

```bash
bun install
```

## Repository Structure

For a detailed overview of the repository layout, architecture, eventstamps, CRDT-like merging, and module organization, see [Architecture](docs/architecture.md).

For a record of project-wide decisions, see the [Architecture Decision Log](docs/decision-log.md).

## Running Tests

```bash
bun test

# Watch mode
bun test --watch

# Specific test file
bun test packages/core/src/store/store.test.ts
```

- The `core` suite exercises every CRDT primitive; run it whenever you touch merge logic, transaction behavior, or event system.
- Add tests alongside the implementation in the same directory.

## Linting and Formatting

```bash
# Check code
bun biome check .

# Format code
bun biome format --write .

# Lint code
bun biome lint .
```

## Builds

```bash
# Build the starling package (from workspace root)
bun run build

# Or from package directory
cd packages/starling && bun run build
```

The build generates four entry points: main store export, core primitives, and two plugins (IDB and HTTP).

## Version Bumps

To prepare the package for release, bump its version from the package directory:

```bash
cd packages/starling
bun pm version patch    # Bump patch version
bun pm version minor    # Bump minor version
bun pm version major    # Bump major version
```

Publishing to npm is restricted to project maintainers.

## Documentation

- Keep README sections focused on user-facing workflows. Implementation details, changelogs, and contributor tips belong here or in package-specific docs.
- Update architecture docs when changing core behavior so consumers understand the design.

### JSDoc Guidelines

To avoid duplication between JSDoc and markdown docs, follow these principles:

**JSDoc is for code context** - Brief explanations visible in IDEs while writing code:
- What does this parameter do?
- What's a minimal usage example?
- Any immediate gotchas?

**Markdown is for learning** - Conceptual explanations and tutorials:
- Why this design choice?
- How does it work internally?
- When to use what?

**Keep JSDoc minimal and usage-focused**:

✅ **Good** (terse, shows usage):
```typescript
/**
 * Merge a remote collection using field-level LWW.
 * @param collection - Collection from storage or another replica
 */
merge(collection: Collection): void { ... }
```

❌ **Bad** (duplicates architecture docs):
```typescript
/**
 * Merge a remote collection using field-level Last-Write-Wins.
 *
 * The merge operation:
 * 1. Forwards the clock to the newest eventstamp
 * 2. Merges each document using field-level LWW
 * ...15 more lines explaining the algorithm...
 */
merge(collection: Collection): void { ... }
```

**What to include in JSDoc**:
- Type descriptions for exported types
- Parameter descriptions when not obvious from TypeScript
- Short (1-3 line) usage examples
- Links to markdown docs for complex topics: `@see docs/architecture.md#merging`

**What to keep only in markdown**:
- Architecture explanations (how eventstamps work, why LWW)
- Design rationale (decision log items)
- Multi-step tutorials
- "When to use" guidance

**Target**: Each JSDoc comment should be under 5 lines (excluding examples). If you need more, link to markdown docs instead.

## Pull Request Checklist

- [ ] Tests pass locally (`bun test`).
- [ ] Docs updated when behavior or configuration changes.
- [ ] `bun biome check .` succeeds (lint + format).
- [ ] Builds complete for affected packages.
