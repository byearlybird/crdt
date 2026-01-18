# Making Factory Functions Signal Statefulness

## The Problem

Factory functions with closures hide their statefulness:

```typescript
// ❌ Unclear: Is this creating a stateful object?
const store = createStore();

// Inside the function:
let clock = { ms: 0, seq: 0 };
const documents = {};

// ❌ Accessing closure variables looks like local vars, not "state"
const tick = () => {
  clock = { ms: Date.now(), seq: clock.seq + 1 };
};
```

Classes make this explicit:
```typescript
// ✅ Clear: `new` signals "creating an object with state"
const store = new Store();

// ✅ `this.` signals "accessing instance state"
this.clock = { ms: Date.now(), seq: this.clock.seq + 1 };
```

## Solutions

### 1. Explicit State Object (Recommended)

**Best balance of clarity and simplicity.**

```typescript
function createStore() {
  // ✅ State grouped and labeled
  const state = {
    clock: { ms: Date.now(), seq: 0 },
    documents: {},
    tombstones: {},
    listeners: new Set(),
  };

  const tick = () => {
    state.clock = advanceClock(state.clock, ...); // ✅ state. = instance state
  };

  return {
    add(collection, data) {
      state.documents[collection] = data; // ✅ Clear mutation
      state.listeners.forEach(fn => fn());
    }
  };
}
```

**Pros:**
- ✅ Minimal refactor
- ✅ `state.` prefix clearly signals "instance state"
- ✅ All state visible in one place
- ✅ Easy to document

**Cons:**
- Requires `state.` prefix everywhere
- Doesn't signal statefulness at call site

**When to use:** Default choice for most cases.

---

### 2. Self-Referential Object (Class-like)

**Most similar to class mental model.**

```typescript
function createStore() {
  const self = {
    // State
    clock: { ms: Date.now(), seq: 0 },
    documents: {},

    // Methods
    tick() {
      self.clock = advanceClock(self.clock, ...); // ✅ Like this.clock
    },

    add(collection, data) {
      self.tick(); // ✅ Like this.tick()
      self.documents[collection] = data;
    }
  };

  return self;
}
```

**Pros:**
- ✅ Very similar to `this.` in classes
- ✅ Single object contains state + behavior
- ✅ `self.method()` mirrors OOP patterns

**Cons:**
- Can't destructure methods (breaks `self` reference)
- Slightly more verbose
- Initialization must happen after definition

**When to use:** When you want class-like ergonomics without classes.

---

### 3. Typed State + API Pattern

**Clearest separation of data and behavior.**

```typescript
function createStore() {
  // ✅ State structure is explicitly typed
  type State = {
    clock: Clock;
    documents: Record<string, any>;
  };

  const state: State = {
    clock: { ms: Date.now(), seq: 0 },
    documents: {},
  };

  // ✅ API separate from state
  const api = {
    add(collection, data) {
      state.documents[collection] = data;
    }
  };

  return api;
}
```

**Pros:**
- ✅ Type-safe state structure
- ✅ Clear data vs behavior separation
- ✅ Easy to test state and API independently

**Cons:**
- Most verbose (state type + state object + api object)
- Extra indirection

**When to use:** When you want maximum clarity and testability.

---

### 4. Naming Conventions

**Quick wins without restructuring.**

```typescript
function createStore() {
  // ✅ Prefix signals "this is state"
  const $clock = { ms: Date.now(), seq: 0 };
  const $documents = {};

  // Regular variables
  const config = { debug: false };

  return {
    add(collection, data) {
      $documents[collection] = data; // ✅ $ = state
    }
  };
}
```

**Conventions:**
- `$variable` = state
- `_function` = private helper
- `CONSTANT` = immutable config

**Pros:**
- ✅ Minimal change to existing code
- ✅ Visual distinction

**Cons:**
- Relies on convention adherence
- Prefix is slightly noisy

**When to use:** Quick improvement to existing code.

---

### 5. Documentation + Return Type

**Signal intent through types and comments.**

