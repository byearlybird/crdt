import { flatten, unflatten } from "./flatten";

type Field<T = unknown> = {
  "~value": T;
  "~stamp": string;
};

export type Document = Record<string, Field>;

/**
 * Takes an object and turns it into the "Document" format with the given stamp
 * @param fields - The object to turn into a Document
 * @param stamp - The stamp to use for the Document
 * @returns The Document
 */
export function makeDocument(
  fields: Record<string, any>,
  stamp: string,
): Document {
  return flatten(fields, (value) => ({ "~value": value, "~stamp": stamp }));
}

/**
 * Takes a Document and turns it into the object format
 * @param document - The Document to turn into an object
 * @returns The object
 */
export function parseDocument(document: Document): Record<string, any> {
  return unflatten(document, (field) => field["~value"]);
}
