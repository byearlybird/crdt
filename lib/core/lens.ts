import { Atomizer } from "./atomizer";
import type { Document } from "./types";

export function createReadLens<T extends object>(doc: Document<T>): T {
  const handler: ProxyHandler<Document<T>> = {
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
      if (Atomizer.isAtom(value)) {
        return Atomizer.unpack(value);
      }

      // 3. Non-atom (invalid); fail fast
      throw new Error(
        `createReadLens: field "${String(prop)}" is not an atom. Expected Document<T> with atomized fields only.`,
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
