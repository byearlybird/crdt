import type { Document } from "./document";

export function mergeDocuments(target: Document, source: Document): Document {
  const result: Document = {};
  const keys = new Set([...Object.keys(target), ...Object.keys(source)]);

  for (const key of keys) {
    const targetValue = target[key];
    const sourceValue = source[key];

    if (targetValue && sourceValue) {
      result[key] =
        targetValue["~stamp"] > sourceValue["~stamp"]
          ? targetValue
          : sourceValue;
    } else if (sourceValue || targetValue) {
      result[key] = (sourceValue ?? targetValue)!;
    } else {
      throw new Error(`Key ${key} not found in either document`);
    }
  }

  return result;
}