```typescript
/**
 * Creates a stateful Store instance.
 *
 * The returned object maintains internal state including:
 * - Clock for timestamp generation
 * - Document storage
 * - Event listeners
 *
 * @returns A new Store instance
 */
function createStore(): Store {
  // Mutable state (encapsulated via closure)
  let clock = { ms: Date.now(), seq: 0 };

  return {
    add(collection, data) {
      // Mutates internal clock state
      clock = advanceClock(clock, ...);
    }
  };
}
```

**Pros:**
- ✅ Makes intent clear through documentation
- ✅ Return type `Store` signals "creating an object"
- ✅ No code changes needed

**Cons:**
- Relies on developers reading docs
- Doesn't help inside the function

**When to use:** In addition to other approaches.

---

## Comparison Table

| Approach | Clarity at Call Site | Clarity Inside | Refactor Cost | Type Safety |
|----------|---------------------|----------------|---------------|-------------|
| Current (implicit) | ❌ Low | ❌ Low | - | ✅ High |
| Classes | ✅ High (new) | ✅ High (this.) | High | ✅ High |
| State Object | ⚠️ Medium | ✅ High (state.) | Low | ✅ High |
| Self-referential | ⚠️ Medium | ✅ High (self.) | Medium | ✅ High |
| Typed State + API | ⚠️ Medium | ✅ Very High | Medium | ✅ Very High |
| Naming ($prefix) | ⚠️ Medium | ✅ Medium | Very Low | ✅ High |
| Documentation | ✅ High | ⚠️ Low | Very Low | ✅ High |

---

## Recommendations by Use Case

### For Your Store API

**Use: State Object Pattern (#1)**

```typescript
export function createStore<T>(config: { collections: T }) {
  const state = {
    clock: { ms: Date.now(), seq: 0 } as Clock,
    tombstones: {} as Tombstones,
    documents: {} as Record<string, Record<DocumentId, Document>>,
    configs: new Map<string, CollectionConfig<AnyObject>>(),
    listeners: new Set<(event: StoreChangeEvent<T>) => void>(),
  };

  // All state access is explicit: state.field
  const tick = () => {
    state.clock = advanceClock(state.clock, { ms: Date.now(), seq: 0 });
    return makeStamp(state.clock.ms, state.clock.seq);
  };

  return {
    add(collection, data) {
      const doc = makeDocument(data, tick());
      state.documents[collection] = { ...state.documents[collection], [data.id]: doc };
      state.listeners.forEach(fn => fn({ type: 'add', collection, id: data.id }));
    },
    // ... rest of API
  };
}
```

**Why:**
- ✅ Minimal refactor (just group variables into `state` object)
- ✅ Clear `state.` prefix signals state access
- ✅ Keeps all type inference benefits
- ✅ No `this` binding issues
- ✅ All state visible in one place

**Bonus: Add JSDoc**
```typescript
/**
 * Creates a CRDT Store instance with encapsulated mutable state.
 *
 * @returns A stateful Store object with methods for CRUD operations
 */
export function createStore<T>(config: { collections: T }): StoreAPI<T>
```

---

## Alternative: If You Want Maximum Class-Like Feel

**Use: Self-Referential Pattern (#2)**

```typescript
export function createStore<T>(config: { collections: T }) {
  const self = {
    // State
    clock: { ms: Date.now(), seq: 0 } as Clock,
    documents: {} as Record<string, Record<DocumentId, Document>>,

    // Private methods
    tick(): string {
      self.clock = advanceClock(self.clock, { ms: Date.now(), seq: 0 });
      return makeStamp(self.clock.ms, self.clock.seq);
    },

    // Public methods
    add(collection: string, data: any) {
      const doc = makeDocument(data, self.tick());
      self.documents[collection] = { ...self.documents[collection], [data.id]: doc };
    },
  };

  return self;
}
```

This is closest to classes while keeping type inference benefits.

---

## Quick Win

If you just want a quick improvement to existing code:

1. **Add a state object** (10 minutes)
2. **Add JSDoc comment** (2 minutes)
3. **Consider renaming to emphasize statefulness**: `createStore` → `Store` (if you're okay with capital letter for factory)

```typescript
/**
 * Creates a stateful Store instance (maintains internal CRDT state).
 */
export function Store<T>(config: { collections: T }): StoreAPI<T> {
  const state = { /* ... */ };
  // ... rest
}
```

This gives you most of the clarity benefits with minimal work.
