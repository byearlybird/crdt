import type { ClockState } from "./clock";
import { InvalidEventstampError } from "./errors";

/**
 * Eventstamp format constants.
 * An eventstamp is a 24-character code made of letters and numbers (hexadecimal).
 * It contains three parts: time, counter, and nonce.
 * This format makes sure every eventstamp is unique and can be sorted in order.
 */
const EVENTSTAMP_FORMAT = {
	TIMESTAMP_CHARS: 12, // 48 bits = 12 hex chars (281 trillion milliseconds)
	COUNTER_CHARS: 6, // 24 bits = 6 hex chars (16M events per millisecond)
	NONCE_CHARS: 6, // 24 bits = 6 hex chars (16M unique values)
	NONCE_BYTES: 3, // 3 bytes = 6 hexadecimal characters
} as const;

const TOTAL_EVENTSTAMP_LENGTH =
	EVENTSTAMP_FORMAT.TIMESTAMP_CHARS +
	EVENTSTAMP_FORMAT.COUNTER_CHARS +
	EVENTSTAMP_FORMAT.NONCE_CHARS;

const HEX_RADIX = 16;
const HEX_CHARS_PER_BYTE = 2;
const PADDING_CHAR = "0";

/**
 * The smallest possible eventstamp (all zeros).
 * Use this as a starting point when comparing eventstamps.
 */
export const MIN_EVENTSTAMP = encodeEventstamp({
	ms: 0,
	counter: 0,
	nonce: "000000",
});

/**
 * Creates a random nonce to make each eventstamp unique.
 * This stops two computers from creating the same eventstamp at the exact same time.
 *
 * @returns A 6-character hexadecimal string
 */
export function generateNonce(): string {
	const bytes = new Uint8Array(EVENTSTAMP_FORMAT.NONCE_BYTES);
	crypto.getRandomValues(bytes);
	return Array.from(bytes)
		.map((byte) =>
			byte.toString(HEX_RADIX).padStart(HEX_CHARS_PER_BYTE, PADDING_CHAR),
		)
		.join("");
}

/**
 * Converts clock state into an eventstamp string.
 *
 * @param clockState - The clock state to convert
 * @returns A 24-character lowercase hexadecimal string
 */
export function encodeEventstamp(clockState: ClockState): string {
	const timeHex = clockState.ms
		.toString(HEX_RADIX)
		.padStart(EVENTSTAMP_FORMAT.TIMESTAMP_CHARS, PADDING_CHAR);
	const counterHex = clockState.counter
		.toString(HEX_RADIX)
		.padStart(EVENTSTAMP_FORMAT.COUNTER_CHARS, PADDING_CHAR);
	const nonceHex = clockState.nonce;

	return `${timeHex}${counterHex}${nonceHex}`.toLowerCase();
}

/**
 * Checks if a string is a valid eventstamp.
 *
 * @param stamp - The string to check
 * @returns True if the stamp has exactly 24 lowercase hexadecimal characters
 */
export function isValidEventstamp(stamp: string): boolean {
	const pattern = new RegExp(`^[0-9a-f]{${TOTAL_EVENTSTAMP_LENGTH}}$`);
	return pattern.test(stamp);
}

/**
 * Converts an eventstamp string back into clock state.
 *
 * @param eventstamp - The eventstamp string to convert
 * @returns The clock state from the eventstamp
 * @throws {InvalidEventstampError} If the eventstamp format is wrong
 */
export function decodeEventstamp(eventstamp: string): ClockState {
	if (!isValidEventstamp(eventstamp)) {
		throw new InvalidEventstampError(eventstamp);
	}

	const timeEnd = EVENTSTAMP_FORMAT.TIMESTAMP_CHARS;
	const counterEnd = timeEnd + EVENTSTAMP_FORMAT.COUNTER_CHARS;

	const timeHex = eventstamp.slice(0, timeEnd);
	const counterHex = eventstamp.slice(timeEnd, counterEnd);
	const nonceHex = eventstamp.slice(counterEnd);

	return {
		ms: Number.parseInt(timeHex, HEX_RADIX),
		counter: Number.parseInt(counterHex, HEX_RADIX),
		nonce: nonceHex,
	};
}

/**
 * Finds the largest eventstamp from a list.
 *
 * @param eventstamps - List of eventstamp strings
 * @returns The largest valid eventstamp, or MIN_EVENTSTAMP if the list is empty
 */
export function maxEventstamp(eventstamps: string[]): string {
	let max = MIN_EVENTSTAMP;

	for (const stamp of eventstamps) {
		if (isValidEventstamp(stamp) && stamp > max) {
			max = stamp;
		}
	}

	return max;
}
