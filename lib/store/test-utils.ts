import { z } from "zod";
import { makeStamp } from "../core";
import type { Document } from "../core-two";
import { atomizeDocument } from "./write";
import { createStore } from "./store";

// Shared test schemas
export const userSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const profileSchema = z.object({
  id: z.string(),
  name: z.string(),
  profile: z.object({
    age: z.number().optional(),
    email: z.string().optional(),
  }),
});

export const noteSchema = z.object({
  id: z.string(),
  content: z.string(),
});

// Timestamp generator helper
export function createTimestampGenerator(start = 1000) {
  let counter = start;
  return () => makeStamp(counter++, 0);
}

// Store creation helpers
export function createUserStore() {
  return createStore({
    collections: {
      users: { schema: userSchema, keyPath: "id" },
    },
  });
}

export function createProfileStore() {
  return createStore({
    collections: {
      users: { schema: profileSchema, keyPath: "id" },
    },
  });
}

export function createMultiCollectionStore() {
  return createStore({
    collections: {
      users: { schema: profileSchema, keyPath: "id" },
      notes: { schema: noteSchema, keyPath: "id" },
    },
  });
}

// Document creation helpers
export function createUserDoc(id: string, name: string, stamp: string): Document {
  return atomizeDocument({ id, name }, stamp);
}

export function createProfileDoc(
  id: string,
  name: string,
  profile: { age?: number; email?: string },
  stamp: string,
): Document {
  return atomizeDocument({ id, name, profile }, stamp);
}

export function createNoteDoc(id: string, content: string, stamp: string): Document {
  return atomizeDocument({ id, content }, stamp);
}
