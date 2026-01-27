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
  users: { schema: userSchema, getId: (data) => data.id },
});

store.batch(({ users }) => {
  users.put({ id: "1", name: "Alice" });
});
const user = store.users.get("1"); // { id: "1", name: "Alice" }
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
  users: {
    schema: z.object({
      id: z.string(),
      name: z.string(),
      email: z.string().optional(),
    }),
    getId: (data) => data.id,
  },
  notes: {
    schema: z.object({
      id: z.string(),
      content: z.string(),
    }),
    getId: (data) => data.id,
  },
});
```

### Adding Documents

Add new items to a collection using `batch()`:

```typescript
store.batch(({ users }) => {
  users.put({
    id: "1",
    name: "Alice",
    email: "alice@example.com",
  });
});
```

### Updating Documents

Update existing items using `batch()`:

```typescript
store.batch(({ users }) => {
  users.patch("1", {
    email: "newemail@example.com",
  });
});
```

### Removing Documents

Remove items using `batch()`:

```typescript
store.batch(({ users }) => {
  users.remove("1");
});
```

### Reading Data

Read data directly from collection handles:

```typescript
// Get a single item
const user = store.users.get("1");

// Get all items as an array
const allUsers = store.users.list();

// You can easily derive other operations:
const userIds = allUsers.map((u) => u.id);
const hasUser = allUsers.some((u) => u.id === "1");
```

### Listening to Changes

Subscribe to changes with `subscribe()`:

```typescript
// Subscribe to a query and get updates when dependencies change
const unsubscribe = store.subscribe(
  ({ users }) => users.list(),
  (allUsers) => {
    console.log("Users updated:", allUsers);
    // Update UI, invalidate queries, etc.
  },
);

// Later, unsubscribe
unsubscribe();
```

## Merging Data

Starling's core feature is conflict-free merging. When data changes in multiple places, Starling automatically resolves conflicts using timestamps.

Snapshots and merging are available through middleware. Here's an example using middleware to sync data:

```typescript
// Create a sync middleware
const syncMiddleware = ({ getState, merge, subscribe }) => {
  // Subscribe to changes and send snapshots to server
  subscribe((event) => {
    if (Object.keys(event).length > 0) {
      const snapshot = getState();
      sendToServer(snapshot);
    }
  });

  // Periodically fetch and merge snapshots from server
  setInterval(async () => {
    const snapshot = await fetchFromServer();
    merge(snapshot, { silent: true });
  }, 1000);
};

// Use the middleware
const store = createStore({
  users: { schema: userSchema, getId: (data) => data.id },
}).use(syncMiddleware);

// Initialize the store (this runs middleware)
await store.init();
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
    return store.subscribe(
      ({ users }) => users.list(),
      () => {
        queryClient.invalidateQueries({ queryKey: ["users"] });
      },
    );
  }, []);

  return useQuery({
    queryKey: ["users"],
    queryFn: () => store.users.list(),
  });
}
```

### React with useSyncExternalStore

```typescript
import { useSyncExternalStore } from "react";

function useUsers() {
  return useSyncExternalStore(
    (callback) =>
      store.subscribe(
        ({ users }) => users.list(),
        () => callback(),
      ),
    () => store.users.list(),
  );
}
```

### Svelte

```typescript
import { writable } from "svelte/store";

const users = writable(store.users.list());
store.subscribe(
  ({ users }) => users.list(),
  (allUsers) => {
    users.set(allUsers);
  },
);
```

### Vue

```typescript
import { ref } from "vue";

const users = ref(store.users.list());
store.subscribe(
  ({ users }) => users.list(),
  (allUsers) => {
    users.value = allUsers;
  },
);
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

- `batch(callback)` - Execute mutations within a batch. The callback receives handles for each collection with `add()`, `update()`, and `remove()` methods.
- `subscribe(query, subscriber)` - Subscribe to a query. The subscriber is called whenever the query's dependencies change.
- `use(middleware)` - Add middleware to the store (chainable). Middleware can access `getState()`, `merge()`, and `subscribe()`.
- `init()` - Initialize the store and run middleware (async).
- `dispose()` - Clean up middleware subscriptions (async).

### Collection Handles

The store exposes collection handles directly. Each collection name becomes a property on the store with read-only methods. Within `batch()` callbacks, you receive batch handles for each collection:

- `handle.get(id)` - Get a document by ID
- `handle.list()` - Get all documents as an array
- `handle.put(data)` - Insert or replace a document (upsert, revives tombstoned IDs)
- `handle.patch(id, data)` - Partially update an existing document (throws if ID missing)
- `handle.remove(id)` - Remove a document (batch handles only)

For full type definitions, see the TypeScript types exported from the package.

## Package structure

- **`lib/core/`** – CRDT primitives: hybrid logical clock, per-field atoms (LWW), tombstones, and document/collection merging.
- **`lib/store/`** – Store API with collections, batching, queries, and change subscriptions.
- **`lib/middleware/`** – Optional middleware (e.g. persistence).

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
