export function flatten<T = unknown>(
	obj: Record<string, unknown>,
	transform?: (value: unknown) => T,
): Record<string, T> {
	const result: Record<string, T> = {};

	function recurse(current: Record<string, unknown>, prefix: string): void {
		const keys = Object.keys(current);

		if (keys.length === 0) {
			result[prefix] = (transform ? transform(current) : current) as T;
			return;
		}

		for (const key of keys) {
			const path = prefix ? `${prefix}.${key}` : key;
			const value = current[key];

			if (isPlainObject(value) && !Array.isArray(value)) {
				recurse(value, path);
			} else {
				result[path] = (transform ? transform(value) : value) as T;
			}
		}
	}

	recurse(obj, "");
	return result;
}

export function unflatten(
	obj: Record<string, unknown>,
): Record<string, unknown> {
	const result: Record<string, unknown> = {};

	for (const key of Object.keys(obj)) {
		const parts = key.split(".");
		let current: Record<string, unknown> = result;

		for (let i = 0; i < parts.length; i++) {
			const part = parts[i];
			if (!part) continue;

			if (part === "__proto__") break;

			if (i === parts.length - 1) {
				current[part] = obj[key];
			} else {
				const next = parts[i + 1];
				if (!next) continue;
				const useArray = /^\d+$/.test(next);

				if (current[part] === undefined) {
					current[part] = useArray ? [] : {};
				}
				current = current[part] as Record<string, unknown>;
			}
		}
	}

	return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return Object.prototype.toString.call(value) === "[object Object]";
}
