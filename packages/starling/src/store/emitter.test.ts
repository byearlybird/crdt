import { expect, test } from "bun:test";
import { createEmitter } from "./emitter";

test("emitter: on and emit", () => {
	type Events = { greet: string };
	const emitter = createEmitter<Events>();

	let payload: string | undefined;
	emitter.on("greet", (p) => {
		payload = p;
	});

	emitter.emit("greet", "hello");
	expect(payload).toBe("hello");
});

test("emitter: unsubscribe", () => {
	type Events = { count: number };
	const emitter = createEmitter<Events>();

	let calls = 0;
	const unsub = emitter.on("count", () => calls++);

	emitter.emit("count", 1);
	expect(calls).toBe(1);

	unsub();
	emitter.emit("count", 2);
	expect(calls).toBe(1);
});

test("emitter: multiple handlers", () => {
	type Events = { data: number };
	const emitter = createEmitter<Events>();

	const results: number[] = [];
	emitter.on("data", (p) => results.push(p * 2));
	emitter.on("data", (p) => results.push(p * 3));

	emitter.emit("data", 5);
	expect(results).toEqual([10, 15]);
});

test("emitter: multiple event types", () => {
	type Events = {
		add: { x: number; y: number };
		name: string;
	};

	const emitter = createEmitter<Events>();

	let sum = 0;
	let name = "";

	emitter.on("add", (p) => {
		sum = p.x + p.y;
	});
	emitter.on("name", (p) => {
		name = p;
	});

	emitter.emit("add", { x: 2, y: 3 });
	emitter.emit("name", "alice");

	expect(sum).toBe(5);
	expect(name).toBe("alice");
});

test("emitter: clear", () => {
	type Events = { test: string };
	const emitter = createEmitter<Events>();

	let calls = 0;
	emitter.on("test", () => calls++);

	emitter.emit("test", "1");
	emitter.clear();
	emitter.emit("test", "2");

	expect(calls).toBe(1);
});

test("emitter: undefined payload", () => {
	type Events = { tick: undefined };
	const emitter = createEmitter<Events>();

	let called = false;
	emitter.on("tick", () => {
		called = true;
	});

	emitter.emit("tick", undefined);
	expect(called).toBe(true);
});

test("emitter: handlers called in order", () => {
	type Events = { seq: number };
	const emitter = createEmitter<Events>();

	const order: number[] = [];
	emitter.on("seq", () => order.push(1));
	emitter.on("seq", () => order.push(2));
	emitter.on("seq", () => order.push(3));

	emitter.emit("seq", 0);
	expect(order).toEqual([1, 2, 3]);
});
