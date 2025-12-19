import { expect, test } from "bun:test";
import { createClock, createClockFromEventstamp } from "./clock";
import {
	decodeEventstamp,
	encodeEventstamp,
	generateNonce,
} from "./eventstamp";

test("now() returns 24-character hex eventstamp", () => {
	const clock = createClock();
	const eventstamp = clock.now();

	// Format: 24 lowercase hex characters
	expect(eventstamp).toMatch(/^[0-9a-f]{24}$/);
});

test("now() returns timestamps in strictly increasing order", () => {
	const clock = createClock();

	const stamp1 = clock.now();
	const stamp2 = clock.now();
	const stamp3 = clock.now();

	expect(stamp1 < stamp2).toBe(true);
	expect(stamp2 < stamp3).toBe(true);
});

test("counter increments when called multiple times in same millisecond", () => {
	const clock = createClock();

	const stamps = [];
	for (let i = 0; i < 5; i++) {
		stamps.push(clock.now());
	}

	// All should have same time (first 12 chars) but different counters
	const time = stamps[0]?.slice(0, 12);
	expect(time).toBeDefined();

	const counters = stamps.map((s) => {
		const counterHex = s.slice(12, 18);
		expect(counterHex).toBeDefined();
		return counterHex || "";
	});

	for (let i = 0; i < stamps.length; i++) {
		const timePart = stamps[i]?.slice(0, 12);
		expect(timePart).toBeDefined();
		expect(timePart).toBe(time);
	}

	// Counters should be sequential hex values
	for (let i = 0; i < counters.length - 1; i++) {
		// biome-ignore lint/style/noNonNullAssertion: <test>
		const current = parseInt(counters[i]!, 16);
		// biome-ignore lint/style/noNonNullAssertion: <test>
		const next = parseInt(counters[i + 1]!, 16);
		expect(next).toBe(current + 1);
	}
});

test("counter increments when clock is ahead of system time", () => {
	const clock = createClock();

	// Get initial eventstamp
	clock.now();

	// Move clock forward to a future eventstamp
	const futureEventstamp = encodeEventstamp({
		ms: Date.now() + 1000,
		counter: 0,
		nonce: generateNonce(),
	});
	clock.forward(futureEventstamp);

	// Real time hasn't advanced that much yet, so counter increments
	const stamp2 = clock.now();
	const counterPart = stamp2.slice(12, 18);
	expect(counterPart).toBeDefined();
	const counter2 = parseInt(counterPart || "", 16);

	// Counter should increment because real time <= forwarded lastMs
	expect(counter2).toBeGreaterThan(0);
});

test("latest() returns last recorded eventstamp", () => {
	const clock = createClock();

	const stamp = clock.now();
	const latest = clock.latest();

	expect(latest).toBe(stamp);
	expect(latest).toMatch(/^[0-9a-f]{24}$/);
});

test("forward() updates the clock when given a newer timestamp", () => {
	const clock = createClock();

	const initialStamp = clock.latest();
	const { ms } = decodeEventstamp(initialStamp);
	const newEventstamp = encodeEventstamp({
		ms: ms + 1000,
		counter: 0,
		nonce: generateNonce(),
	});

	clock.forward(newEventstamp);

	expect(clock.latest()).toBe(newEventstamp);
});

test("forward() ignores older timestamps", () => {
	const clock = createClock();

	clock.now();
	const currentStamp = clock.latest();

	const { ms } = decodeEventstamp(currentStamp);
	const olderEventstamp = encodeEventstamp({
		ms: ms - 100,
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
		nonce: "abcdef",
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
	const nonce = "abcdef";
	const eventstamp = encodeEventstamp({ ms, counter, nonce });

	const clock = createClockFromEventstamp(eventstamp);
	const decoded = decodeEventstamp(clock.latest());

	expect(decoded.ms).toBe(ms);
	expect(decoded.counter).toBe(counter);
	expect(decoded.nonce).toBe(nonce);
});

test("fromEventstamp() allows clock to continue from decoded state", () => {
	const eventstamp = encodeEventstamp({
		ms: Date.now(),
		counter: 10,
		nonce: generateNonce(),
	});
	const clock = createClockFromEventstamp(eventstamp);

	// Advance the clock
	const newStamp = clock.now();

	// Decode and check that counter incremented
	const decoded = decodeEventstamp(newStamp);
	expect(decoded.counter).toBeGreaterThan(10);
});

test("now() resets counter when system time advances", () => {
	// Initialize clock with a timestamp in the past
	const pastTimestamp = Date.now() - 1000;
	const clock = createClock({
		counter: 100,
		ms: pastTimestamp,
		nonce: "000000",
	});

	// Get a new eventstamp - wall clock should have advanced
	const stamp = clock.now();
	const decoded = decodeEventstamp(stamp);

	// Counter should be reset to 0 because wallMs > lastMs
	expect(decoded.counter).toBe(0);
	// Timestamp should be current, not the old one
	expect(decoded.ms).toBeGreaterThan(pastTimestamp);
});
