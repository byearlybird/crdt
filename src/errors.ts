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
