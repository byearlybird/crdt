import type { Atom } from "./types";
import { KEYS } from "./types";

export const Atomizer = {
  // Create an atom (defaulting to now)
  pack: <T>(value: T, timestamp: string): Atom<T> => ({
    [KEYS.VAL]: value,
    [KEYS.TS]: timestamp,
  }),

  // Extract value safely
  unpack: <T>(node: any): T | undefined => {
    return Atomizer.isAtom(node) ? node[KEYS.VAL] : undefined;
  },

  // Check if a node is an atom
  isAtom: (node: any): boolean => {
    return node && typeof node === "object" && KEYS.VAL in node;
  },
};
