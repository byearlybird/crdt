import type { StandardSchemaV1 } from "@standard-schema/spec";

export class AbortError extends Error {
  constructor(public reason?: string) {
    super(reason ?? 'Mutation aborted');
    this.name = 'AbortError';
  }
}

export class DisposedError extends Error {
  constructor() {
    super('DB instance has been disposed');
    this.name = 'DisposedError';
  }
}

export class SchemaError extends Error {
	readonly issues: ReadonlyArray<StandardSchemaV1.Issue>;
	constructor(issues: ReadonlyArray<StandardSchemaV1.Issue>) {
		super(issues.map((i) => i.message).join("; "));
		this.name = "SchemaError";
		this.issues = issues;
	}
}
