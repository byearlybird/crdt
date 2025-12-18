import type { AnyObject, JsonDocument } from "@byearlybird/starling";
import { createStore } from "@byearlybird/starling";
import { httpPlugin } from "@byearlybird/starling/plugin-http";
import { idbPlugin } from "@byearlybird/starling/plugin-idb";
import { z } from "zod";

export const statusSchema = z.enum(["todo", "doing", "done"]);

export const taskSchema = z.object({
	id: z.uuid().default(() => crypto.randomUUID()),
	status: statusSchema.default("todo"),
	title: z.string().min(1),
	createdAt: z.string().default(() => new Date().toISOString()),
});

export type Task = z.infer<typeof taskSchema>;
export type TaskInput = z.input<typeof taskSchema>;
export type Status = z.infer<typeof statusSchema>;

const syncBaseUrl = import.meta.env.VITE_STARLING_HTTP_BASE_URL;

const pseudoEncrypt = (data: unknown): string => {
	const jsonString = JSON.stringify(data);
	return btoa(jsonString);
};

const pseudoDecrypt = (encrypted: unknown): unknown => {
	if (typeof encrypted !== "string") {
		throw new Error("Expected encrypted data to be a string");
	}

	const jsonString = atob(encrypted);
	return JSON.parse(jsonString);
};

const isObject = (value: unknown): value is Record<string, unknown> => {
	return typeof value === "object" && value !== null && !Array.isArray(value);
};

const mapLeafValues = (
	value: unknown,
	fn: (value: unknown) => unknown,
): unknown => {
	if (Array.isArray(value)) {
		return value.map((entry) => mapLeafValues(entry, fn));
	}

	if (isObject(value)) {
		return Object.fromEntries(
			Object.entries(value).map(([key, entry]) => [
				key,
				mapLeafValues(entry, fn),
			]),
		);
	}

	return fn(value);
};

const encryptDocument = <T extends AnyObject>(
	document: JsonDocument<T>,
): JsonDocument<T> => {
	return {
		...document,
		data: document.data.map((resource) => ({
			...resource,
			attributes: mapLeafValues(resource.attributes, pseudoEncrypt) as T,
		})),
	} as JsonDocument<T>;
};

const decryptDocument = <T extends AnyObject>(
	document: JsonDocument<T>,
): JsonDocument<T> => {
	return {
		...document,
		data: document.data.map((resource) => ({
			...resource,
			attributes: mapLeafValues(resource.attributes, pseudoDecrypt) as T,
		})),
	} as JsonDocument<T>;
};

const store = createStore({
	name: "react-tasks",
	schema: {
		tasks: {
			schema: taskSchema,
			getId: (task) => task.id,
		},
	},
}).use(idbPlugin());

if (syncBaseUrl) {
	store.use(
		httpPlugin({
			baseUrl: syncBaseUrl,
			onRequest: <T extends AnyObject>({
				document,
			}: {
				document?: JsonDocument<T>;
			}) => (document ? { document: encryptDocument(document) } : undefined),
			onResponse: <T extends AnyObject>({
				document,
			}: {
				document: JsonDocument<T>;
			}) => ({
				document: decryptDocument(document),
			}),
		}),
	);
}

export const db = await store.init();

export type TaskStore = typeof db;
