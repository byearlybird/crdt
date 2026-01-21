/**
 * Flattens a nested object into a flat object with dot-notation keys
 * @param obj - The object to flatten
 * @param mapper - Optional callback to transform leaf values
 * @returns A flattened object with dot-notation keys
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
    if (!shouldTraverse(current)) {
      addLeaf(current, prefix);
      return;
    }

    for (const [key, value] of Object.entries(current)) {
      const newPath = prefix ? `${prefix}.${key}` : key;
      traverse(value, newPath);
    }
  }

  traverse(obj);
  return result;
}

/**
 * Unflattens a flat object with dot-notation keys into a nested object
 * @param obj - The flattened object to unflatten
 * @param mapper - Optional callback to transform leaf values before placing them
 * @returns A nested object
 */
export function unflatten<T = unknown, R = unknown>(
  obj: Record<string, T>,
  mapper?: (value: T, path: string) => R,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [path, value] of Object.entries(obj)) {
    const keys = path.split(".");
    const mappedValue = mapper ? mapper(value, path) : value;

    let current: Record<string, unknown> = result;
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i]!;
      if (!(key in current)) {
        current[key] = {};
      }
      current = current[key] as Record<string, unknown>;
    }

    const finalKey = keys[keys.length - 1]!;
    current[finalKey] = mappedValue;
  }

  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value.constructor === Object || Object.getPrototypeOf(value) === null)
  );
}

function shouldTraverse(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value) && Object.keys(value).length > 0;
}
