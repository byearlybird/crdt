/**
 * Checks if a value is a plain object (not Date, RegExp, Array, etc.)
 */
function isPlainObject(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value.constructor === Object || Object.getPrototypeOf(value) === null)
  );
}

/**
 * Checks if a value should be traversed (non-empty plain object)
 */
function shouldTraverse(value: unknown): boolean {
  return isPlainObject(value) && Object.keys(value as object).length > 0;
}

/**
 * Flattens a nested object into a flat object with dot-notation keys.
 * Arrays are treated atomically (as single units, not flattened).
 *
 * @param obj - The object to flatten
 * @param mapper - Optional callback to transform leaf values
 * @returns A flattened object with dot-notation keys
 *
 * @example
 * ```ts
 * const obj = { a: { b: 1, c: [2, 3] }, d: 4 };
 * flatten(obj); // { 'a.b': 1, 'a.c': [2, 3], 'd': 4 }
 *
 * flatten(obj, (v) => ({ v, ts: Date.now() }));
 * // { 'a.b': { v: 1, ts: 1234567890 }, 'a.c': { v: [2, 3], ts: 1234567890 }, 'd': { v: 4, ts: 1234567890 } }
 * ```
 */
export function flatten<T, R = unknown>(
  obj: T,
  mapper?: (value: unknown, path: string) => R,
): Record<string, R> {
  const result: Record<string, R> = {};

  const addLeaf = (value: unknown, path: string) => {
    if (path) {
      result[path] = mapper ? mapper(value, path) : (value as R);
    }
  };

  function traverse(current: unknown, prefix: string = ""): void {
    // If not a non-empty plain object, treat as leaf (handles null, undefined, arrays, primitives, empty objects, Dates, etc.)
    if (!shouldTraverse(current)) {
      addLeaf(current, prefix);
      return;
    }

    // Recursively traverse each property
    for (const [key, value] of Object.entries(current as object)) {
      const newPath = prefix ? `${prefix}.${key}` : key;
      traverse(value, newPath);
    }
  }

  traverse(obj);
  return result;
}

/**
 * Unflattens a flat object with dot-notation keys into a nested object.
 *
 * @param obj - The flattened object to unflatten
 * @param mapper - Optional callback to transform leaf values before placing them
 * @returns A nested object
 *
 * @example
 * ```ts
 * const flat = { 'a.b': 1, 'a.c': [2, 3], 'd': 4 };
 * unflatten(flat); // { a: { b: 1, c: [2, 3] }, d: 4 }
 *
 * const withMetadata = { 'a.b': { v: 1, ts: 123 }, 'a.c': { v: [2, 3], ts: 456 } };
 * unflatten(withMetadata, (val) => val.v); // { a: { b: 1, c: [2, 3] } }
 * ```
 */
export function unflatten<T = unknown, R = unknown>(
  obj: Record<string, T>,
  mapper?: (value: T, path: string) => R,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [path, value] of Object.entries(obj)) {
    const keys = path.split(".");
    const mappedValue = mapper ? mapper(value, path) : value;

    // Navigate to the correct nested location
    let current: any = result;
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i]!;
      // Create nested object if it doesn't exist
      if (!(key in current)) {
        current[key] = {};
      }
      current = current[key];
    }

    // Set the final value
    const finalKey = keys[keys.length - 1]!;
    current[finalKey] = mappedValue;
  }

  return result;
}
