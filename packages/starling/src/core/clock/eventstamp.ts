import type { ClockState } from "./clock";
import { InvalidEventstampError } from "./errors";

/**
 * Generates a random 6-character hex nonce (24-bit)
 */
export function generateNonce(): string {
	const bytes = new Uint8Array(3); // 3 bytes = 24 bits = 6 hex chars
	crypto.getRandomValues(bytes);
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

export function encodeEventstamp(clockState: ClockState): string {
	const time48 = clockState.ms.toString(16).padStart(12, "0");
	const counter24 = clockState.counter.toString(16).padStart(6, "0");
	const nonce24 = clockState.nonce;
	return `${time48}${counter24}${nonce24}`.toLowerCase();
}

/**
 * Validates whether a string is a properly formatted eventstamp.
 * Expected format: 24 lowercase hex characters (TTTTTTTTTTTTCCCCCCNNNNNN)
 * where T = time (12 chars), C = counter (6 chars), N = nonce (6 chars).
 */
export function isValidEventstamp(stamp: string): boolean {
	return /^[0-9a-f]{24}$/.test(stamp);
}

export function decodeEventstamp(eventstamp: string): ClockState {
	if (!isValidEventstamp(eventstamp)) {
		throw new InvalidEventstampError(eventstamp);
	}

	const time48 = eventstamp.slice(0, 12);
	const counter24 = eventstamp.slice(12, 18);
	const nonce24 = eventstamp.slice(18, 24);

	return {
		ms: parseInt(time48, 16),
		counter: parseInt(counter24, 16),
		nonce: nonce24,
	};
}

export const MIN_EVENTSTAMP = encodeEventstamp({
	ms: 0,
	counter: 0,
	nonce: "000000",
});

/**
 * Find the maximum eventstamp from an array of eventstamps.
 * Returns MIN_EVENTSTAMP if the array is empty.
 * @param eventstamps - Array of eventstamp strings
 * @returns The maximum eventstamp
 */
export function maxEventstamp(eventstamps: string[]): string {
	if (eventstamps.length === 0) {
		return MIN_EVENTSTAMP;
	}

	return eventstamps
		.filter((stamp) => isValidEventstamp(stamp))
		.reduce((max, stamp) => (stamp > max ? stamp : max), MIN_EVENTSTAMP);
}
