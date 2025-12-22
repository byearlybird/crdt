export function toHex(value: number, padLength: number): string {
  return value.toString(16).padStart(padLength, "0");
}

export function nonce(length: number): string {
  const bytes = new Uint8Array(length / 2);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => toHex(b, 2))
    .join("");
}
