export class InvalidEventstampError extends Error {
	constructor(eventstamp: string) {
		super(`Invalid eventstamp: "${eventstamp}"`);
		this.name = "InvalidEventstampError";
	}
}
