"use client";

import {
  downloadFileName,
  numberByGuest,
  partFileName,
  planParts,
  type Part,
} from "@snapalbum/shared/download";
import { Download, Square } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type PlanAction = (
  variant: "originals" | "optimized",
  cursor?: string,
) => Promise<
  | {
      ok: true;
      plan: {
        items: {
          mediaId: string;
          at: string;
          guestName: string | null;
          guestId: string;
          bytes: number;
          extension: string;
        }[];
        nextCursor: string | null;
        variant: "originals" | "optimized";
        originalsAllowed: boolean;
        title: string;
      };
    }
  | { ok: false }
>;

type PlanResult = Awaited<ReturnType<PlanAction>>;
type PlanItems = Extract<PlanResult, { ok: true }>["plan"]["items"];

type SignAction = (
  mediaIds: string[],
  variant: "originals" | "optimized",
) => Promise<{ ok: true; files: { mediaId: string; url: string }[] } | { ok: false }>;

interface Prepared {
  variant: "originals" | "optimized";
  originalsAllowed: boolean;
  title: string;
  entries: { mediaId: string; name: string; at: string; bytes: number }[];
  parts: Part[];
}

type PartState = "idle" | "running" | "done" | "failed";

/**
 * Downloads the whole album as ZIP files built in the browser (F-080, F-081, F-083). It first reads
 * what the album contains, cuts it into parts of 2 GB at most, then downloads the parts one after the
 * other or one by one (a part that fails can be started again without redoing the others). The
 * offer decides whether originals are included; the choice is shown only when it is allowed.
 */
