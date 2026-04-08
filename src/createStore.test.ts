import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { collection, createStore } from "./createStore.ts";
import { AbortError, DisposedError, SchemaError } from "./errors.ts";
import type { StoreMutateEvent, StoreSubscribeEvent } from "./types.ts";

const TaskSchema = z.object({
	id: z.string(),
	title: z.string().min(1, "title required"),
	status: z.string(),
});

type Task = z.infer<typeof TaskSchema>;
type Note = { id: string; body: string };

const makeTask = (id: string, title = `Task ${id}`, status = "todo"): Task => ({
	id,
	title,
	status,
});
const makeNote = (id: string, body = `Note ${id}`): Note => ({ id, body });

describe("createStore", () => {
	describe("initialization", () => {
		test("creates store with multiple collections", () => {
			const store = createStore({
				tasks: collection({ getId: (t: Task) => t.id }),
				notes: collection({ getId: (n: Note) => n.id }),
			});

			expect(store.tasks.data.size).toBe(0);
			expect(store.notes.data.size).toBe(0);
		});

		test("initial data populates collections independently", () => {
			const store = createStore({
				tasks: collection({
					getId: (t: Task) => t.id,
					initial: [makeTask("1"), makeTask("2")],
				}),
				notes: collection({
					getId: (n: Note) => n.id,
					initial: [makeNote("n1")],
				}),
			});

			expect(store.tasks.data.size).toBe(2);
			expect(store.notes.data.size).toBe(1);
			expect(store.tasks.data.get("1")).toEqual(makeTask("1"));
			expect(store.notes.data.get("n1")).toEqual(makeNote("n1"));
		});

		test("returns the same data reference when unchanged", () => {
			const store = createStore({
				tasks: collection({
					getId: (t: Task) => t.id,
					initial: [makeTask("1")],
				}),
			});
			expect(store.tasks.data).toBe(store.tasks.data);
		});

		test("snapshot returns plain array", () => {
			const store = createStore({
				tasks: collection({
					getId: (t: Task) => t.id,
					initial: [makeTask("1"), makeTask("2")],
				}),
			});
			expect(store.tasks.snapshot()).toEqual([makeTask("1"), makeTask("2")]);
		});

		test("snapshot round-trips through initial", () => {
			const store = createStore({
				tasks: collection({
					getId: (t: Task) => t.id,
					initial: [makeTask("1")],
				}),
			});
			const snap = store.tasks.snapshot();
			const store2 = createStore({
				tasks: collection({ getId: (t: Task) => t.id, initial: snap }),
			});
			expect(store2.tasks.snapshot()).toEqual(snap);
		});

		test("snapshot reflects pending mutations", async () => {
			const store = createStore({
				tasks: collection({ getId: (t: Task) => t.id }),
			});
			let resolveGate!: () => void;
			const gate = new Promise<void>((r) => {
				resolveGate = r;
			});
			store.use(async () => {
				await gate;
			});

			const promise = store.tasks.insert(makeTask("1"));

			expect(store.tasks.snapshot().length).toBe(1);
			expect(store.tasks.snapshot()[0]?.id).toBe("1");

			resolveGate();
			await promise;
		});
	});

	describe("insert", () => {
		test("adds record to data", async () => {
			const store = createStore({
				tasks: collection({ getId: (t: Task) => t.id }),
			});
			const task = makeTask("1");
			await store.tasks.insert(task);
			expect(store.tasks.data.get("1")).toEqual(task);
		});

		test("throws on duplicate id", () => {
			const store = createStore({
				tasks: collection({
					getId: (t: Task) => t.id,
					initial: [makeTask("1")],
				}),
			});
			expect(() => store.tasks.insert(makeTask("1"))).toThrow("already exists");
		});

		test("optimistic insert visible before commit", async () => {
			const store = createStore({
				tasks: collection({ getId: (t: Task) => t.id }),
			});
			let resolveGate!: () => void;
			const gate = new Promise<void>((r) => {
				resolveGate = r;
			});
			store.use(async () => {
				await gate;
			});

			const promise = store.tasks.insert(makeTask("1"));
			expect(store.tasks.data.has("1")).toBe(true);

			resolveGate();
			await promise;
		});
	});

	describe("update", () => {
		test("applies partial updates to existing records", async () => {
			const original = makeTask("1");
			const store = createStore({
				tasks: collection({ getId: (t: Task) => t.id, initial: [original] }),
			});

			await store.tasks.update("1", { status: "done" });
			expect(store.tasks.data.get("1")).toEqual({
				...original,
				status: "done",
			});
		});

		test("updater function receives current state", async () => {
			const store = createStore({
				tasks: collection({
					getId: (t: Task) => t.id,
					initial: [makeTask("1")],
				}),
			});

			await store.tasks.update("1", (prev) => ({
				...prev,
				title: `${prev.title}!`,
			}));
			expect(store.tasks.data.get("1")?.title).toBe("Task 1!");
		});

		test("throws if record does not exist", () => {
			const store = createStore({
				tasks: collection({ getId: (t: Task) => t.id }),
			});
			expect(() => store.tasks.update("nope", { status: "done" })).toThrow(
				"does not exist",
			);
		});
	});

	describe("remove", () => {
		test("removes record from data", async () => {
			const store = createStore({
				tasks: collection({
					getId: (t: Task) => t.id,
					initial: [makeTask("1")],
				}),
			});
			await store.tasks.remove("1");
			expect(store.tasks.data.has("1")).toBe(false);
		});

		test("throws if record does not exist", () => {
			const store = createStore({
				tasks: collection({ getId: (t: Task) => t.id }),
			});
			expect(() => store.tasks.remove("nope")).toThrow("does not exist");
		});
	});

	describe("schema validation", () => {
		test("insert with failing schema throws SchemaError, record absent", () => {
			const store = createStore({
				tasks: collection({ schema: TaskSchema, getId: (t) => t.id }),
			});

			expect(() =>
				store.tasks.insert({ id: "1", title: "", status: "todo" }),
			).toThrow(SchemaError);
			expect(store.tasks.data.has("1")).toBe(false);
		});

		test("update with failing schema throws SchemaError, record unchanged", () => {
			const original = makeTask("1");
			const store = createStore({
				tasks: collection({
					schema: TaskSchema,
					getId: (t) => t.id,
					initial: [original],
				}),
			});

			expect(() => store.tasks.update("1", { title: "" })).toThrow(SchemaError);
			expect(store.tasks.data.get("1")).toEqual(original);
		});

		test("SchemaError exposes structured issues", () => {
			const store = createStore({
				tasks: collection({ schema: TaskSchema, getId: (t) => t.id }),
			});

			try {
				store.tasks.insert({ id: "1", title: "", status: "todo" });
				expect.unreachable("should have thrown");
			} catch (e) {
				expect(e).toBeInstanceOf(SchemaError);
				expect((e as SchemaError).issues[0]?.message).toBe("title required");
			}
		});

		test("remove does not trigger schema", async () => {
			let validated = false;
			const trackingSchema = TaskSchema.transform((v) => {
				validated = true;
				return v;
			});
			const store = createStore({
				tasks: collection({
					schema: trackingSchema,
					getId: (t) => t.id,
					initial: [makeTask("1")],
				}),
			});

			await store.tasks.remove("1");
			expect(validated).toBe(false);
		});

		test("T inferred from schema — no explicit generic needed", () => {
			const store = createStore({
				items: collection({
					schema: z.object({ id: z.string(), value: z.number() }),
					getId: (r) => r.id,
				}),
			});
			expect(() =>
				// @ts-expect-error — TypeScript rejects wrong shape, proving T was inferred
				store.items.insert({ id: "1", value: "not-a-number" }),
			).toThrow(SchemaError);
			void store.items.insert({ id: "2", value: 42 });
		});

		test("collection() helper infers getId param from schema", () => {
			const store = createStore({
				tasks: collection({ schema: TaskSchema, getId: (t) => t.id }),
			});
			createStore({
				// @ts-expect-error — t.nonexistent would error if getId param is properly typed
				tasks: collection({ schema: TaskSchema, getId: (t) => t.nonexistent }),
			});
			void store;
		});

		test("insert accepts input type when schema has defaults", async () => {
			const SchemaWithDefaults = z.object({
				id: z.string().default(() => crypto.randomUUID()),
				title: z.string(),
				status: z.string().default("todo"),
			});
			const store = createStore({
				tasks: collection({
					schema: SchemaWithDefaults,
					getId: (t) => t.id,
				}),
			});

			await store.tasks.insert({ title: "My task" });

			expect(store.tasks.data.size).toBe(1);
			const [record] = store.tasks.snapshot();
			expect(record?.title).toBe("My task");
			expect(record?.status).toBe("todo");
			expect(typeof record?.id).toBe("string");
			expect(record!.id.length).toBeGreaterThan(0);
		});

		test("insert with defaults: getId receives parsed output", async () => {
			const Schema = z.object({
				id: z.string().default(() => "generated-id"),
				name: z.string(),
			});
			const store = createStore({
				items: collection({
					schema: Schema,
					getId: (item) => item.id,
				}),
			});

			await store.items.insert({ name: "test" });

			expect(store.items.data.has("generated-id")).toBe(true);
			expect(store.items.data.get("generated-id")?.name).toBe("test");
		});

		test("batch insert accepts input type when schema has defaults", async () => {
			const Schema = z.object({
				id: z.string().default(() => "batch-id"),
				value: z.string(),
			});
			const store = createStore({
				items: collection({
					schema: Schema,
					getId: (r) => r.id,
				}),
			});

			await store.batch((tx) => {
				tx.items.insert({ value: "hello" });
			});

			expect(store.items.data.has("batch-id")).toBe(true);
			expect(store.items.data.get("batch-id")?.value).toBe("hello");
		});

		test("schema only applies to its collection, not others", async () => {
			const store = createStore({
				tasks: collection({ schema: TaskSchema, getId: (t) => t.id }),
				notes: collection({ getId: (n: Note) => n.id }),
			});

			// Notes have no schema — any shape works
			await store.notes.insert({ id: "n1", body: "free-form" });
			expect(store.notes.data.has("n1")).toBe(true);
		});
	});

	describe("subscriptions", () => {
		test("insert fires optimistic then commit with correct event shape", async () => {
			const store = createStore({
				tasks: collection({ getId: (t: Task) => t.id }),
			});
			const events: StoreSubscribeEvent[] = [];
			store.subscribe((e) => events.push(e));

			const task = makeTask("1");
			await store.tasks.insert(task);

			expect(events).toHaveLength(2);
			expect(events[0]).toEqual({
				type: "optimistic",
				event: {
					collection: "tasks",
					op: "insert",
					id: "1",
					record: task,
					previous: null,
				},
			});
			expect(events[1]).toEqual({
				type: "commit",
				event: {
					collection: "tasks",
					op: "insert",
					id: "1",
					record: task,
					previous: null,
				},
			});
		});

		test("events from multiple collections tagged with collection name", async () => {
			const store = createStore({
				tasks: collection({ getId: (t: Task) => t.id }),
				notes: collection({ getId: (n: Note) => n.id }),
			});
			const events: StoreSubscribeEvent[] = [];
			store.subscribe((e) => events.push(e));

			await store.tasks.insert(makeTask("1"));
			await store.notes.insert(makeNote("n1"));

			const commits = events.filter((e) => e.type === "commit");
			expect(
				commits[0]?.event.op !== "batch" && commits[0]?.event.collection,
			).toBe("tasks");
			expect(
				commits[1]?.event.op !== "batch" && commits[1]?.event.collection,
			).toBe("notes");
		});

		test("update fires with correct record and previous", async () => {
			const original = makeTask("1");
			const store = createStore({
				tasks: collection({ getId: (t: Task) => t.id, initial: [original] }),
			});
			const events: StoreSubscribeEvent[] = [];
			store.subscribe((e) => events.push(e));

			await store.tasks.update("1", { status: "done" });

			expect(events[1]).toEqual({
				type: "commit",
				event: {
					collection: "tasks",
					op: "update",
					id: "1",
					record: { ...original, status: "done" },
					previous: original,
				},
			});
		});

		test("remove fires with correct previous", async () => {
			const original = makeTask("1");
			const store = createStore({
				tasks: collection({ getId: (t: Task) => t.id, initial: [original] }),
			});
			const events: StoreSubscribeEvent[] = [];
			store.subscribe((e) => events.push(e));

			await store.tasks.remove("1");

			expect(events[1]).toEqual({
				type: "commit",
				event: {
					collection: "tasks",
					op: "remove",
					id: "1",
					record: null,
					previous: original,
				},
			});
		});

		test("unsubscribe stops notifications", async () => {
			const store = createStore({
				tasks: collection({ getId: (t: Task) => t.id }),
			});
			const events: StoreSubscribeEvent[] = [];
			const unsub = store.subscribe((e) => events.push(e));

			unsub();
			await store.tasks.insert(makeTask("1"));

			expect(events).toHaveLength(0);
		});

		test("throwing subscriber does not break store or other subscribers", async () => {
			const store = createStore({
				tasks: collection({ getId: (t: Task) => t.id }),
			});
			const goodEvents: StoreSubscribeEvent[] = [];

			store.subscribe(() => {
				throw new Error("bad subscriber");
			});
			store.subscribe((e) => goodEvents.push(e));

			await store.tasks.insert(makeTask("1"));

			expect(goodEvents).toHaveLength(2);
			expect(store.tasks.data.has("1")).toBe(true);
		});

		test("subscriber onError receives the thrown error and event", async () => {
			const store = createStore({
				tasks: collection({ getId: (t: Task) => t.id }),
			});
			const errors: Array<{ error: unknown; event: StoreSubscribeEvent }> = [];

			store.subscribe(
				() => {
					throw new Error("bad subscriber");
				},
				{
					onError(error, event) {
						errors.push({ error, event });
					},
				},
			);

			await store.tasks.insert(makeTask("1"));

			expect(errors).toHaveLength(2);
			expect((errors[0]?.error as Error).message).toBe("bad subscriber");
			expect(errors[0]?.event.type).toBe("optimistic");
			expect(errors[1]?.event.type).toBe("commit");
		});

		test("multiple subscribers all notified", async () => {
			const store = createStore({
				tasks: collection({ getId: (t: Task) => t.id }),
			});
			const events1: StoreSubscribeEvent[] = [];
			const events2: StoreSubscribeEvent[] = [];

			store.subscribe((e) => events1.push(e));
			store.subscribe((e) => events2.push(e));

			await store.tasks.insert(makeTask("1"));

			expect(events1).toHaveLength(2);
			expect(events2).toHaveLength(2);
		});

		test("notifies optimistic synchronously, commit after middleware", async () => {
			const store = createStore({
				tasks: collection({ getId: (t: Task) => t.id }),
			});
			const events: StoreSubscribeEvent[] = [];

			let resolveGate!: () => void;
			const gate = new Promise<void>((r) => {
				resolveGate = r;
			});
			store.use(async () => {
				await gate;
			});
			store.subscribe((e) => events.push(e));

			const promise = store.tasks.insert(makeTask("1"));

			expect(events.length).toBe(1);
			expect(events[0]?.type).toBe("optimistic");

			resolveGate();
			await promise;

			expect(events.length).toBe(2);
			expect(events[1]?.type).toBe("commit");
		});
	});

	describe("middleware", () => {
		test("commits mutation after synchronous middleware", async () => {
			const store = createStore({
				tasks: collection({ getId: (t: Task) => t.id }),
			});
			const seen: string[] = [];
			store.use((ctx) => {
				seen.push(ctx.event.op);
			});

			await store.tasks.insert(makeTask("1"));
			expect(seen).toEqual(["insert"]);
		});

		test("middleware receives collection-tagged event", async () => {
			const store = createStore({
				tasks: collection({ getId: (t: Task) => t.id }),
				notes: collection({ getId: (n: Note) => n.id }),
			});
			const collections: string[] = [];
			store.use((ctx) => {
				if (ctx.event.op !== "batch") collections.push(ctx.event.collection);
			});

			await store.tasks.insert(makeTask("1"));
			await store.notes.insert(makeNote("n1"));

			expect(collections).toEqual(["tasks", "notes"]);
		});

		test("commits mutation after async middleware resolves", async () => {
			const store = createStore({
				tasks: collection({ getId: (t: Task) => t.id }),
			});
			let middlewareRan = false;
			store.use(async () => {
				await new Promise((r) => setTimeout(r, 10));
				middlewareRan = true;
			});

			const task = makeTask("1");
			const promise = store.tasks.insert(task);

			expect(store.tasks.data.has("1")).toBe(true);
			expect(middlewareRan).toBe(false);

			await promise;
			expect(middlewareRan).toBe(true);
		});

		test("middleware ordering respected", async () => {
			const store = createStore({
				tasks: collection({ getId: (t: Task) => t.id }),
			});
			const order: number[] = [];
			store.use(() => {
				order.push(1);
			});
			store.use(() => {
				order.push(2);
			});
			store.use(() => {
				order.push(3);
			});

			await store.tasks.insert(makeTask("1"));
			expect(order).toEqual([1, 2, 3]);
		});

		test("middleware unsubscribe works", async () => {
			const store = createStore({
				tasks: collection({ getId: (t: Task) => t.id }),
			});
			const calls: string[] = [];
			const unsub = store.use(() => {
				calls.push("mw");
			});

			unsub();
			await store.tasks.insert(makeTask("1"));

			expect(calls).toEqual([]);
			expect(store.tasks.data.has("1")).toBe(true);
		});

		test("aborted mutation is rolled back and rejects with AbortError", async () => {
			const store = createStore({
				tasks: collection({ getId: (t: Task) => t.id }),
			});
			const events: StoreSubscribeEvent[] = [];
			store.subscribe((e) => events.push(e));
			store.use((ctx) => {
				ctx.abort("denied");
			});

			await expect(store.tasks.insert(makeTask("1"))).rejects.toBeInstanceOf(
				AbortError,
			);
			expect(store.tasks.data.has("1")).toBe(false);

			const rollback = events.find((e) => e.type === "rollback");
			expect(rollback).toBeDefined();
			expect(rollback?.type === "rollback" && rollback?.reason).toBeInstanceOf(
				AbortError,
			);
			if (rollback?.type === "rollback") {
				expect((rollback.reason as AbortError).reason).toBe("denied");
			}
		});

		test("middleware error rolls back mutation and rejects with the error", async () => {
			const store = createStore({
				tasks: collection({ getId: (t: Task) => t.id }),
			});
			const customErr = new Error("custom");
			store.use(() => {
				throw customErr;
			});

			await expect(store.tasks.insert(makeTask("1"))).rejects.toBe(customErr);
			expect(store.tasks.data.has("1")).toBe(false);
		});

	});

	describe("mutation ordering", () => {
		test("second mutation waits for first to complete", async () => {
			const store = createStore({
				tasks: collection({ getId: (t: Task) => t.id }),
			});
			const order: string[] = [];
			let resolveFirst!: () => void;
			const firstGate = new Promise<void>((r) => {
				resolveFirst = r;
			});
			let resolveSecond!: () => void;
			const secondGate = new Promise<void>((r) => {
				resolveSecond = r;
			});

			store.use(async (ctx) => {
				const id = ctx.event.op !== "batch" ? ctx.event.id : "other";
				order.push(`start:${id}`);
				if (id === "1") await firstGate;
				if (id === "2") await secondGate;
				order.push(`end:${id}`);
			});

			const p1 = store.tasks.insert(makeTask("1"));
			const p2 = store.tasks.insert(makeTask("2"));

			expect(store.tasks.data.has("1")).toBe(true);
			expect(store.tasks.data.has("2")).toBe(true);
			expect(order).toEqual(["start:1"]);

			resolveFirst();
			await p1;
			expect(order).toEqual(["start:1", "end:1", "start:2"]);

			resolveSecond();
			await p2;
			expect(order).toEqual(["start:1", "end:1", "start:2", "end:2"]);
		});

		test("mutations share a single serial queue across collections", async () => {
			const store = createStore({
				tasks: collection({ getId: (t: Task) => t.id }),
				notes: collection({ getId: (n: Note) => n.id }),
			});
			const order: string[] = [];
			let resolveGate!: () => void;
			const gate = new Promise<void>((r) => {
				resolveGate = r;
			});

			store.use(async (ctx) => {
				const col = ctx.event.op !== "batch" ? ctx.event.collection : "batch";
				if (col === "tasks") await gate;
				order.push(col);
			});

			const p1 = store.tasks.insert(makeTask("1"));
			const p2 = store.notes.insert(makeNote("n1"));

			// notes is blocked by tasks in the shared queue
			expect(order).toEqual([]);

			resolveGate();
			await Promise.all([p1, p2]);
			expect(order).toEqual(["tasks", "notes"]);
		});
	});

	describe("rollback & rebase", () => {
		test("failed insert does not affect independent insert", async () => {
			const store = createStore({
				tasks: collection({ getId: (t: Task) => t.id }),
			});
			store.use(async (ctx) => {
				await Promise.resolve();
				if (ctx.event.op === "insert" && ctx.event.id === "A") {
					ctx.abort("fail A");
				}
			});

			const pA = store.tasks.insert(makeTask("A"));
			const pB = store.tasks.insert(makeTask("B"));

			expect(store.tasks.data.has("A")).toBe(true);
			expect(store.tasks.data.has("B")).toBe(true);

			await expect(pA).rejects.toBeInstanceOf(AbortError);
			await pB;

			expect(store.tasks.data.has("A")).toBe(false);
			expect(store.tasks.data.has("B")).toBe(true);
		});

		test("updater re-evaluates against committed base after rollback", async () => {
			type CountTask = {
				id: string;
				title: string;
				status: string;
				count: number;
			};
			const initial: CountTask = {
				id: "B",
				title: "Task B",
				status: "todo",
				count: 0,
			};
			const store = createStore({
				tasks: collection({
					getId: (t: CountTask) => t.id,
					initial: [initial],
				}),
			});

			store.use(async (ctx) => {
				await Promise.resolve();
				if (ctx.event.op === "insert" && ctx.event.id === "A")
					ctx.abort("fail A");
			});

			const pA = store.tasks.insert({
				id: "A",
				title: "Task A",
				status: "todo",
				count: 0,
			});
			const pB = store.tasks.update("B" as string, (prev) => ({
				...prev,
				count: (prev as CountTask).count + 1,
			}));

			await expect(pA).rejects.toBeInstanceOf(AbortError);
			await pB;

			expect((store.tasks.data.get("B") as CountTask | undefined)?.count).toBe(
				1,
			);
		});

		test("cascade: update on failed insert is also rolled back", async () => {
			const store = createStore({
				tasks: collection({ getId: (t: Task) => t.id }),
			});
			const events: StoreSubscribeEvent[] = [];
			store.subscribe((e) => events.push(e));
			store.use(async (ctx) => {
				await Promise.resolve();
				if (ctx.event.op === "insert" && ctx.event.id === "A")
					ctx.abort("fail A");
			});

			const pInsert = store.tasks.insert(makeTask("A"));
			const pUpdate = store.tasks.update("A" as string, { status: "done" });

			const [rInsert, rUpdate] = await Promise.allSettled([pInsert, pUpdate]);
			expect(rInsert.status).toBe("rejected");
			expect(rUpdate.status).toBe("rejected");
			expect(store.tasks.data.has("A")).toBe(false);

			const rollbacks = events.filter((e) => e.type === "rollback");
			expect(rollbacks.length).toBe(2);
		});

		test("cascaded promises reject with upstream error", async () => {
			const store = createStore({
				tasks: collection({ getId: (t: Task) => t.id }),
			});
			store.use(async (ctx) => {
				await Promise.resolve();
				if (ctx.event.op === "insert" && ctx.event.id === "A")
					ctx.abort("upstream");
			});

			const pInsert = store.tasks.insert(makeTask("A"));
			const pUpdate = store.tasks.update("A" as string, { status: "done" });

			let insertErr: unknown;
			let updateErr: unknown;
			try {
				await pInsert;
			} catch (e) {
				insertErr = e;
			}
			try {
				await pUpdate;
			} catch (e) {
				updateErr = e;
			}

			expect(insertErr).toBeInstanceOf(AbortError);
			expect(updateErr).toBe(insertErr);
		});
	});

	describe("batch", () => {
		test("single-collection batch: ops all appear in data", async () => {
			const store = createStore({
				tasks: collection({
					getId: (t: Task) => t.id,
					initial: [makeTask("1")],
				}),
			});

			await store.batch((tx) => {
				tx.tasks.insert(makeTask("2"));
				tx.tasks.insert(makeTask("3"));
				tx.tasks.update("1", { status: "done" });
			});

			expect(store.tasks.data.size).toBe(3);
			expect(store.tasks.data.get("1")?.status).toBe("done");
			expect(store.tasks.data.has("2")).toBe(true);
			expect(store.tasks.data.has("3")).toBe(true);
		});

		test("cross-collection batch: atomic commit across collections", async () => {
			const store = createStore({
				tasks: collection({
					getId: (t: Task) => t.id,
					initial: [makeTask("1")],
				}),
				notes: collection({ getId: (n: Note) => n.id }),
			});

			await store.batch((tx) => {
				tx.tasks.update("1", { status: "done" });
				tx.notes.insert(makeNote("n1"));
			});

			expect(store.tasks.data.get("1")?.status).toBe("done");
			expect(store.notes.data.has("n1")).toBe(true);
		});

		test("cross-collection batch: atomic rollback on middleware abort", async () => {
			const store = createStore({
				tasks: collection({
					getId: (t: Task) => t.id,
					initial: [makeTask("1")],
				}),
				notes: collection({ getId: (n: Note) => n.id }),
			});
			store.use(() => {
				throw new Error("fail");
			});

			await expect(
				store.batch((tx) => {
					tx.tasks.update("1", { status: "done" });
					tx.notes.insert(makeNote("n1"));
				}),
			).rejects.toThrow("fail");

			// Both rolled back
			expect(store.tasks.data.get("1")?.status).toBe("todo");
			expect(store.notes.data.has("n1")).toBe(false);
		});

		test("middleware receives single batch event with all mutations", async () => {
			const store = createStore({
				tasks: collection({ getId: (t: Task) => t.id }),
				notes: collection({ getId: (n: Note) => n.id }),
			});
			const events: StoreMutateEvent[] = [];
			store.use((ctx) => {
				events.push(ctx.event);
			});

			await store.batch((tx) => {
				tx.tasks.insert(makeTask("1"));
				tx.notes.insert(makeNote("n1"));
			});

			expect(events).toHaveLength(1);
			expect(events[0]?.op).toBe("batch");
			if (events[0]?.op === "batch") {
				expect(events[0].mutations).toHaveLength(2);
				expect(events[0].mutations[0]?.collection).toBe("tasks");
				expect(events[0].mutations[1]?.collection).toBe("notes");
			}
		});

		test("subscriber receives optimistic immediately, commit after pipeline", async () => {
			const store = createStore({
				tasks: collection({ getId: (t: Task) => t.id }),
			});
			const events: StoreSubscribeEvent[] = [];
			let resolveGate!: () => void;
			const gate = new Promise<void>((r) => {
				resolveGate = r;
			});
			store.use(async () => {
				await gate;
			});
			store.subscribe((e) => events.push(e));

			const promise = store.batch((tx) => {
				tx.tasks.insert(makeTask("1"));
				tx.tasks.insert(makeTask("2"));
			});

			expect(events).toHaveLength(1);
			expect(events[0]?.type).toBe("optimistic");
			expect(events[0]?.event.op).toBe("batch");
			expect(store.tasks.data.size).toBe(2);

			resolveGate();
			await promise;

			expect(events).toHaveLength(2);
			expect(events[1]?.type).toBe("commit");
		});

		test("tx.insert then tx.update on same ID", async () => {
			const store = createStore({
				tasks: collection({ getId: (t: Task) => t.id }),
			});

			await store.batch((tx) => {
				tx.tasks.insert(makeTask("1"));
				tx.tasks.update("1", { status: "done" });
			});

			expect(store.tasks.data.get("1")?.status).toBe("done");
		});

		test("tx.insert then tx.remove on same ID", async () => {
			const store = createStore({
				tasks: collection({ getId: (t: Task) => t.id }),
			});

			await store.batch((tx) => {
				tx.tasks.insert(makeTask("1"));
				tx.tasks.remove("1");
			});

			expect(store.tasks.data.has("1")).toBe(false);
		});

		test("invalid operation in batch throws synchronously", () => {
			const store = createStore({
				tasks: collection({ getId: (t: Task) => t.id }),
			});

			expect(() => {
				store.batch((tx) => {
					tx.tasks.update("nope", { status: "done" });
				});
			}).toThrow("does not exist");

			expect(store.tasks.data.size).toBe(0);
		});

		test("exception in batch callback prevents enqueue", () => {
			const store = createStore({
				tasks: collection({ getId: (t: Task) => t.id }),
			});
			let mwCalled = false;
			store.use(() => {
				mwCalled = true;
			});

			expect(() => {
				store.batch(() => {
					throw new Error("user error");
				});
			}).toThrow("user error");

			expect(mwCalled).toBe(false);
			expect(store.tasks.data.size).toBe(0);
		});

		test("empty batch resolves without triggering middleware", async () => {
			const store = createStore({
				tasks: collection({ getId: (t: Task) => t.id }),
			});
			let mwCalled = false;
			store.use(() => {
				mwCalled = true;
			});

			await store.batch(() => {});

			expect(mwCalled).toBe(false);
		});

		test("batch interacts correctly with queue ordering", async () => {
			const store = createStore({
				tasks: collection({ getId: (t: Task) => t.id }),
			});
			const order: string[] = [];
			store.use(async (ctx) => {
				order.push(ctx.event.op);
				await Promise.resolve();
			});

			const p1 = store.tasks.insert(makeTask("1"));
			const pBatch = store.batch((tx) => {
				tx.tasks.insert(makeTask("2"));
				tx.tasks.insert(makeTask("3"));
			});
			const p3 = store.tasks.insert(makeTask("4"));

			await Promise.all([p1, pBatch, p3]);

			expect(order).toEqual(["insert", "batch", "insert"]);
			expect(store.tasks.data.size).toBe(4);
		});

		test("cascade: later intent depending on batch insert is cascaded", async () => {
			const store = createStore({
				tasks: collection({ getId: (t: Task) => t.id }),
			});
			store.use(async (ctx) => {
				await Promise.resolve();
				if (ctx.event.op === "batch") throw new Error("batch fail");
			});

			const pBatch = store.batch((tx) => {
				tx.tasks.insert(makeTask("A"));
			});
			const pUpdate = store.tasks.update("A" as string, { status: "done" });

			const [rBatch, rUpdate] = await Promise.allSettled([pBatch, pUpdate]);
			expect(rBatch.status).toBe("rejected");
			expect(rUpdate.status).toBe("rejected");
			expect(store.tasks.data.has("A")).toBe(false);
		});

		test("batch schema validation per-collection", () => {
			const store = createStore({
				tasks: collection({ schema: TaskSchema, getId: (t) => t.id }),
			});

			expect(() => {
				store.batch((tx) => {
					tx.tasks.insert({ id: "1", title: "", status: "todo" });
				});
			}).toThrow(SchemaError);

			expect(store.tasks.data.size).toBe(0);
		});

		test("batch replace: remove+insert same ID is atomic in optimistic view", async () => {
			const store = createStore({
				tasks: collection({
					getId: (t: Task) => t.id,
					initial: [makeTask("1", "old")],
				}),
			});
			let resolveGate!: () => void;
			const gate = new Promise<void>((r) => {
				resolveGate = r;
			});
			store.use(async () => {
				await gate;
			});

			const promise = store.batch((tx) => {
				tx.tasks.remove("1");
				tx.tasks.insert(makeTask("1", "new"));
			});

			// Optimistic view: old record gone, new record visible atomically
			expect(store.tasks.data.has("1")).toBe(true);
			expect(store.tasks.data.get("1")?.title).toBe("new");

			resolveGate();
			await promise;

			expect(store.tasks.data.get("1")?.title).toBe("new");
		});
	});

	describe("dispose", () => {
		test("rejects pending mutation promises with DisposedError", async () => {
			const store = createStore({
				tasks: collection({ getId: (t: Task) => t.id }),
			});
			let resolveGate!: () => void;
			const gate = new Promise<void>((r) => {
				resolveGate = r;
			});
			store.use(async () => {
				await gate;
			});

			const promise = store.tasks.insert(makeTask("1"));
			store.dispose();

			await expect(promise).rejects.toBeInstanceOf(DisposedError);
			resolveGate();
		});

		test("all operations throw DisposedError after dispose", () => {
			const store = createStore({
				tasks: collection({
					getId: (t: Task) => t.id,
					initial: [makeTask("1")],
				}),
			});
			store.dispose();

			expect(() => store.tasks.insert(makeTask("2"))).toThrow(DisposedError);
			expect(() => store.tasks.update("1", { status: "done" })).toThrow(
				DisposedError,
			);
			expect(() => store.tasks.remove("1")).toThrow(DisposedError);
			expect(() =>
				store.batch((tx) => {
					tx.tasks.insert(makeTask("3"));
				}),
			).toThrow(DisposedError);
		});

		test("clears all collection data", () => {
			const store = createStore({
				tasks: collection({
					getId: (t: Task) => t.id,
					initial: [makeTask("1"), makeTask("2")],
				}),
				notes: collection({
					getId: (n: Note) => n.id,
					initial: [makeNote("n1")],
				}),
			});

			store.dispose();

			expect(store.tasks.data.size).toBe(0);
			expect(store.tasks.snapshot()).toEqual([]);
			expect(store.notes.data.size).toBe(0);
			expect(store.notes.snapshot()).toEqual([]);
		});

		test("multiple pending mutations all rejected", async () => {
			const store = createStore({
				tasks: collection({ getId: (t: Task) => t.id }),
			});
			let resolveGate!: () => void;
			const gate = new Promise<void>((r) => {
				resolveGate = r;
			});
			store.use(async () => {
				await gate;
			});

			const p1 = store.tasks.insert(makeTask("1"));
			const p2 = store.tasks.insert(makeTask("2"));
			const p3 = store.tasks.insert(makeTask("3"));

			store.dispose();

			const results = await Promise.allSettled([p1, p2, p3]);
			for (const result of results) {
				expect(result.status).toBe("rejected");
				expect((result as PromiseRejectedResult).reason).toBeInstanceOf(
					DisposedError,
				);
			}
			resolveGate();
		});

	});
});
