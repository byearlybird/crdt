# Starling

Local-first data sync for JavaScript apps.

Starling keeps replicas in sync using field-level Last-Write-Wins powered by hybrid logical clocks. Documents converge automatically—no manual merge logic required.

## Package Structure

Starling is distributed as a single package with subpath exports:

- `@byearlybird/starling` — Store with typed collections, transactions, and plugins (main export)
- `@byearlybird/starling/core` — Low-level CRDT primitives for custom sync implementations
- `@byearlybird/starling/plugin-idb` — IndexedDB persistence plugin
- `@byearlybird/starling/plugin-http` — HTTP sync plugin

## Highlights

- Typed collections with schema validation
- Transactions with snapshot isolation
- Field-level Last-Write-Wins conflict resolution
- State-based document merging (no operation logs)
- Framework-agnostic – works anywhere JavaScript runs

## Installation

```bash
bun add @byearlybird/starling zod
```

## Quick Start

```ts
import { z } from "zod";
import { createStore } from "@byearlybird/starling";

// Define your schema
const taskSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  completed: z.boolean().default(false),
});

// Create a database with typed collections
const store = createStore({
  name: "my-app",
  schema: {
    tasks: { schema: taskSchema, getId: (task) => task.id },
  },
});

// CRUD operations
store.tasks.add({ id: "1", title: "Learn Starling", completed: false });
store.tasks.update("1", { completed: true });
const task = store.tasks.get("1");

// Transactions with explicit dependencies and snapshot isolation
store.transact(["tasks"], (tx) => {
  tx.tasks.add({ id: "2", title: "Build an app", completed: false });
  tx.tasks.update("1", { completed: false });
});

// Queries with explicit dependencies (read-only)
const completedTasks = store.query(["tasks"], (q) =>
  q.tasks.find((task) => task.completed)
);

// Sync with remote database (conflict resolution is automatic)
store.mergeSnapshot(remoteSnapshot);
```

### Additional Features

**Explicit Dependencies** - Transactions and queries require declaring which collections you'll access:
```ts
// Transaction - only clones specified collections for efficiency
store.transact(["tasks", "users"], (tx) => {
  const task = tx.tasks.add({ ... });
  tx.users.update(task.assignedTo, { lastActivity: Date.now() });
});

// Query - read-only access to specified collections
const stats = store.query(["tasks", "users"], (q) => ({
  totalTasks: q.tasks.getAll().length,
  totalUsers: q.users.getAll().length,
}));
```

**Mutation Events** - React to data changes:
```ts
store.on("mutation", (event) => {
  console.log(`${event.collection}: ${event.added.length} added, ${event.updated.length} updated`);
});
```

**Plugins** - Extend with persistence and sync:
```ts
import { idbPlugin } from "@byearlybird/starling/plugin-idb";
import { httpPlugin } from "@byearlybird/starling/plugin-http";

const store = await createStore({ name: "my-app", schema })
  .use(idbPlugin())
  .use(httpPlugin({ baseUrl: "https://api.example.com" }))
  .init();
```

## How Sync Works

Starling's merge model is designed for the common case: multiple clients editing the same data without custom conflict-resolution logic.

### Field-Level Last-Write-Wins

When two devices edit the same record, Starling compares each field individually—the most recent write wins. If Client A updates `user.name` and Client B updates `user.email`, both changes are preserved. Only conflicting fields (same field, different values) use the timestamp to pick a winner.

### Eventstamps

Every write is tagged with an "eventstamp"—a timestamp that's guaranteed to be unique and always increasing, even if two devices write at the exact same moment. The format is `YYYY-MM-DDTHH:mm:ss.SSSZ|counter|nonce` (for example, `2025-01-15T10:30:00.000Z|0001|a7f2`).

When devices sync, they share their latest eventstamp so clocks stay roughly aligned across your app.

### Data Shape

Starling works with **plain objects**:

```ts
// Good: nested records
{ name: "Alice", settings: { theme: "dark", notifications: true } }

// Good: scalars and arrays
{ count: 42, active: true, tags: ["work", "urgent"] }
```

Arrays are treated as a single value—if two clients modify the same array, the most recent version wins entirely (no element-by-element merging). For lists that need concurrent edits (for example, todo items), use objects with IDs as keys instead:

```ts
// Avoid: array of embedded items
{ todos: [{ text: "..." }, { text: "..." }] }

// Prefer: record keyed by id
{ todos: { "id1": { text: "..." }, "id2": { text: "..." } } }
```

### When to Use Something Else

If you need collaborative text editing, mergeable arrays, or more sophisticated conflict handling, consider libraries like [Automerge](https://automerge.org/) or [Yjs](https://docs.yjs.dev/). Starling is intentionally small and focuses on object-shaped application state.

## Core Primitives (`@byearlybird/starling/core`)

For custom sync implementations, you can import low-level primitives from the `/core` subpath:

- `createClock` / `createClockFromEventstamp` – clock utilities for eventstamps
- `makeDocument` / `mergeDocuments` – document creation and merging
- `makeResource` / `mergeResources` – resource object operations

## Project Status

Starling is in **beta**—the API is mostly stable but may have minor changes based on feedback. The core primitives (`/core`) are well-tested, while the database layer and plugins continue to evolve.

## Development

See `CONTRIBUTING.md` for local development, testing, and documentation guidelines.

## License

MIT (see `LICENSE`)

## Credits

💖 Made [@byearlybird](https://github.com/byearlybird)

Inspired by [Tinybase](https://tinybase.org/) and many other excellent libraries in the local-first community, Starling implements a simple sync solution for personal apps based on the approach described in [James Long's "CRDTs for Mortals" talk](https://www.youtube.com/watch?v=DEcwa68f-jY)—a great intro if you're new to local-first development.

Thanks for checking out Starling!