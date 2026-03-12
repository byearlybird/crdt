# Starling

CRDT primitives for JavaScript. Field-level Last-Write-Wins with hybrid logical clocks.

Starling provides the low-level building blocks for conflict-free replicated data — atoms, documents, clocks, diffing, and encryption. It handles conflict resolution and sync mechanics so you can compose them into whatever architecture fits your application.

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
import {
  createClock,
  makeDataFromPOJO,
  makeDoc,
  makePOJO,
  patchDoc,
  takeAtomHashes,
  takeDiffedData,
} from "@byearlybird/starling";

// Create a document from a plain object
const clock = createClock("device-a");
const data = makeDataFromPOJO({ name: "Alice", age: 30 }, clock.tick());
const doc = makeDoc(data);

// Read it back as a plain object
makePOJO(doc); // { name: "Alice", age: 30 }

// Update a field — only the changed field gets a new timestamp
const patch = makeDataFromPOJO({ age: 31 }, clock.tick());
patchDoc(doc, patch);
```

## Concepts

### Atoms

An atom is the smallest CRDT unit: a value, a timestamp, and an integrity hash. Every field in a document is an atom, enabling field-level conflict resolution.

```typescript
import { makeAtom, patchAtom } from "@byearlybird/starling";

const atom = makeAtom("hello", clock.tick());
// { "~d": "hello", "~t": "0191a2b3c4d5@000000@1a2b3c4d", "~h": 1234567 }

// patchAtom only applies if the incoming timestamp is later
patchAtom(atom, "world", clock.tick()); // updated
```

### Documents

A document is a flat map of field names to atoms. Nested objects are automatically flattened to dot-separated keys for field-level granularity.

```typescript
import { makeDataFromPOJO, makeDoc, patchDoc, makePOJO } from "@byearlybird/starling";

const data = makeDataFromPOJO(
  { name: "Alice", address: { city: "Portland" } },
  clock.tick(),
);
const doc = makeDoc(data);

// Fields are flattened: "name", "address.city"
// makePOJO restores the nested structure
makePOJO(doc); // { name: "Alice", address: { city: "Portland" } }
```

### Clocks

A hybrid logical clock produces monotonically increasing, lexicographically sortable timestamps. Each stamp encodes millisecond time, a sequence counter, and a hashed device ID.

```typescript
import { createClock } from "@byearlybird/starling";

const clock = createClock("device-a");
const stamp1 = clock.tick(); // "0191a2b3c4d5@000000@1a2b3c4d"
const stamp2 = clock.tick(); // "0191a2b3c4d5@000001@1a2b3c4d"
// stamp2 > stamp1 (lexicographic comparison)
```

### Syncing with Diffs

Sync works by exchanging atom hashes. The sender shares its hashes; the receiver computes a minimal diff of only the atoms that changed.

```typescript
import { takeAtomHashes, takeDiffedData, patchDoc } from "@byearlybird/starling";

// On the receiver: take hashes and send them to the sender
const hashes = takeAtomHashes(localDoc);

// On the sender: compute a diff against those hashes
const diff = takeDiffedData(remoteDoc, hashes);

// On the receiver: apply the diff
patchDoc(localDoc, diff);
```

### Encryption for Transport

The cipher layer encrypts atom values for transport while preserving timestamps and integrity hashes. Decoding verifies integrity automatically.

```typescript
import { createCipher } from "@byearlybird/starling";

const cipher = createCipher(
  (value) => encrypt(value),  // your encode function
  (value) => decrypt(value),  // your decode function
);

const encoded = cipher.encodeDoc(doc); // safe to send over the wire
const decoded = cipher.decodeDoc(encoded); // integrity-verified
```

## API

### Clock

- `createClock(uniqueId, seedStamp?)` — Create a clock for a device/node
- `clock.tick()` — Advance the clock and return a new stamp
- `clock.getStamp()` — Return the current stamp without advancing

### Stamps

- `makeStamp(ms, seq, deviceId)` — Create a stamp from components
- `parseStamp(stamp)` — Extract `{ ms, seq }` from a stamp
- `laterStamp(a, b)` — Return the later of two stamps
- `latestStamp(stamps)` — Return the max stamp from an iterable
- `MIN_STAMP` — Sentinel value that compares less than any real stamp

### Atoms

- `makeAtom(value, timestamp)` — Create an atom
- `patchAtom(atom, value, timestamp)` — Update an atom if the timestamp is later
- `hashAtom(value, timestamp)` — Compute an atom's integrity hash

### Documents

- `makeDoc(data)` — Create a document from a `DocData` map
- `patchDoc(doc, data)` — Merge incoming atoms into a document (field-level LWW)
- `makeDataFromPOJO(obj, timestamp)` — Convert a plain object to `DocData` (flattens nested objects)
- `makePOJO(doc)` — Convert a document back to a plain object (unflattens)

### Sync / Diff

- `takeAtomHashes(doc)` — Extract a `{ key: hash }` map from a document
- `takeDiffedData(doc, atomHashes)` — Return only the atoms whose hashes differ

### Cipher

- `createCipher(encode, decode)` — Create an encoder/decoder pair for document transport
- `assertCipherIntegrity(cipher)` — Verify a cipher's encode/decode roundtrip

### Utilities

- `flatten(obj, transform?)` — Flatten nested objects to dot-separated keys
- `unflatten(obj)` — Restore dot-separated keys to nested objects
- `hash(input)` — FNV-1a string hash
- `reduceHashes(hashes)` — XOR-reduce a list of hashes
- `reduceItemHashes(items)` — Extract and reduce `~h` from hashed items

### Types

- `Stamp` — `${ms}@${seq}@${deviceId}` hex string
- `Atom<T>` — `{ "~d": T, "~t": Stamp, "~h": number }`
- `Doc` — `{ "~d": DocData, "~t": Stamp, "~h": number }`
- `DocData` — `Record<string, Atom>`

## Development

```bash
bun install
bun run build
bun test
bun run dev     # watch mode
bun run fmt     # format
bun run lint    # lint
```
