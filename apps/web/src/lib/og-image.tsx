import { APP_NAME, BRAND_COLORS } from "@snapalbum/shared/brand";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ImageResponse } from "next/og";
import { routing } from "@/i18n/routing";

export const OG_SIZE = { width: 1200, height: 630 };

/**
 * The picture shown when a public page is shared (step 5.1): the name and the promise, in the
 * brand colours, in the language of the page. Drawn at request time, no file to keep up to date.
 */
export async function renderOpenGraphImage(requested: string) {
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  const t = await getTranslations({ locale, namespace: "home" });

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 72,
        background: `linear-gradient(135deg, ${BRAND_COLORS.canvas} 0%, #ece7ff 60%, #ffe3da 100%)`,
        color: BRAND_COLORS.ink,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: 20,
            background: BRAND_COLORS.primary,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 13,
              border: "6px solid white",
            }}
          />
        </div>
        <div style={{ fontSize: 44, fontWeight: 700 }}>{APP_NAME}</div>
      </div>
      <div style={{ fontSize: 84, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2 }}>
        {t("title")}
      </div>
      <div style={{ fontSize: 34, color: "#4b4760" }}>{t("ctaHint")}</div>
    </div>,
    OG_SIZE,
  );
}
