import type { Atom, Document } from "./types";
import { KEYS } from "./types";

export const Atomizer = {
  // Create an atom (defaulting to now)
  pack: <T>(value: T, timestamp: string): Atom<T> => ({
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

  // Converts a plain object into a Document by atomizing each field.
  // Nested objects are stored as blob values (not flattened).
  atomize: <T extends Record<string, any>>(data: T, timestamp: string): Document<T> => {
    const document = {} as Document<T>;
    for (const [key, value] of Object.entries(data)) {
      document[key as keyof T] = Atomizer.pack(value, timestamp);
    }
    return document;
  },
};
