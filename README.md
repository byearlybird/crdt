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
    users: { schema: userSchema, keyPath: "id" },
  },
});

store.transact(({ users }) => {
  users.add({ id: "1", name: "Alice" });
});
const user = store.read(({ users }) => users.get("1")); // { id: "1", name: "Alice" }
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
      keyPath: "id",
    },
    notes: {
      schema: z.object({
        id: z.string(),
        content: z.string(),
      }),
      keyPath: "id",
    },
  },
});
```

### Adding Documents

Add new items to a collection using `transact()`:

```typescript
store.transact(({ users }) => {
  users.add({
    id: "1",
    name: "Alice",
    email: "alice@example.com",
  });
});
```

### Updating Documents

Update existing items using `transact()`:

```typescript
store.transact(({ users }) => {
  users.update("1", {
    email: "newemail@example.com",
  });
});
```

### Removing Documents

Remove items using `transact()`:

```typescript
store.transact(({ users }) => {
  users.remove("1");
});
```

### Reading Data

Read data using `read()`:

```typescript
// Get a single item
const user = store.read(({ users }) => users.get("1"));

// Get all items as an array
const allUsers = store.read(({ users }) => users.list());

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
const syncMiddleware = ({ getSnapshot, merge, subscribe }) => {
  // Subscribe to changes and send snapshots to server
  subscribe((event) => {
    if (Object.keys(event).length > 0) {
      const snapshot = getSnapshot();
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
  collections: {
    users: { schema: userSchema, keyPath: "id" },
  },
})
  .use(syncMiddleware);

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
    queryFn: () => store.read(({ users }) => users.list()),
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
    () => store.read(({ users }) => users.list()),
  );
}
```

### Svelte

```typescript
import { writable } from "svelte/store";

const users = writable(store.read(({ users }) => users.list()));
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

const users = ref(store.read(({ users }) => users.list()));
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

- `transact(callback)` - Execute mutations within a transaction. The callback receives handles for each collection with `add()`, `update()`, and `remove()` methods.
- `read(callback)` - Read data synchronously. The callback receives read-only handles for each collection with `get(id)` and `list()` methods.
- `subscribe(query, subscriber)` - Subscribe to a query. The subscriber is called whenever the query's dependencies change.
- `use(middleware)` - Add middleware to the store (chainable). Middleware can access `getSnapshot()`, `merge()`, and `subscribe()`.
- `init()` - Initialize the store and run middleware (async).
- `dispose()` - Clean up middleware subscriptions (async).

### Collection Handles

Within `transact()` and `read()` callbacks, you receive handles for each collection:

- `handle.get(id)` - Get a document by ID
- `handle.list()` - Get all documents as an array
- `handle.add(data)` - Add a new document (mutate handles only)
- `handle.update(id, data)` - Update an existing document (mutate handles only)
- `handle.remove(id)` - Remove a document (mutate handles only)

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
