"use client";

import { Check, Copy, Download, Share2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useSyncExternalStore } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const noopSubscribe = () => () => {};

type CopyState = "idle" | "copied" | "failed";

/**
 * Sharing an event (F-013, F-014): QR code preview, copy and share the link, and every download.
 * The QR code and the cards come from authenticated routes that follow the event's accent color.
 */
export function SharePanel({
  eventId,
  title,
  link,
}: {
  eventId: string;
  title: string;
  /** The permanent short link, built on the server from `NEXT_PUBLIC_SHORT_LINK_BASE`. */
  link: string;
}) {
  const t = useTranslations("share");
  const [accentQr, setAccentQr] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  // Web Share exists on phones and some desktops; elsewhere the button simply is not shown.
  // The server renders without it, so the first client render matches before it appears.
  const canShare = useSyncExternalStore(
    noopSubscribe,
    () => "share" in navigator,
    () => false,
  );

  const base = `/api/events/${eventId}`;
  const color = accentQr ? "&color=accent" : "";
  const qr = (format: "svg" | "png", download = false) =>
    `${base}/qr?format=${format}${color}${download ? "&download=1" : ""}`;
  const card = (format: "a6" | "a5" | "tent") => `${base}/card?format=${format}${color}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  async function share() {
    try {
      await navigator.share({ title, text: t("shareText", { title }), url: link });
    } catch {
      // Closing the share sheet is not an error; nothing to do.
    }
  }

  const downloads = [
    { href: qr("svg", true), label: t("qrSvg") },
    { href: qr("png", true), label: t("qrPng") },
  ];
  const cards = [
    { href: card("a6"), label: t("cardA6") },
    { href: card("a5"), label: t("cardA5") },
    { href: card("tent"), label: t("cardTent") },
  ];

  return (
    <Card className="p-6 sm:p-8">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold">{t("title")}</h2>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>

        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          {/* eslint-disable-next-line @next/next/no-img-element -- an authenticated SVG route, not a static image */}
          <img
            src={qr("svg")}
            alt={t("qrAlt", { title })}
            width={208}
            height={208}
            className="size-52 shrink-0 rounded-2xl bg-white p-2 shadow-soft ring-1 ring-border"
          />
          <div className="flex w-full flex-col gap-3">
            <label htmlFor="short-link" className="font-medium">
              {t("linkLabel")}
            </label>
            <input
              id="short-link"
              readOnly
              value={link}
              onFocus={(event) => event.currentTarget.select()}
              className="min-h-12 w-full rounded-xl bg-muted px-4 text-base ring-1 ring-border outline-none focus-visible:ring-4 focus-visible:ring-primary/30"
            />
            <div className="flex flex-wrap gap-3">
              <Button type="button" variant="secondary" onClick={copy}>
                {copyState === "copied" ? <Check aria-hidden /> : <Copy aria-hidden />}
                {copyState === "copied" ? t("copied") : t("copy")}
              </Button>
              {canShare ? (
                <Button type="button" onClick={share}>
                  <Share2 aria-hidden />
                  {t("share")}
                </Button>
              ) : null}
            </div>
            <p role="status" className="min-h-5 text-sm text-muted-foreground">
              {copyState === "failed" ? t("copyFailed") : ""}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="flex min-h-11 cursor-pointer items-center gap-3 font-medium">
            <input
              type="checkbox"
              checked={accentQr}
              onChange={(event) => setAccentQr(event.target.checked)}
              className="size-5 cursor-pointer accent-primary"
            />
            {t("accentQr")}
          </label>
          <p className="pl-8 text-sm text-muted-foreground">{t("accentQrHint")}</p>
        </div>

        <DownloadList title={t("downloadsTitle")} items={downloads} />
        <DownloadList title={t("cardsTitle")} items={cards} />
        <p className="text-sm text-muted-foreground">{t("printHint")}</p>
      </div>
    </Card>
  );
}

function DownloadList({
  title,
  items,
}: {
  title: string;
  items: { href: string; label: string }[];
}) {
  return (
    <section className="flex flex-col gap-3" aria-label={title}>
      <h3 className="font-medium">{title}</h3>
      <ul className="flex flex-wrap gap-3">
        {items.map((item) => (
          <li key={item.href} className="max-w-full">
            <a
              href={item.href}
              download
              className={cn(
                buttonVariants({ variant: "secondary" }),
                "max-w-full whitespace-normal py-2 text-center sm:w-auto",
              )}
            >
              <Download aria-hidden />
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
