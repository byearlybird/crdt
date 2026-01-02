# Starling

A mergable data store for building local-first apps that sync.

Starling lets you store data in memory with a fast, synchronous API. The merge system is fully built and ready—persistence and sync features are coming soon. When you need to sync with other devices or users, it automatically merges changes and resolves conflicts.

## Installation

```bash
npm install @byearlybird/starling
# or
bun add @byearlybird/starling
```

Requires TypeScript 5 or higher.

## Quick Example

```typescript
import { createStore } from "@byearlybird/starling";
import { z } from "zod";

const userSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const store = createStore({
  collections: {
    users: { schema: userSchema },
  },
});

store.users.add({ id: "1", name: "Alice" });
const user = store.users.get("1"); // { id: "1", name: "Alice" }
```

## Features

- **In-memory and fast**: All operations are synchronous for maximum performance
- **Built for local-first**: API is ready for persistence and sync (coming soon)
- **Works with any standard schema library**: Zod, Valibot, ArkType, and more
- **Automatic conflict resolution**: When merging changes, conflicts are resolved automatically
- **Reactive updates**: Data changes trigger updates automatically
- **Type-safe**: Full TypeScript support with type inference
- **Merge snapshots**: Sync data between devices or users easily

## Basic Usage

### Creating a Store

A store holds one or more collections. Each collection has a schema that defines what data it can store.

```typescript
import { createStore } from "@byearlybird/starling";
import { z } from "zod";

const store = createStore({
  collections: {
    users: {
      schema: z.object({
        id: z.string(),
        name: z.string(),
        email: z.string().optional(),
      }),
    },
    notes: {
      schema: z.object({
        id: z.string(),
        content: z.string(),
      }),
    },
  },
});
```

### Adding Documents

Add new items to a collection with `add()`:

```typescript
store.users.add({
  id: "1",
  name: "Alice",
  email: "alice@example.com",
});
```

### Updating Documents

Update existing items with `update()`:

```typescript
store.users.update("1", {
  email: "newemail@example.com",
});
```

### Removing Documents

Remove items with `remove()`:

```typescript
store.users.remove("1");
```

### Reading Data

Collections work like maps. You can read data in several ways:

```typescript
// Get a single item
const user = store.users.get("1");

// Check if an item exists
if (store.users.has("1")) {
  // ...
}

// Get all items
for (const [id, user] of store.users.entries()) {
  console.log(id, user);
}

// Query data reactively (recommended)
const $userCount = store.query(["users"], (collections) => {
  return collections.users.size;
});

// Get current value
console.log($userCount.get()); // 5

// Subscribe to updates
$userCount.subscribe((count) => {
  console.log("User count:", count);
});
```

### Reactive Queries

For reactive updates, use the `query()` method. It lets you combine data from multiple collections and automatically updates when any of them change:

```typescript
// Query multiple collections
const $stats = store.query(["users", "notes"], (collections) => {
  return {
    totalUsers: collections.users.size,
    totalNotes: collections.notes.size,
    firstUser: collections.users.get("1"),
  };
});

// Subscribe to changes
$stats.subscribe((stats) => {
  console.log("Stats updated:", stats);
});
```

## Merging Data

Starling's merge system is fully built and ready to use. When you add persistence and sync (coming soon), you'll use snapshots to sync data. A snapshot is a copy of all your data at a point in time.

### Getting a Snapshot

Get the current state of your store:

```typescript
const snapshot = store.$snapshot.get();
// { clock: { ms: ..., seq: ... }, collections: { ... } }
```

### Merging a Snapshot

Merge a snapshot from another device or user:

```typescript
// Get snapshot from another device (when you add sync)
const otherSnapshot = getSnapshotFromServer();

// Merge it into your store
store.merge(otherSnapshot);
```

Starling automatically resolves conflicts. If the same item was changed in both places, it keeps the change with the newer timestamp. The merge API is ready now—just add your persistence and sync layer on top.

### Syncing Between Two Stores

Here's a simple example of syncing between two stores:

```typescript
const store1 = createStore({ collections: { users: { schema: userSchema } } });
const store2 = createStore({ collections: { users: { schema: userSchema } } });

// Add data to store1
store1.users.add({ id: "1", name: "Alice" });

// Sync to store2
const snapshot = store1.$snapshot.get();
store2.merge(snapshot);

// Now store2 has the same data
console.log(store2.users.get("1")); // { id: "1", name: "Alice" }
```

## Schema Support

Starling works with any library that follows the [Standard Schema](https://github.com/standard-schema/spec) specification. This includes:

- **Zod** - Most popular schema library
- **Valibot** - Lightweight alternative
- **ArkType** - TypeScript-first schemas

You can use any of these to define your data shapes. Starling will validate your data and give you full TypeScript types.

```typescript
import { z } from "zod";
// or
import * as v from "valibot";
// or
import { type } from "arktype";

// All of these work the same way
const schema = z.object({ id: z.string(), name: z.string() });
// or
const schema = v.object({ id: v.string(), name: v.string() });
// or
const schema = type({ id: "string", name: "string" });
```

## API Overview

### Main Export

- `createStore(config)` - Creates a new store with collections

### Collection Methods

Each collection in your store has these methods:

- `add(data)` - Add a new document
- `update(id, data)` - Update an existing document
- `remove(id)` - Remove a document
- `merge(snapshot)` - Merge a collection snapshot
- `get(id)` - Get a document by ID
- `has(id)` - Check if a document exists
- `keys()` - Get all document IDs
- `values()` - Get all documents
- `entries()` - Get all [id, document] pairs
- `forEach(callback)` - Iterate over documents
- `size` - Number of documents

### Store Methods

- `$snapshot` - Reactive atom containing the full store snapshot
- `merge(snapshot)` - Merge a store snapshot
- `query(collections, callback)` - Query multiple collections reactively (recommended for reactive code)

For full type definitions, see the TypeScript types exported from the package.

## Development

```bash
# Install dependencies
bun install

# Build the library
bun run build

# Run tests
bun test

# Watch mode for development
bun run dev
```
