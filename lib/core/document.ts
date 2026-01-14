import { flatten, unflatten } from "./flatten";

type Field<T = unknown> = {
  "~value": T;
  "~stamp": string;
};

export type Document = Record<string, Field>;

export function makeDocument(fields: Record<string, any>, stamp: string): Document {
  return flatten(fields, (value) => ({ "~value": value, "~stamp": stamp }));
}

export function parseDocument(document: Document): Record<string, any> {
  return unflatten(document, (field) => field["~value"]);
}

export function mergeDocuments(target: Document, source: Document): Document {
  const result: Document = {};
  const keys = new Set([...Object.keys(target), ...Object.keys(source)]);

  for (const key of keys) {
    const targetValue = target[key];
    const sourceValue = source[key];

    if (targetValue && sourceValue) {
      result[key] = targetValue["~stamp"] > sourceValue["~stamp"] ? targetValue : sourceValue;
    } else if (targetValue) {
      result[key] = targetValue;
    } else if (sourceValue) {
      result[key] = sourceValue;
    } else {
      throw new Error(`Key ${key} not found in either document`);
    }
  }

  return result;
}
