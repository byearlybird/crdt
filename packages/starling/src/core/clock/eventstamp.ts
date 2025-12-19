import type { ClockState } from "./clock";
import { InvalidEventstampError } from "./errors";

/**
 * Generates a random 4-character hex nonce
 */
export function generateNonce(): string {
	return Math.random().toString(16).slice(2, 6).padStart(4, "0");
}

export function encodeEventstamp(clockState: ClockState): string {
	const isoString = new Date(clockState.ms).toISOString();
	const counterHex = clockState.counter.toString(16).padStart(4, "0");
	return `${isoString}|${counterHex}|${clockState.nonce}`;
}

/**
 * Validates whether a string is a properly formatted eventstamp.
 * Expected format: YYYY-MM-DDTHH:mm:ss.SSSZ|HHHH+|HHHH
 * where HHHH+ represents 4 or more hex characters for the counter,
 * and HHHH represents exactly 4 hex characters for the nonce.
 */
export function isValidEventstamp(stamp: string): boolean {
	return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\|[0-9a-f]{4,}\|[0-9a-f]{4}$/.test(
		stamp,
	);
}

export function decodeEventstamp(eventstamp: string): ClockState {
	if (!isValidEventstamp(eventstamp)) {
		throw new InvalidEventstampError(eventstamp);
	}

	const parts = eventstamp.split("|");
	const isoString = parts[0] as string;
	const hexCounter = parts[1] as string;
	const nonce = parts[2] as string;

	return {
		ms: new Date(isoString).getTime(),
		counter: parseInt(hexCounter, 16),
		nonce,
	};
}

export const MIN_EVENTSTAMP = encodeEventstamp({
	ms: 0,
	counter: 0,
	nonce: "0000",
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
		.reduce((max, stamp) => (stamp > max ? stamp : max));
}
