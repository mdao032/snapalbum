"use client";

import { Camera, Check, ImagePlus, Wifi, WifiOff } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useReducer, useRef } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import {
  demoReducer,
  hasPendingItems,
  initialDemoState,
  SAMPLE_IDS,
  sentItems,
} from "./demo-state";
import { SampleTile } from "./sample-tile";

const TICK_MS = 100;
const MAX_TICK_MS = 500;

/**
 * The public demo (step 5.1): what a guest sees, played with sample photos. It makes no request,
 * reads no file and uses no camera: the "photos" are drawings and everything stays on this page.
 */
export function DemoExperience() {
  const t = useTranslations("demo");
  const [state, dispatch] = useReducer(demoReducer, initialDemoState);
  const pickerTitle = useRef<HTMLHeadingElement>(null);
  const pending = hasPendingItems(state);
  const sent = sentItems(state);

  // The clock only runs while something is on its way and the network is on.
  useEffect(() => {
    if (!pending || !state.online) return;
    let last = Date.now();
    const timer = window.setInterval(() => {
      const now = Date.now();
      // A throttled tab (hidden, battery saver) must not make one photo jump to "sent".
      dispatch({ type: "tick", elapsedMs: Math.min(Math.max(now - last, 0), MAX_TICK_MS) });
      last = now;
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [pending, state.online]);

  // The picker opens in the flow of the page: bring the reader to it.
  useEffect(() => {
    if (state.picking) pickerTitle.current?.focus();
  }, [state.picking]);

  const allSent = state.items.length > 0 && !pending;
  const waitingForNetwork = pending && !state.online;

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[22rem_1fr] lg:gap-12">
      <div className="mx-auto w-full max-w-[22rem] rounded-[2.5rem] bg-foreground p-2.5 shadow-float">
        <div className="flex min-h-[34rem] flex-col gap-5 overflow-hidden rounded-[2rem] bg-background pb-6">
          <div className="bg-warm-soft px-4 py-2 text-center text-sm font-medium text-foreground">
            {t("notice")}
          </div>

          <div className="flex flex-col items-center gap-1 px-5 text-center">
            <span className="mb-2 h-20 w-full rounded-2xl bg-gradient-to-br from-violet-300 via-fuchsia-200 to-orange-200" />
            <p className="text-title">{t("eventTitle")}</p>
            <p className="text-sm text-muted-foreground">{t("eventSubtitle")}</p>
          </div>

          {state.picking ? (
            <section aria-labelledby="demo-picker-title" className="flex flex-col gap-3 px-5">
              <h2
                id="demo-picker-title"
                ref={pickerTitle}
                tabIndex={-1}
                className="font-semibold outline-none"
              >
                {t("pickerTitle")}
              </h2>
              <p className="text-sm text-muted-foreground">{t("pickerHint")}</p>
              <ul className="grid grid-cols-3 gap-2">
                {SAMPLE_IDS.map((sample) => {
                  const selected = state.selection.includes(sample);
                  return (
                    <li key={sample}>
                      <button
                        type="button"
                        aria-pressed={selected}
                        onClick={() => dispatch({ type: "toggleSample", sample })}
                        className={cn(
                          "relative flex w-full cursor-pointer flex-col gap-1 rounded-xl p-1 text-center outline-none ring-2 ring-transparent focus-visible:ring-primary",
                          selected && "ring-primary",
                        )}
                      >
                        <SampleTile sample={sample} />
                        <span className="text-xs leading-tight">{t(`samples.${sample}`)}</span>
                        {selected ? (
                          <span className="absolute right-2 top-2 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
                            <Check className="size-3" strokeWidth={3} aria-hidden />
                            <span className="sr-only">{t("selected")}</span>
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <Button
                type="button"
                size="lg"
                disabled={state.selection.length === 0}
                onClick={() => dispatch({ type: "send" })}
              >
                {t("send", { count: state.selection.length })}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => dispatch({ type: "closePicker" })}
              >
                {t("cancel")}
              </Button>
            </section>
          ) : (
            <div className="flex flex-col gap-3 px-5">
              <p className="text-center text-muted-foreground">{t("welcome")}</p>
              <Button type="button" size="lg" onClick={() => dispatch({ type: "openPicker" })}>
                <Camera aria-hidden />
                {t("takePhoto")}
              </Button>
              <Button
                type="button"
                size="lg"
                variant="secondary"
                onClick={() => dispatch({ type: "openPicker" })}
              >
                <ImagePlus aria-hidden />
                {t("chooseGallery")}
              </Button>
            </div>
          )}

          {state.items.length > 0 ? (
            <div className="flex flex-col gap-3 px-5">
              <ul aria-label={t("listLabel")} className="flex flex-col gap-2">
                {state.items.map((item) => (
                  <li
                    key={item.id}
                    data-status={item.status}
                    className="flex items-center gap-3 rounded-xl bg-surface p-2 ring-1 ring-border/70"
                  >
                    <SampleTile sample={item.sample} className="size-11 shrink-0" />
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="truncate font-medium">{t(`samples.${item.sample}`)}</span>
                        <span className="shrink-0 text-muted-foreground">
                          {item.status === "sent"
                            ? t("status.sent")
                            : !state.online
                              ? t("status.offline")
                              : item.status === "sending"
                                ? t("status.sending")
                                : t("status.waiting")}
                        </span>
                      </div>
                      <div
                        role="progressbar"
                        aria-label={t(`samples.${item.sample}`)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(item.progress * 100)}
                        className="h-1.5 overflow-hidden rounded-full bg-muted"
                      >
                        <div
                          className={cn(
                            "h-full rounded-full",
                            item.status === "sent" ? "bg-success" : "bg-primary",
                          )}
                          style={{ width: `${Math.round(item.progress * 100)}%` }}
                        />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              <p role="status" className="text-center text-sm font-medium">
                {waitingForNetwork
                  ? t("offlineNotice")
                  : allSent
                    ? t("allSent", { count: sent.length })
                    : ""}
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-5">
        <Card className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 font-medium">
              {state.online ? (
                <Wifi className="size-5 text-success" aria-hidden />
              ) : (
                <WifiOff className="size-5 text-danger" aria-hidden />
              )}
              {state.online ? t("networkOn") : t("networkOff")}
            </p>
            <Button
              type="button"
              variant="secondary"
              onClick={() => dispatch({ type: "setOnline", online: !state.online })}
            >
              {state.online ? t("cutNetwork") : t("restoreNetwork")}
            </Button>
          </div>
        </Card>

        <Card className="flex flex-col gap-4" data-testid="demo-organizer">
          <h2 className="text-title">{t("organizerTitle")}</h2>
          <p className="font-medium" data-testid="demo-counter">
            {t("organizerCounter", { count: sent.length })}
          </p>
          {sent.length === 0 ? (
            <p className="text-muted-foreground">{t("organizerEmpty")}</p>
          ) : (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-4 xl:grid-cols-6">
              {sent.map((item) => (
                <li key={item.id}>
                  <SampleTile sample={item.sample} />
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/login" className={cn(buttonVariants({ size: "lg" }))}>
              {t("cta")}
            </Link>
            <Button type="button" variant="ghost" onClick={() => dispatch({ type: "reset" })}>
              {t("reset")}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">{t("ctaHint")}</p>
        </Card>
      </div>
    </div>
  );
}
