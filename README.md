# Starling

Conflict-free replicated state for JavaScript. Bring your own reactivity.

Starling is a CRDT (conflict-free replicated data type) library that provides automatic conflict resolution for distributed data. It manages state with Last-Write-Wins semantics using hybrid logical clocks, giving you a solid foundation for building local-first, collaborative applications.

> [!IMPORTANT]
> This library is being refocused as a primitives-only foundation. State management, persistence, and reactivity are intentionally out of scope — those concerns belong to the application layer. Active development of the new primitives is on the [`crdt`](https://github.com/byearlybird/crdt/tree/crdt) branch, published as [`@byearlybird/crdt`](https://www.npmjs.com/package/@byearlybird/crdt).

## Installation

```bash
npm install @byearlybird/starling
# or
pnpm add @byearlybird/starling
# or
bun add @byearlybird/starling
```

Requires TypeScript 5 or higher.

## Quick Example

```typescript
import { createStore, collection } from "@byearlybird/starling";
import { z } from "zod";

const userSchema = z.object({
  id: z.string(),
  name: z.string(),
});

const store = createStore({
  users: collection(userSchema, (data) => data.id),
});

store.put("users", { id: "1", name: "Alice" });
const user = store.get("users", "1"); // { id: "1", name: "Alice" }
```

## Features

- **CRDT-based**: Automatic conflict resolution with Last-Write-Wins semantics
- **Fast and synchronous**: All operations are in-memory and synchronous
- **Framework agnostic**: Works with React, Vue, Svelte, or vanilla JS
- **Type-safe**: Full TypeScript support with type inference
- **Schema validation**: Works with Zod, Valibot, ArkType, and more
- **Merge snapshots**: Sync data between devices or users easily
- **Change events**: Listen to data changes and integrate with your reactive system

## Basic Usage

### Creating a Store

A store holds one or more collections. Each collection has a schema that defines what data it can store.

```typescript
import { createStore, collection } from "@byearlybird/starling";
import { z } from "zod";

const store = createStore({
  users: collection(
    z.object({
      id: z.string(),
      name: z.string(),
      email: z.string().optional(),
    }),
    (data) => data.id,
  ),
  notes: collection(
    z.object({
      id: z.string(),
      content: z.string(),
    }),
    (data) => data.id,
  ),
});
```

### Adding Documents

Add new items to a collection using `put()`:

```typescript
store.put("users", {
  id: "1",
  name: "Alice",
  email: "alice@example.com",
});
```

Or use `transact()` for atomic multi-collection operations:

```typescript
store.transact((tx) => {
  tx.put("users", { id: "1", name: "Alice", email: "alice@example.com" });
  tx.put("notes", { id: "n1", content: "Hello" });
});
```

### Updating Documents

Update existing items using `patch()`:

```typescript
store.patch("users", "1", {
  email: "newemail@example.com",
});
```

### Removing Documents

Remove items using `remove()`:

```typescript
store.remove("users", "1");
```

### Reading Data

Read data directly from the store:

```typescript
// Get a single item
const user = store.get("users", "1");

// Get all items as an array
const allUsers = store.list("users");

// You can easily derive other operations:
const userIds = allUsers.map((u) => u.id);
const hasUser = allUsers.some((u) => u.id === "1");
```

### Listening to Changes

Subscribe to changes with `subscribe()`:

```typescript
// Subscribe to specific collections
const unsubscribe = store.subscribe(["users"], (event) => {
  console.log("Users collection changed:", event);
  const allUsers = store.list("users");
  // Update UI, invalidate queries, etc.
});

// Or subscribe to all changes
store.subscribe((event) => {
  console.log("Store changed:", event);
});

// Later, unsubscribe
unsubscribe();
```

## Merging Data

Starling's core feature is conflict-free merging. When data changes in multiple places, Starling automatically resolves conflicts using timestamps.

Merge snapshots directly:

```typescript
// Get current state as a snapshot
const snapshot = store.getState();

// Send to server or save locally
await sendToServer(snapshot);

// Later, merge a snapshot from another source
const remoteSnapshot = await fetchFromServer();
store.merge(remoteSnapshot);
```

Starling automatically resolves conflicts. If the same field was changed in both places, it keeps the change with the newer timestamp (Last-Write-Wins).

## Reactivity Integration

Starling is framework-agnostic. Use `subscribe()` to integrate with your reactive system:

### React with TanStack Query

```typescript
import { useQuery, useQueryClient } from "@tanstack/react-query";

function useUsers() {
  const queryClient = useQueryClient();

  useEffect(() => {
    return store.subscribe(["users"], () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
    });
  }, []);

  return useQuery({
    queryKey: ["users"],
    queryFn: () => store.list("users"),
  });
}
```

### React with useSyncExternalStore

```typescript
import { useSyncExternalStore } from "react";

function useUsers() {
  return useSyncExternalStore(
    (callback) => store.subscribe(["users"], () => callback()),
    () => store.list("users"),
  );
}
```

### Svelte

```typescript
import { writable } from "svelte/store";

const users = writable(store.list("users"));
store.subscribe(["users"], () => {
  users.set(store.list("users"));
});
```

### Vue

```typescript
import { ref } from "vue";

const users = ref(store.list("users"));
store.subscribe(["users"], () => {
  users.value = store.list("users");
});
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

### Store Methods

- `get(collection, id)` - Get a document by ID from a collection
- `list(collection)` - Get all documents as an array from a collection
- `put(collection, data)` - Insert or replace a document (upsert, revives tombstoned IDs)
- `patch(collection, id, data)` - Partially update an existing document (throws if ID missing)
- `remove(collection, id)` - Remove a document
- `transact(callback)` - Execute operations atomically. Collections are cloned lazily on first access.
- `subscribe(callback)` - Subscribe to all collection changes
- `subscribe(collections, callback)` - Subscribe to changes in specific collections
- `getState()` - Get current store state as a snapshot
- `merge(snapshot)` - Merge a snapshot into the store

For full type definitions, see the TypeScript types exported from the package.

## Package structure

- **`lib/core/`** – CRDT primitives: hybrid logical clock, per-field atoms (LWW), tombstones, and document/collection merging.
- **`lib/store/`** – Store API with collections, batching, queries, and change subscriptions.
- **`lib/middleware/`** – Optional middleware (e.g. persistence).

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
