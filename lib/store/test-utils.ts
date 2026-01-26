import { z } from "zod";
import { Atomizer, makeStamp, type Document } from "../core";
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
      users: { schema: userSchema, getId: (data) => data.id },
    },
  });
}

export function createProfileStore() {
  return createStore({
    collections: {
      users: { schema: profileSchema, getId: (data) => data.id },
    },
  });
}

export function createMultiCollectionStore() {
  return createStore({
    collections: {
      users: { schema: profileSchema, getId: (data) => data.id },
      notes: { schema: noteSchema, getId: (data) => data.id },
    },
  });
}

// Document creation helpers
export function createUserDoc(id: string, name: string, stamp: string): Document {
  return Atomizer.atomize({ id, name }, stamp);
}

export function createProfileDoc(
  id: string,
  name: string,
  profile: { age?: number; email?: string },
  stamp: string,
): Document {
  return Atomizer.atomize({ id, name, profile }, stamp);
}

export function createNoteDoc(id: string, content: string, stamp: string): Document {
  return Atomizer.atomize({ id, content }, stamp);
}
