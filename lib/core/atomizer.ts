import type { Stamp } from "./clock";
import type { Atom, AtomizedDocument, Document } from "./types";
import { KEYS } from "./types";

export const Atomizer = {
  // Create an atom with a timestamp
  pack: <T>(value: T, timestamp: Stamp): Atom<T> => ({
    [KEYS.VAL]: value,
    [KEYS.TS]: timestamp,
  }),

  // Extract value safely
  unpack: <T>(node: unknown): T | undefined => {
    return Atomizer.isAtom(node) ? (node[KEYS.VAL] as T) : undefined;
  },

  // Check if a node is an atom
  isAtom: (node: unknown): node is Atom<unknown> => {
    return node !== null && typeof node === "object" && KEYS.VAL in node;
  },

  // Converts a plain object into an AtomizedDocument by atomizing each field.
  // Nested objects are stored as blob values (not flattened).
  atomize: <T extends Document>(data: T, timestamp: Stamp): AtomizedDocument<T> => {
    const document = {} as AtomizedDocument<T>;
    for (const key of Object.keys(data) as (keyof T)[]) {
      document[key] = Atomizer.pack(data[key], timestamp);
    }
    return document;
  },
};
