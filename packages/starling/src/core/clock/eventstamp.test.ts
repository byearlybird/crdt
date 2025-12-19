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
		counter: 0xffffff, // Max 24-bit value
		nonce,
	});
	const { ms, counter } = decodeEventstamp(eventstamp);

	expect(counter).toBe(0xffffff);
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

test("isValidEventstamp() returns true for large counter (max 24-bit)", () => {
	expect(isValidEventstamp("000000000000ffffff123456")).toBe(true);
});

test("isValidEventstamp() returns true for MIN_EVENTSTAMP", () => {
	expect(isValidEventstamp(MIN_EVENTSTAMP)).toBe(true);
});

test("isValidEventstamp() returns true for various valid timestamps", () => {
	expect(isValidEventstamp("00019c8f3a1e000001abcdef")).toBe(true);
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

// ============================================================================
// maxEventstamp() tests
// ============================================================================

test("maxEventstamp() returns MIN_EVENTSTAMP for empty array", () => {
	expect(maxEventstamp([])).toBe(MIN_EVENTSTAMP);
});

test("maxEventstamp() returns the only eventstamp for single-element array", () => {
	const stamp = "00019c8f3a1e000001abcdef";
	expect(maxEventstamp([stamp])).toBe(stamp);
});

test("maxEventstamp() returns the maximum eventstamp", () => {
	const stamps = [
		"00019c8f3a1e000001abcdef", // Earlier time
		"00019c8f3a28000001abcdef", // Latest time
		"00019c8f3a23000001abcdef", // Middle time
	];
	expect(maxEventstamp(stamps)).toBe("00019c8f3a28000001abcdef");
});

test("maxEventstamp() handles counters correctly", () => {
	const stamps = [
		"00019c8f3a1e000001abcdef", // Counter 1
		"00019c8f3a1e000005abcdef", // Counter 5 (max)
		"00019c8f3a1e000003abcdef", // Counter 3
	];
	expect(maxEventstamp(stamps)).toBe("00019c8f3a1e000005abcdef");
});

test("maxEventstamp() handles nonces correctly as tie-breaker", () => {
	const stamps = [
		"00019c8f3a1e000001a1b2c3", // Nonce a1b2c3
		"00019c8f3a1e000001ffffff", // Nonce ffffff (max 24-bit)
		"00019c8f3a1e000001b2c3d4", // Nonce b2c3d4
	];
	expect(maxEventstamp(stamps)).toBe("00019c8f3a1e000001ffffff");
});

// ============================================================================
// decodeEventstamp() error handling tests
// ============================================================================

test("decodeEventstamp() throws InvalidEventstampError for invalid input", () => {
	expect(() => decodeEventstamp("invalid")).toThrow();
});

test("decodeEventstamp() throws for uppercase hex", () => {
	expect(() => decodeEventstamp("00019C8F3A1E000001ABCDEF")).toThrow();
});

test("decodeEventstamp() throws for wrong length", () => {
	expect(() => decodeEventstamp("00019c8f3a1e000001")).toThrow();
});
