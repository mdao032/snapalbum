import "server-only";
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * The optional access code of an event (F-017, S-006) is stored hashed, never in clear. scrypt is
 * built into Node (no dependency) and memory-hard, like the argon2 or bcrypt the specification
 * names. A 4 to 6 digit code is short whatever the hash: the real protection is the limit on
 * attempts (see `ACCESS_CODE_RATE_LIMIT`), not the cost of the hash.
 */
const COST = 16384;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_LENGTH = 32;

function derive(code: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(code, salt, KEY_LENGTH, options, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

/** `scrypt$N$r$p$salt$hash`, each part self-describing so the cost can change later. */
export async function hashAccessCode(code: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(code, salt, { N: COST, r: BLOCK_SIZE, p: PARALLELISM });
  return [
    "scrypt",
    COST,
    BLOCK_SIZE,
    PARALLELISM,
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

/** True when `code` matches `stored`. Anything malformed in `stored` is simply a mismatch. */
export async function verifyAccessCode(code: string, stored: unknown): Promise<boolean> {
  if (typeof stored !== "string") return false;
  const [scheme, cost, blockSize, parallelism, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !cost || !blockSize || !parallelism || !salt || !hash) return false;
  const options = { N: Number(cost), r: Number(blockSize), p: Number(parallelism) };
  if (![options.N, options.r, options.p].every((value) => Number.isInteger(value) && value > 0))
    return false;
  // Refuse costs that would let a corrupted value freeze the server.
  if (options.N > 1 << 20 || options.r > 32 || options.p > 4) return false;

  const expected = Buffer.from(hash, "base64");
  if (expected.length !== KEY_LENGTH) return false;
  try {
    const actual = await derive(code, Buffer.from(salt, "base64"), options);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
