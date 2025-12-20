import { expect, test } from "bun:test";
import {
	decodeEventstamp,
	encodeEventstamp,
	generateNonce,
	isValidEventstamp,
	MIN_EVENTSTAMP,
	maxEventstamp,
} from "./eventstamp";

const MAX_24BIT_VALUE = 0xffffff;
const TEST_TIMESTAMP_MS = 1234567890123;
const TEST_COUNTER = 42;
const LARGER_TEST_COUNTER = 12345;

const VALID_EVENTSTAMP_A = "00019c8f3a1e000001abcdef";
const VALID_EVENTSTAMP_B = "00019c8f3a28000001abcdef";
const VALID_EVENTSTAMP_C = "00019c8f3a23000001abcdef";

test("decode() extracts timestamp and counter correctly", () => {
	const nonce = generateNonce();
	const eventstamp = encodeEventstamp({
		ms: TEST_TIMESTAMP_MS,
		counter: TEST_COUNTER,
		nonce,
	});
	const { ms, counter } = decodeEventstamp(eventstamp);

	expect(ms).toBe(TEST_TIMESTAMP_MS);
	expect(counter).toBe(TEST_COUNTER);
});

test("encode() decode() handles large counters", () => {
	const nonce = generateNonce();
	const eventstamp = encodeEventstamp({
		ms: Date.now(),
		counter: MAX_24BIT_VALUE,
		nonce,
	});
	const { ms, counter } = decodeEventstamp(eventstamp);

	expect(counter).toBe(MAX_24BIT_VALUE);
	expect(typeof ms).toBe("number");
	expect(ms).toBeGreaterThan(0);
});

test("encode() and decode() round-trip correctly", () => {
	const originalMs = Date.now();
	const originalCounter = LARGER_TEST_COUNTER;
	const originalNonce = generateNonce();

	const eventstamp = encodeEventstamp({
		ms: originalMs,
		counter: originalCounter,
		nonce: originalNonce,
	});
	const { ms, counter, nonce } = decodeEventstamp(eventstamp);

	expect(ms).toBe(originalMs);
	expect(counter).toBe(originalCounter);
	expect(nonce).toBe(originalNonce);
});

test("isValidEventstamp() returns true for standard format", () => {
	const nonce = generateNonce();
	const eventstamp = encodeEventstamp({
		ms: Date.now(),
		counter: TEST_COUNTER,
		nonce,
	});
	expect(isValidEventstamp(eventstamp)).toBe(true);
});

test("isValidEventstamp() returns true for large counter", () => {
	const maxCounterEventstamp = "000000000000ffffff123456";
	expect(isValidEventstamp(maxCounterEventstamp)).toBe(true);
});

test("isValidEventstamp() returns true for MIN_EVENTSTAMP", () => {
	expect(isValidEventstamp(MIN_EVENTSTAMP)).toBe(true);
});

test("isValidEventstamp() returns true for various valid timestamps", () => {
	expect(isValidEventstamp(VALID_EVENTSTAMP_A)).toBe(true);
	expect(isValidEventstamp("000000000000000000000000")).toBe(true);
	expect(isValidEventstamp("0001a2b3c4d5000ff1234567")).toBe(true);
});

test.each([
	["too short (23 chars)", "00019c8f3a1e000001abcde"],
	["too long (25 chars)", "00019c8f3a1e000001abcdef0"],
	["too short (12 chars)", "00019c8f3a1e"],
	["too short (1 char)", "0"],
	["empty string", ""],
	["uppercase hex (all)", "00019C8F3A1E000001ABCDEF"],
	["uppercase hex (partial)", "00019c8f3a1e000001ABCDEF"],
	["uppercase hex (single)", "00019c8f3a1e000001abCdef"],
	["non-hex chars (g)", "00019c8f3a1e000001abcdeg"],
	["non-hex chars (xyz)", "00019c8f3a1exyz001abcdef"],
	["non-hex chars (space)", "00019c8f3a1e 00001abcdef"],
	["non-hex chars (dash)", "00019c8f-3a1e-00001abcdef"],
	["non-hex chars (pipe)", "00019c8f3a1e|000001|abcdef"],
	["special chars (@)", "00019c8f3a1e000001abcd@f"],
	["unicode", "00019c8f3a1e000001ab🚀ef"],
])("isValidEventstamp() returns false for %s", (_description, eventstamp) => {
	expect(isValidEventstamp(eventstamp)).toBe(false);
});

test("maxEventstamp() returns MIN_EVENTSTAMP for empty array", () => {
	expect(maxEventstamp([])).toBe(MIN_EVENTSTAMP);
});

test("maxEventstamp() returns the only eventstamp for single-element array", () => {
	expect(maxEventstamp([VALID_EVENTSTAMP_A])).toBe(VALID_EVENTSTAMP_A);
});

test("maxEventstamp() returns the maximum eventstamp", () => {
	const eventstamps = [
		VALID_EVENTSTAMP_A,
		VALID_EVENTSTAMP_B,
		VALID_EVENTSTAMP_C,
	];

	expect(maxEventstamp(eventstamps)).toBe(VALID_EVENTSTAMP_B);
});

test("maxEventstamp() handles counters correctly", () => {
	const sameTimestamp = "00019c8f3a1e";
	const eventstamps = [
		`${sameTimestamp}000001abcdef`,
		`${sameTimestamp}000005abcdef`,
		`${sameTimestamp}000003abcdef`,
	];

	expect(maxEventstamp(eventstamps)).toBe(`${sameTimestamp}000005abcdef`);
});

test("maxEventstamp() handles nonces correctly as tie-breaker", () => {
	const sameTimestampAndCounter = "00019c8f3a1e000001";
	const eventstamps = [
		`${sameTimestampAndCounter}a1b2c3`,
		`${sameTimestampAndCounter}ffffff`,
		`${sameTimestampAndCounter}b2c3d4`,
	];

	expect(maxEventstamp(eventstamps)).toBe(`${sameTimestampAndCounter}ffffff`);
});

test("decodeEventstamp() throws InvalidEventstampError for invalid input", () => {
	expect(() => decodeEventstamp("invalid")).toThrow();
});

test("decodeEventstamp() throws for uppercase hex", () => {
	const uppercaseEventstamp = "00019C8F3A1E000001ABCDEF";
	expect(() => decodeEventstamp(uppercaseEventstamp)).toThrow();
});

test("decodeEventstamp() throws for wrong length", () => {
	const tooShortEventstamp = "00019c8f3a1e000001";
	expect(() => decodeEventstamp(tooShortEventstamp)).toThrow();
});
