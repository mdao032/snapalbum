import { DEFAULT_LOCALE, LOCALES, type Locale } from "../schemas/common";
import en from "./en.json";
import fr from "./fr.json";

export type Messages = typeof fr;

export const messages: Record<Locale, Messages> = { fr, en };

export { DEFAULT_LOCALE, LOCALES };
export type { Locale };

/** Flattens nested messages into dotted keys (`home.title`), used by the parity test. */
export function flattenMessageKeys(tree: unknown, prefix = ""): string[] {
  if (typeof tree !== "object" || tree === null) return [prefix];
  return Object.entries(tree).flatMap(([key, value]) =>
    flattenMessageKeys(value, prefix ? `${prefix}.${key}` : key),
  );
}
