import { hash } from "./hash";
import type { Stamp, Timestamped } from "./types";

const MS_LENGTH = 12;
const SEQ_LENGTH = 6;
const DEVICE_ID_LENGTH = 8;

export const MIN_STAMP: Stamp = makeStamp(0, 0, "0");

export function makeStamp(ms: number, seq: number, deviceId: string): Stamp {
	const deviceIdHash = hash(deviceId);
	const deviceIdHex = toHex(deviceIdHash, DEVICE_ID_LENGTH);
	const msHex = toHex(ms, MS_LENGTH);
	const seqHex = toHex(seq, SEQ_LENGTH);

	return `${msHex}@${seqHex}@${deviceIdHex}`;
}

/** Parses a stamp and returns ms and seq as integers. */
export function parseStamp(stamp: Stamp): { ms: number; seq: number } {
	const parts = stamp.split("@");
	const msHex = parts[0] ?? "0";
	const seqHex = parts[1] ?? "0";
	return {
		ms: parseInt(msHex, 16),
		seq: parseInt(seqHex, 16),
	};
}

/** Returns the later of two stamps (lexicographic comparison). */
export function laterStamp(a: Stamp, b: Stamp): Stamp {
	return a > b ? a : b;
}

/** Returns the latest (max) stamp from an iterable of stamps. */
export function latestStamp(stamps: Iterable<Stamp>): Stamp {
	let max: Stamp | undefined;
	for (const stamp of stamps) {
		if (!max || stamp > max) max = stamp;
	}
	return max ?? MIN_STAMP;
}

export function latestItemStamp(items: Iterable<Timestamped>): Stamp {
	const stamps: Stamp[] = [];
	for (const item of items) stamps.push(item["~t"]);
	return latestStamp(stamps);
}

function toHex(value: number, padLength: number): string {
	return value.toString(16).padStart(padLength, "0");
}
