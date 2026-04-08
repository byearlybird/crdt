export type DBOptions<T, Id extends string = string> = {
  getId: (record: T) => Id;
  initial?: T[];
  validate?: (record: T) => void;
};

export type SingleMutateEvent<T, Id extends string = string> =
  | { op: 'insert'; id: Id; record: T; previous: null }
  | { op: 'update'; id: Id; record: T; previous: T }
  | { op: 'remove'; id: Id; record: null; previous: T };

export type MutateEvent<T, Id extends string = string> =
  | SingleMutateEvent<T, Id>
  | { op: 'batch'; mutations: SingleMutateEvent<T, Id>[] };

export type SubscribeEvent<T, Id extends string = string> =
  | { type: 'optimistic'; event: MutateEvent<T, Id> }
  | { type: 'commit'; event: MutateEvent<T, Id> }
  | { type: 'rollback'; event: MutateEvent<T, Id>; reason: unknown };

export type MutateContext<T, Id extends string = string> = {
  event: MutateEvent<T, Id>;
  abort: (reason?: string) => void;
};

export type Middleware<T, Id extends string = string> = (
  ctx: MutateContext<T, Id>,
) => void | Promise<void>;

export type Transaction<T, Id extends string = string> = {
  insert(record: T): void;
  update(id: Id, delta: Partial<T> | ((prev: T) => T)): void;
  remove(id: Id): void;
};

export type DB<T, Id extends string = string> = {
  readonly data: ReadonlyMap<Id, Readonly<T>>;
  insert(record: T): Promise<void>;
  update(id: Id, delta: Partial<T> | ((prev: T) => T)): Promise<void>;
  remove(id: Id): Promise<void>;
  batch(fn: (tx: Transaction<T, Id>) => void): Promise<void>;
  snapshot(): T[];
  subscribe(callback: (event: SubscribeEvent<T, Id>) => void): () => void;
  use(fn: Middleware<T, Id>): () => void;
  dispose(): void;
};
