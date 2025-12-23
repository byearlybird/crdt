export type Tombstones = Record<string, string>;

/**
 * Merges two tombstone records
 * When both records have the same document ID, keeps the one with the higher stamp (string comparison)
 * @param target - The target tombstone record
 * @param source - The source tombstone record to merge in
 * @returns The merged tombstone record
 */
export function mergeTombstones(
  target: Tombstones,
  source: Tombstones,
): Tombstones {
  const result: Tombstones = {};
  const keys = new Set([...Object.keys(target), ...Object.keys(source)]);

  for (const key of keys) {
    const targetStamp = target[key];
    const sourceStamp = source[key];

    if (targetStamp && sourceStamp) {
      // Both have the key, keep the one with the higher stamp
      result[key] = targetStamp > sourceStamp ? targetStamp : sourceStamp;
    } else if (sourceStamp || targetStamp) {
      // Only one has the key, keep it
      result[key] = (sourceStamp ?? targetStamp)!;
    }
  }

  return result;
}
