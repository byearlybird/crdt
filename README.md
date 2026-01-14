# Starling

Conflict-free replicated state for JavaScript. Bring your own reactivity.

Starling is a CRDT (conflict-free replicated data type) library that provides automatic conflict resolution for distributed data. It manages state with Last-Write-Wins semantics using hybrid logical clocks, giving you a solid foundation for building local-first, collaborative applications.

## Installation

```bash
npm install @byearlybird/starling
# or
pnpm add @byearlybird/starling
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

store.add("users", { id: "1", name: "Alice" });
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
store.add("users", {
  id: "1",
  name: "Alice",
  email: "alice@example.com",
});
```

### Updating Documents

Update existing items with `update()`:

```typescript
store.update("users", "1", {
  email: "newemail@example.com",
});
```

### Removing Documents

Remove items with `remove()`:

```typescript
store.remove("users", "1");
```

### Reading Data

The store provides simple getter methods:

```typescript
// Get a single item
const user = store.get("users", "1");

// Get all items as an array
const allUsers = store.getAll("users");

// You can easily derive other operations:
const userIds = allUsers.map((u) => u.id);
const hasUser = allUsers.some((u) => u.id === "1");
```

### Listening to Changes

Subscribe to changes with `onChange()`:

```typescript
// Listen to all store changes
store.onChange((event) => {
  console.log(`${event.collection} changed:`, event.event.type);
  // Invalidate queries, update UI, etc.
});

// Filter for specific collection changes
store.onChange((event) => {
  if (event.collection === "users") {
    console.log("User change:", event.event.type, event.event.id);
    if (event.event.type === "add") {
      console.log("New user:", event.event.data);
    }
  }
});
```

## Merging Data

Starling's core feature is conflict-free merging. When data changes in multiple places, Starling automatically resolves conflicts using timestamps.

### Getting a Snapshot

Get the current state of your store:

```typescript
const snapshot = store.getSnapshot();
// { clock: { ms: ..., seq: ... }, collections: { ... } }
```

### Merging a Snapshot

Merge a snapshot from another device or user:

```typescript
// Get snapshot from another device
const otherSnapshot = await fetchFromServer();

// Merge it into your store
store.merge(otherSnapshot);
```

Starling automatically resolves conflicts. If the same field was changed in both places, it keeps the change with the newer timestamp (Last-Write-Wins).

### Syncing Between Two Stores

Here's a simple example of syncing between two stores:

```typescript
const store1 = createStore({ collections: { users: { schema: userSchema } } });
const store2 = createStore({ collections: { users: { schema: userSchema } } });

// Add data to store1
store1.add("users", { id: "1", name: "Alice" });

// Sync to store2
const snapshot = store1.getSnapshot();
store2.merge(snapshot);

// Now store2 has the same data
console.log(store2.get("users", "1")); // { id: "1", name: "Alice" }
```

## Reactivity Integration

Starling is framework-agnostic. Use `onChange()` to integrate with your reactive system:

### React with TanStack Query

```typescript
import { useQuery, useQueryClient } from "@tanstack/react-query";

function useUsers() {
  const queryClient = useQueryClient();

  useEffect(() => {
    return store.onChange((event) => {
      if (event.collection === "users") {
        queryClient.invalidateQueries({ queryKey: ["users"] });
      }
    });
  }, []);

  return useQuery({
    queryKey: ["users"],
    queryFn: () => store.getAll("users"),
  });
}
```

### React with useSyncExternalStore

```typescript
import { useSyncExternalStore } from "react";

function useUsers() {
  return useSyncExternalStore(
    (callback) =>
      store.onChange((event) => {
        if (event.collection === "users") callback();
      }),
    () => store.getAll("users"),
  );
}
```

### Svelte

```typescript
import { writable } from "svelte/store";

const users = writable(store.getAll("users"));
store.onChange((event) => {
  if (event.collection === "users") {
    users.set(store.getAll("users"));
  }
});
```

### Vue

```typescript
import { ref } from "vue";

const users = ref(store.getAll("users"));
store.onChange((event) => {
  if (event.collection === "users") {
    users.value = store.getAll("users");
  }
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

- `add(collection, data)` - Add a new document to a collection
- `get(collection, id)` - Get a document by ID from a collection
- `getAll(collection)` - Get all documents from a collection as an array
- `update(collection, id, data)` - Update an existing document in a collection
- `remove(collection, id)` - Remove a document from a collection
- `getSnapshot()` - Get the full store snapshot for syncing
- `merge(snapshot)` - Merge a store snapshot
- `onChange(listener)` - Subscribe to all collection changes

For full type definitions, see the TypeScript types exported from the package.

## Development

```bash
# Install dependencies
pnpm install

# Build the library
pnpm run build

# Run tests
pnpm test

# Watch mode for development
pnpm run dev
```
