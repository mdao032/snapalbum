"use client";

import { androidChromeIntent, detectInAppBrowser } from "@snapalbum/shared/upload";
import { useTranslations } from "next-intl";
import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";

/**
 * A browser built into another app (Instagram, WhatsApp...) is recognised: uploads can be limited
 * there or stop when the guest leaves the app, so the guest is invited to open the link in the
 * phone's browser (NF-023). A suggestion, never a block: the upload still works where it can.
 * Loaded only when the page looks like it runs inside such an app.
 */
interface NoticeState {
  url: string;
  intent: string | null;
}

const noopSubscribe = () => () => undefined;
let cached: NoticeState | null | undefined;

/** One stable object per page: `useSyncExternalStore` compares snapshots by identity. */
function readState(): NoticeState | null {
  if (cached !== undefined) return cached;
  if (!detectInAppBrowser(navigator.userAgent)) return (cached = null);
  const url = window.location.href;
  const android = /Android/i.test(navigator.userAgent);
  return (cached = { url, intent: android ? androidChromeIntent(url) : null });
}

export function InAppNotice() {
  const t = useTranslations("guest.upload.inApp");
  const [copied, setCopied] = useState(false);
  // Read from the browser after hydration: nothing on the server, nothing for a regular browser.
  const state = useSyncExternalStore(noopSubscribe, readState, () => null);

  if (!state) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(state?.url ?? "");
      setCopied(true);
    } catch {
      // Clipboard refused (it often is in these browsers): the link stays visible below.
    }
  }

  return (
    <section
      aria-label={t("title")}
      className="flex flex-col gap-3 rounded-xl border border-border bg-warm-soft px-4 py-4"
    >
      <h2 className="font-semibold">{t("title")}</h2>
      <p className="text-sm">{t("text")}</p>
      <div className="flex flex-col gap-2">
        {state.intent ? (
          <Button asChild>
            <a href={state.intent}>{t("open")}</a>
          </Button>
        ) : null}
        <Button variant="secondary" onClick={copy}>
          {t("copy")}
        </Button>
      </div>
      {copied ? (
        <p role="status" className="text-sm font-medium">
          {t("copied")}
        </p>
      ) : (
        <p className="break-all text-xs text-muted-foreground">{state.url}</p>
      )}
    </section>
  );
}
