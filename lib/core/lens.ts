import { isAtom, unpack } from "./atomizer";
import type { AtomizedDocument, Document } from "./types";

export function createReadLens<T extends Document>(doc: AtomizedDocument<T>): T {
  const handler: ProxyHandler<AtomizedDocument<T>> = {
    get(target, prop, receiver) {
      // Ignore prototype properties and symbols
      if (typeof prop === "symbol" || !Object.prototype.hasOwnProperty.call(target, prop)) {
        return undefined;
      }

      const value = Reflect.get(target, prop, receiver);

      // 1. Missing Key
      if (value === undefined) return undefined;

      // 2. Atom Detected (The Field) -> Unpack and return
      // We STOP here. We do not proxy deeper.
      if (isAtom(value)) {
        return unpack(value);
      }

      // 3. Non-atom (invalid); fail fast
      throw new Error(
        `createReadLens: field "${String(prop)}" is not an atom. Expected AtomizedDocument<T> with atomized fields only.`,
      );
    },

    // Block Writes
    set() {
      console.warn("Mutations must use the update API.");
      return false;
    },
  };

  return new Proxy(doc, handler) as T;
}
