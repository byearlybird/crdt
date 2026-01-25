export type Tombstones = Record<string, string>;

export function isDeleted(id: string, tombstones: Tombstones): boolean {
  return tombstones[id] !== undefined;
}

export function mergeTombstones(target: Tombstones, source: Tombstones): Tombstones {
  const result: Tombstones = {};
  const keys = new Set([...Object.keys(target), ...Object.keys(source)]);

  for (const key of keys) {
    const targetStamp = target[key];
    const sourceStamp = source[key];

    if (targetStamp && sourceStamp) {
      result[key] = targetStamp > sourceStamp ? targetStamp : sourceStamp;
    } else if (targetStamp) {
      result[key] = targetStamp;
    } else if (sourceStamp) {
      result[key] = sourceStamp;
    }
  }

  return result;
}
