import type { Locale, Messages } from "@snapalbum/shared/messages";

// Typed translations: a wrong key becomes a compile error.
declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: Messages;
  }
}
