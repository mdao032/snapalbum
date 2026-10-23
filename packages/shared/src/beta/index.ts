/**
 * Field beta (step 6.1): an administrator makes a single-use invitation code for an organiser; the
 * code gives the Event plan to one free event. The code format lives here so that the server, the
 * pages and the tests agree. Pure: the random source is given by the caller.
 */

/** Letters and digits without the look-alikes (0/O, 1/I/L): a code is read aloud or copied by hand. */
export const BETA_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const BETA_CODE_LENGTH = 10;

/** Why a code could not be used, as the database answers (`redeem_beta_invitation`). */
export const BETA_REDEEM_FAILURES = [
  "invalid_code",
  "already_used",
  "revoked",
  "event_not_found",
  "not_free",
  "event_not_active",
] as const;
export type BetaRedeemFailure = (typeof BETA_REDEEM_FAILURES)[number];

/** Draws a code; `randomInt(n)` returns an integer from 0 to n - 1 (a cryptographic source in production). */
export function generateBetaCode(randomInt: (maxExclusive: number) => number): string {
  let code = "";
  for (let index = 0; index < BETA_CODE_LENGTH; index += 1) {
    code += BETA_CODE_ALPHABET[randomInt(BETA_CODE_ALPHABET.length)];
  }
  return code;
}

/** `ABCDE-FGHJK`: two groups of five, easier to read and to dictate. */
export function formatBetaCode(code: string): string {
  const half = BETA_CODE_LENGTH / 2;
  return `${code.slice(0, half)}-${code.slice(half)}`;
}

/**
 * What a person typed, reduced to a code: upper case, spaces and dashes ignored. Returns null when
 * it cannot be a code (wrong length or a character outside the alphabet), so that no request is made.
 */
export function normalizeBetaCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s\-_.]/g, "");
  if (code.length !== BETA_CODE_LENGTH) return null;
  for (const character of code) {
    if (!BETA_CODE_ALPHABET.includes(character)) return null;
  }
  return code;
}
