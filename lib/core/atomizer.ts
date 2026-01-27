import type { Stamp } from "./clock";
import type { Atom, AtomizedDocument, Document } from "./types";
import { KEYS } from "./types";

export function pack<T>(value: T, timestamp: Stamp): Atom<T> {
  return {
    [KEYS.VAL]: value,
    [KEYS.TS]: timestamp,
  };
}

export function unpack<T>(node: unknown): T | undefined {
  return isAtom(node) ? (node[KEYS.VAL] as T) : undefined;
}

export function isAtom(node: unknown): node is Atom<unknown> {
  return node !== null && typeof node === "object" && KEYS.VAL in node;
}

export function atomize<T extends Document>(data: T, timestamp: Stamp): AtomizedDocument<T> {
  const document = {} as AtomizedDocument<T>;
  for (const key of Object.keys(data) as (keyof T)[]) {
    document[key] = pack(data[key], timestamp);
  }
  return document;
}
