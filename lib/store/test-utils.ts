import { z } from "zod";
import { atomize, makeStamp, type AtomizedDocument, type Stamp } from "../core";
import { define } from "./schema";
import { createStore, Store } from "./store";

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

export const settingsSchema = z.object({
  id: z.string(),
  key: z.string(),
  value: z.string(),
});

// Timestamp generator helper
export function createTimestampGenerator(start = 1000) {
  let counter = start;
  return () => makeStamp(counter++, 0);
}

// Store creation helpers
export function createUserStore() {
  return createStore({
    users: define(userSchema, (data) => data.id),
  });
}

export function createProfileStore() {
  return new Store({
    users: define(profileSchema, (data) => data.id),
  });
}

export function createMultiCollectionStore() {
  return createStore({
    users: define(profileSchema, (data) => data.id),
    notes: define(noteSchema, (data) => data.id),
    settings: define(settingsSchema, (data) => data.id),
  });
}

// Document creation helpers
type UserDoc = { id: string; name: string };
type ProfileDoc = { id: string; name: string; profile: { age?: number; email?: string } };
type NoteDoc = { id: string; content: string };

export function createUserDoc(id: string, name: string, stamp: Stamp): AtomizedDocument<UserDoc> {
  return atomize({ id, name }, stamp);
}

export function createProfileDoc(
  id: string,
  name: string,
  profile: { age?: number; email?: string },
  stamp: Stamp,
): AtomizedDocument<ProfileDoc> {
  return atomize({ id, name, profile }, stamp);
}

export function createNoteDoc(
  id: string,
  content: string,
  stamp: Stamp,
): AtomizedDocument<NoteDoc> {
  return atomize({ id, content }, stamp);
}