export function DownloadAlbum({ onPlan, onSign }: { onPlan: PlanAction; onSign: SignAction }) {
  const t = useTranslations("dashboard.downloadCard");
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [loading, setLoading] = useState(false);
  // The choice shows at once; the list behind it is read again.
  const [choice, setChoice] = useState<"originals" | "optimized">("originals");
  const [error, setError] = useState<string | null>(null);
  const [states, setStates] = useState<PartState[]>([]);
  const [running, setRunning] = useState<{ part: number; files: number; bytes: number } | null>(
    null,
  );
  const [stopped, setStopped] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const [streamsToDisk, setStreamsToDisk] = useState(true);

  const size = (bytes: number) => {
    if (bytes >= 1e9) return t("sizeGb", { value: (bytes / 1e9).toFixed(1) });
    if (bytes >= 1e6) return t("sizeMb", { value: Math.round(bytes / 1e6) });
    return t("sizeKb", { value: Math.max(1, Math.round(bytes / 1e3)) });
  };

  async function prepare(variant: "originals" | "optimized") {
    setLoading(true);
    setError(null);
    setStopped(false);
    try {
      const items: PlanItems = [];
      let cursor: string | undefined;
      let meta = { variant, originalsAllowed: false, title: "" };
      do {
        const page = await onPlan(variant, cursor);
        if (!page.ok) throw new Error("plan");
        items.push(...page.plan.items);
        meta = {
          variant: page.plan.variant,
          originalsAllowed: page.plan.originalsAllowed,
          title: page.plan.title,
        };
        cursor = page.plan.nextCursor ?? undefined;
      } while (cursor);

      const numbers = numberByGuest(items.map((item) => item.guestId));
      const entries = items.map((item, position) => ({
        mediaId: item.mediaId,
        at: item.at,
        bytes: item.bytes,
        name: downloadFileName({
          at: item.at,
          guestName: item.guestName,
          index: numbers[position]!,
          extension: item.extension,
        }),
      }));
      const parts = planParts(entries.map((entry) => entry.bytes));
      setPrepared({ ...meta, entries, parts });
      setStates(parts.map(() => "idle"));
      const { canStreamToDisk } = await import("@/lib/download/zip-download");
      setStreamsToDisk(canStreamToDisk());
    } catch {
      setError(t("prepareFailed"));
    } finally {
      setLoading(false);
    }
  }

  function mark(index: number, state: PartState) {
    setStates((current) => current.map((value, position) => (position === index ? state : value)));
  }

  /** Downloads one part; resolves false when it failed or was stopped. */
  async function runPart(index: number): Promise<boolean> {
    if (!prepared) return false;
    const part = prepared.parts[index]!;
    const entries = prepared.entries.slice(part.start, part.end);
    const controller = abort.current ?? new AbortController();
    abort.current = controller;
    mark(index, "running");
    setRunning({ part: index + 1, files: 0, bytes: 0 });
    try {
      const { downloadZipPart } = await import("@/lib/download/zip-download");
      const saved = await downloadZipPart({
        entries,
        fileName: partFileName(prepared.title, index + 1, prepared.parts.length),
        sign: async (ids) => {
          const answer = await onSign(ids, prepared.variant);
          if (!answer.ok) throw new Error("sign");
          return answer.files;
        },
        onProgress: (progress) => setRunning({ part: index + 1, ...progress }),
        signal: controller.signal,
      });
      mark(index, saved ? "done" : "idle");
      return saved;
    } catch {
      mark(index, controller.signal.aborted ? "idle" : "failed");
      return false;
    } finally {
      setRunning(null);
    }
  }

  async function runAll() {
    abort.current = new AbortController();
    setStopped(false);
    for (let index = 0; index < (prepared?.parts.length ?? 0); index += 1) {
      if (states[index] === "done") continue;
      const ok = await runPart(index);
      if (!ok) break;
    }
    abort.current = null;
  }

  async function runOne(index: number) {
    abort.current = new AbortController();
    setStopped(false);
    await runPart(index);
    abort.current = null;
  }

  function stop() {
    abort.current?.abort();
    setStopped(true);
  }

  const totalBytes = prepared?.entries.reduce((sum, entry) => sum + entry.bytes, 0) ?? 0;
  const partTotal = (index: number) => {
    const part = prepared?.parts[index];
    return part ? part.end - part.start : 0;
  };

  return (
    <Card className="p-6 sm:p-8">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold">{t("title")}</h2>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>

        {error ? (
          <p role="alert" className="font-medium text-danger">
            {error}
          </p>
        ) : null}

        {!prepared ? (
          <Button
            className="self-start"
            disabled={loading}
            onClick={() => void prepare("originals")}
            data-testid="download-prepare"
          >
            <Download aria-hidden />
            {loading ? t("preparing") : t("prepare")}
          </Button>
        ) : prepared.entries.length === 0 ? (
          <p className="text-muted-foreground">{t("empty")}</p>
        ) : (
          <div className="flex flex-col gap-5">
            <p className="font-medium" data-testid="download-summary">
              {t("summary", {
                count: prepared.entries.length,
                size: size(totalBytes),
                parts: prepared.parts.length,
              })}
            </p>

            {prepared.originalsAllowed ? (
              <fieldset className="flex flex-col gap-2" disabled={running !== null}>
                <legend className="font-medium">{t("variantLabel")}</legend>
                {(["originals", "optimized"] as const).map((variant) => (
                  <label key={variant} className="flex min-h-11 cursor-pointer items-center gap-3">
                    <input
                      type="radio"
                      name="download-variant"
                      className="size-5 cursor-pointer accent-primary"
                      checked={choice === variant}
                      onChange={() => {
                        setChoice(variant);
                        void prepare(variant);
                      }}
                    />
                    {t(`variants.${variant}`)}
                  </label>
                ))}
              </fieldset>
            ) : (
              <p className="text-sm text-muted-foreground">{t("freeHint")}</p>
            )}

            {!streamsToDisk ? (
              <p className="text-sm text-muted-foreground">{t("memoryHint")}</p>
            ) : null}

            <ul className="flex flex-col gap-3">
              {prepared.parts.map((part, index) => (
                <li
                  key={part.start}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/60 p-3"
                  data-testid="download-part"
                  data-state={states[index]}
                >
                  <div className="flex flex-col">
                    <span className="font-medium">
                      {t("partLabel", { part: index + 1, total: prepared.parts.length })}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {t("partInfo", { count: partTotal(index), size: size(part.bytes) })}
                    </span>
                    {states[index] === "failed" ? (
                      <span role="alert" className="text-sm font-medium text-danger">
                        {t("failed", { part: index + 1 })}
                      </span>
                    ) : null}
                  </div>
                  {states[index] === "done" ? (
                    <span className="font-medium">{t("done")}</span>
                  ) : (
                    <Button
                      variant="secondary"
                      disabled={running !== null}
                      onClick={() => void runOne(index)}
                      data-testid="download-part-button"
                    >
                      <Download aria-hidden />
                      {states[index] === "failed" ? t("retry") : t("download")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>

            {running ? (
              <div className="flex flex-col gap-2" role="status">
                <p data-testid="download-progress-text">
                  {t("running", {
                    part: running.part,
                    done: running.files,
                    total: partTotal(running.part - 1),
                    size: size(running.bytes),
                  })}
                </p>
                <progress
                  className="h-3 w-full"
                  max={partTotal(running.part - 1)}
                  value={running.files}
                  aria-label={t("progressLabel")}
                />
                <Button variant="secondary" className="self-start" onClick={stop}>
                  <Square aria-hidden />
                  {t("stop")}
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                {prepared.parts.length > 1 && states.some((state) => state !== "done") ? (
                  <Button onClick={() => void runAll()} data-testid="download-all">
                    {t("downloadAll")}
                  </Button>
                ) : null}
                {stopped ? <p role="status">{t("stopped")}</p> : null}
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
