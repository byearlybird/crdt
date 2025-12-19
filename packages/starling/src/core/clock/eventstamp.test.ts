import { expect, test } from "bun:test";
import {
	decodeEventstamp,
	encodeEventstamp,
	generateNonce,
	isValidEventstamp,
	MIN_EVENTSTAMP,
	maxEventstamp,
} from "./eventstamp";

test("decode() extracts timestamp and counter correctly", () => {
	const nonce = generateNonce();
	const eventstamp = encodeEventstamp({
		ms: 1234567890123,
		counter: 42,
		nonce,
	});
	const { ms, counter } = decodeEventstamp(eventstamp);

	expect(ms).toBe(1234567890123);
	expect(counter).toBe(42);
});

test("encode() decode() handles large counters", () => {
	const nonce = generateNonce();
	const eventstamp = encodeEventstamp({
		ms: Date.now(),
		counter: 0xffffffff,
		nonce,
	});
	const { ms, counter } = decodeEventstamp(eventstamp);

	expect(counter).toBe(0xffffffff);
	expect(typeof ms).toBe("number");
	expect(ms).toBeGreaterThan(0);
});

test("encode() and decode() round-trip correctly", () => {
	const originalMs = Date.now();
	const originalCounter = 12345;
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

// ============================================================================
// isValidEventstamp() tests
// ============================================================================

test("isValidEventstamp() returns true for standard format", () => {
	const nonce = generateNonce();
	const eventstamp = encodeEventstamp({ ms: Date.now(), counter: 42, nonce });
	expect(isValidEventstamp(eventstamp)).toBe(true);
});

test("isValidEventstamp() returns true for large counter (8 hex chars)", () => {
	expect(isValidEventstamp("2025-01-01T00:00:00.000Z|ffffffff|a1b2")).toBe(
		true,
	);
});

test("isValidEventstamp() returns true for MIN_EVENTSTAMP", () => {
	expect(isValidEventstamp(MIN_EVENTSTAMP)).toBe(true);
});

test("isValidEventstamp() returns true for various valid timestamps", () => {
	expect(isValidEventstamp("2025-12-31T23:59:59.999Z|0001|abcd")).toBe(true);
	expect(isValidEventstamp("2020-01-01T00:00:00.000Z|0000|0000")).toBe(true);
	expect(isValidEventstamp("2025-06-15T12:30:45.123Z|00ff|1234")).toBe(true);
});

test.each([
	["missing nonce", "2025-01-01T00:00:00.000Z|0001"],
	["missing counter", "2025-01-01T00:00:00.000Z|a1b2"],
	["invalid ISO (no time)", "2025-01-01|0001|a1b2"],
	["invalid ISO (slashes)", "2025/01/01T00:00:00.000Z|0001|a1b2"],
	["invalid ISO (single digits)", "2025-1-1T00:00:00.000Z|0001|a1b2"],
	["invalid ISO (no millis)", "2025-01-01T00:00:00Z|0001|a1b2"],
	["wrong delimiter (colon)", "2025-01-01T00:00:00.000Z:0001:a1b2"],
	["wrong delimiter (dash)", "2025-01-01T00:00:00.000Z-0001-a1b2"],
	["wrong delimiter (space)", "2025-01-01T00:00:00.000Z 0001 a1b2"],
	["uppercase hex in counter", "2025-01-01T00:00:00.000Z|ABCD|a1b2"],
	["uppercase hex in counter (mixed)", "2025-01-01T00:00:00.000Z|00FF|a1b2"],
	["uppercase hex in nonce", "2025-01-01T00:00:00.000Z|0001|ABCD"],
	["uppercase hex in nonce (mixed)", "2025-01-01T00:00:00.000Z|0001|A1B2"],
	["counter too short (3 chars)", "2025-01-01T00:00:00.000Z|001|a1b2"],
	["counter too short (2 chars)", "2025-01-01T00:00:00.000Z|01|a1b2"],
	["counter too short (1 char)", "2025-01-01T00:00:00.000Z|1|a1b2"],
	["nonce too short (3 chars)", "2025-01-01T00:00:00.000Z|0001|a1b"],
	["nonce too short (2 chars)", "2025-01-01T00:00:00.000Z|0001|ab"],
	["nonce too short (1 char)", "2025-01-01T00:00:00.000Z|0001|a"],
	["nonce too long (5 chars)", "2025-01-01T00:00:00.000Z|0001|a1b2c"],
	["nonce too long (6 chars)", "2025-01-01T00:00:00.000Z|0001|a1b2c3"],
	["non-hex in counter (g)", "2025-01-01T00:00:00.000Z|00g1|a1b2"],
	["non-hex in counter (xyz)", "2025-01-01T00:00:00.000Z|xyz1|a1b2"],
	["non-hex in nonce (xyz)", "2025-01-01T00:00:00.000Z|0001|xyz1"],
	["non-hex in nonce (g)", "2025-01-01T00:00:00.000Z|0001|g1b2"],
	["empty string", ""],
	["extra parts", "2025-01-01T00:00:00.000Z|0001|a1b2|extra"],
])("isValidEventstamp() returns false for %s", (_description, eventstamp) => {
	expect(isValidEventstamp(eventstamp)).toBe(false);
});

// ============================================================================
// maxEventstamp() tests
// ============================================================================

test("maxEventstamp() returns MIN_EVENTSTAMP for empty array", () => {
	expect(maxEventstamp([])).toBe(MIN_EVENTSTAMP);
});

test("maxEventstamp() returns the only eventstamp for single-element array", () => {
	const stamp = "2025-01-01T00:00:00.000Z|0001|a1b2";
	expect(maxEventstamp([stamp])).toBe(stamp);
});

test("maxEventstamp() returns the maximum eventstamp", () => {
	const stamps = [
		"2025-01-01T00:00:00.000Z|0001|a1b2",
		"2025-01-01T00:05:00.000Z|0001|c3d4",
		"2025-01-01T00:02:00.000Z|0001|b2c3",
	];
	expect(maxEventstamp(stamps)).toBe("2025-01-01T00:05:00.000Z|0001|c3d4");
});

test("maxEventstamp() handles counters correctly", () => {
	const stamps = [
		"2025-01-01T00:00:00.000Z|0001|a1b2",
		"2025-01-01T00:00:00.000Z|0005|c3d4",
		"2025-01-01T00:00:00.000Z|0003|b2c3",
	];
	expect(maxEventstamp(stamps)).toBe("2025-01-01T00:00:00.000Z|0005|c3d4");
});

test("maxEventstamp() handles nonces correctly as tie-breaker", () => {
	const stamps = [
		"2025-01-01T00:00:00.000Z|0001|a1b2",
		"2025-01-01T00:00:00.000Z|0001|ffff",
		"2025-01-01T00:00:00.000Z|0001|b2c3",
	];
	expect(maxEventstamp(stamps)).toBe("2025-01-01T00:00:00.000Z|0001|ffff");
});

// ============================================================================
// decodeEventstamp() error handling tests
// ============================================================================

test("decodeEventstamp() throws InvalidEventstampError for invalid input", () => {
	expect(() => decodeEventstamp("invalid")).toThrow();
});
