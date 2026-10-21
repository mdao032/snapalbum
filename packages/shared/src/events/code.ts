import { PUBLIC_CODE_ALPHABET, PUBLIC_CODE_LENGTH } from "../schemas/common";

export type RandomBytes = (count: number) => Uint8Array;

function defaultRandomBytes(count: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(count));
}

/**
 * Generates an unguessable public event code (F-012): `PUBLIC_CODE_LENGTH` characters drawn from
 * an alphabet without ambiguous characters.
 *
 * Uses rejection sampling so every character is equally likely (a plain `byte % 31` would favour
 * the first characters). Callers must still handle a unique-constraint collision and retry.
 */
export function generatePublicCode(
  randomBytes: RandomBytes = defaultRandomBytes,
  length: number = PUBLIC_CODE_LENGTH,
): string {
  const alphabetSize = PUBLIC_CODE_ALPHABET.length;
  // Largest multiple of the alphabet size that fits in a byte: bytes above it are discarded.
  const limit = Math.floor(256 / alphabetSize) * alphabetSize;

  let code = "";
  while (code.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= limit) continue;
      code += PUBLIC_CODE_ALPHABET[byte % alphabetSize];
      if (code.length === length) break;
    }
  }
  return code;
}
