import { expect, test } from "bun:test";
import { createClock, createClockFromEventstamp } from "./clock";
import {
	decodeEventstamp,
	encodeEventstamp,
	generateNonce,
} from "./eventstamp";

const EVENTSTAMP_FORMAT = /^[0-9a-f]{24}$/;
const MILLISECONDS_IN_FUTURE = 1000;
const MILLISECONDS_IN_PAST = 100;
const TEST_NONCE = "abcdef";

test("now() returns 24-character hex eventstamp", () => {
	const clock = createClock();
	const eventstamp = clock.now();

	expect(eventstamp).toMatch(EVENTSTAMP_FORMAT);
});

test("now() returns timestamps in strictly increasing order", () => {
	const clock = createClock();

	const first = clock.now();
	const second = clock.now();
	const third = clock.now();

	expect(first < second).toBe(true);
	expect(second < third).toBe(true);
});

test("counter increments when called multiple times in same millisecond", () => {
	const clock = createClock();
	const stampCount = 5;
	const stamps: string[] = [];

	for (let i = 0; i < stampCount; i++) {
		stamps.push(clock.now());
	}

	const firstTimestamp = stamps[0]!.slice(0, 12);
	const counters = stamps.map((stamp) => {
		const counterHex = stamp.slice(12, 18);
		return Number.parseInt(counterHex, 16);
	});

	for (const stamp of stamps) {
		const timestampPart = stamp.slice(0, 12);
		expect(timestampPart).toBe(firstTimestamp);
	}

	for (let i = 0; i < counters.length - 1; i++) {
		const current = counters[i]!;
		const next = counters[i + 1];
		expect(next).toBe(current + 1);
	}
});

test("counter increments when clock is ahead of system time", () => {
	const clock = createClock();
	clock.now();

	const futureEventstamp = encodeEventstamp({
		ms: Date.now() + MILLISECONDS_IN_FUTURE,
		counter: 0,
		nonce: generateNonce(),
	});
	clock.forward(futureEventstamp);

	const nextStamp = clock.now();
	const decoded = decodeEventstamp(nextStamp);

	expect(decoded.counter).toBeGreaterThan(0);
});

test("latest() returns last recorded eventstamp", () => {
	const clock = createClock();

	const stamp = clock.now();
	const latest = clock.latest();

	expect(latest).toBe(stamp);
	expect(latest).toMatch(EVENTSTAMP_FORMAT);
});

test("forward() updates the clock when given a newer timestamp", () => {
	const clock = createClock();

	const initialStamp = clock.latest();
	const { ms } = decodeEventstamp(initialStamp);
	const newerEventstamp = encodeEventstamp({
		ms: ms + MILLISECONDS_IN_FUTURE,
		counter: 0,
		nonce: generateNonce(),
	});

	clock.forward(newerEventstamp);

	expect(clock.latest()).toBe(newerEventstamp);
});

test("forward() ignores older timestamps", () => {
	const clock = createClock();

	clock.now();
	const currentStamp = clock.latest();

	const { ms } = decodeEventstamp(currentStamp);
	const olderEventstamp = encodeEventstamp({
		ms: ms - MILLISECONDS_IN_PAST,
		counter: 0,
		nonce: generateNonce(),
	});

	clock.forward(olderEventstamp);

	expect(clock.latest()).toBe(currentStamp);
});

test.each([
	["plain string", "invalid"],
	["too short", "00019c8f3a1e"],
	["too long", "00019c8f3a1e000001abcdef00"],
	["uppercase", "00019C8F3A1E000001ABCDEF"],
	["non-hex", "00019c8f3a1e000001xyz123"],
	["empty string", ""],
])(
	"forward() throws error for invalid eventstamp: %s",
	(_description, invalid) => {
		const clock = createClock();
		expect(() => clock.forward(invalid)).toThrow();
	},
);

test("fromEventstamp() creates clock from valid eventstamp", () => {
	const eventstamp = encodeEventstamp({
		ms: Date.now(),
		counter: 42,
		nonce: TEST_NONCE,
	});
	const clock = createClockFromEventstamp(eventstamp);

	expect(clock.latest()).toBe(eventstamp);
});

test.each([
	["plain string", "invalid"],
	["too short", "00019c8f3a1e"],
	["too long", "00019c8f3a1e000001abcdef00"],
	["uppercase", "00019C8F3A1E000001ABCDEF"],
	["non-hex", "00019c8f3a1e000001xyz123"],
])(
	"fromEventstamp() throws error for invalid eventstamp: %s",
	(_description, invalid) => {
		expect(() => createClockFromEventstamp(invalid)).toThrow();
	},
);

test("fromEventstamp() preserves timestamp, counter, and nonce", () => {
	const ms = Date.now();
	const counter = 123;
	const nonce = TEST_NONCE;
	const eventstamp = encodeEventstamp({ ms, counter, nonce });

	const clock = createClockFromEventstamp(eventstamp);
	const decoded = decodeEventstamp(clock.latest());

	expect(decoded.ms).toBe(ms);
	expect(decoded.counter).toBe(counter);
	expect(decoded.nonce).toBe(nonce);
});

test("fromEventstamp() allows clock to continue from decoded state", () => {
	const initialCounter = 10;
	const eventstamp = encodeEventstamp({
		ms: Date.now(),
		counter: initialCounter,
		nonce: generateNonce(),
	});
	const clock = createClockFromEventstamp(eventstamp);

	const nextStamp = clock.now();
	const decoded = decodeEventstamp(nextStamp);

	expect(decoded.counter).toBeGreaterThan(initialCounter);
});

test("now() resets counter when system time advances", () => {
	const pastTimestamp = Date.now() - MILLISECONDS_IN_FUTURE;
	const initialCounter = 100;
	const clock = createClock({
		counter: initialCounter,
		ms: pastTimestamp,
		nonce: "000000",
	});

	const stamp = clock.now();
	const decoded = decodeEventstamp(stamp);

	expect(decoded.counter).toBe(0);
	expect(decoded.ms).toBeGreaterThan(pastTimestamp);
});
