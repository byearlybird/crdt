export type Stamp = `${string}@${string}@${string}`; // lexicographically sortable string: `${ms}@${seq}@${deviceId}`

export type DocData = Record<string, Atom>;

export type Hashed = {
  "~h": number; // hash
};

export type Timestamped = {
  "~t": Stamp; // timestamp
};

export type WithData<T = unknown> = {
  "~d": T; // value
};

export type Atom<TData = unknown> = Hashed & Timestamped & WithData<TData>;

export type Doc = Hashed & Timestamped & WithData<DocData>;
