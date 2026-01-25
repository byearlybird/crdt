import type { StoreConfig } from "./schema";

export type StoreChangeEvent<T extends StoreConfig> = {
  [K in keyof T]?: true;
};
