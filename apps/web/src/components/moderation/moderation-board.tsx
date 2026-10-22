"use client";

import type { ModerationAction, ModerationFilter } from "@snapalbum/shared/schemas";
import { Check, EyeOff, Play, RotateCcw, ShieldBan, Trash2, X } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ModerationGuest, ModerationPage } from "@/server/moderation";
import {
  blockGuestAction,
  dismissReportsAction,
  loadModerationAction,
  moderateAction,
} from "@/app/[locale]/(app)/events/[id]/moderation/actions";
import { ReviewMode } from "./review-mode";

const FILTERS: ModerationFilter[] = ["pending", "reported", "visible", "hidden", "refused"];

/** What can be done to the selection of each list. */
const ACTIONS: Record<ModerationFilter, (ModerationAction | "dismiss")[]> = {
  pending: ["approve", "reject", "hide", "delete"],
  reported: ["dismiss", "hide", "delete"],
  visible: ["hide", "delete"],
  hidden: ["restore", "delete"],
  refused: ["approve", "delete"],
};

const ICONS = {
  approve: Check,
  reject: X,
  hide: EyeOff,
  restore: RotateCcw,
  delete: Trash2,
  dismiss: Check,
} as const;

type Status = "ready" | "loading" | "error";

/**
 * The moderation page (F-070 to F-073): five lists (to approve, reported, visible, hidden,
 * refused), a selection with actions for the whole selection, the one-by-one approval with keyboard
 * shortcuts, and the guests who can be blocked. Deleting asks first, with "keep" first.
 */
export function ModerationBoard({
  eventId,
  initialFilter,
  initialPage,
}: {
  eventId: string;
  initialFilter: ModerationFilter;
  initialPage: ModerationPage;
}) {
  const t = useTranslations("moderation");
  const format = useFormatter();
  const [filter, setFilter] = useState(initialFilter);
  const [page, setPage] = useState(initialPage);
  const [items, setItems] = useState(initialPage.items);
  const [guests, setGuests] = useState<ModerationGuest[]>(initialPage.guests);
  const [status, setStatus] = useState<Status>("ready");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [asking, setAsking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [pending, startTransition] = useTransition();

  const ids = [...selected];
  const nameOf = (guest: string | null) => guest ?? t("tile.anonymous");

  async function load(next: ModerationFilter) {
    setStatus("loading");
    setSelected(new Set());
    setAsking(false);
    const result = await loadModerationAction(eventId, next);
    if (!result.ok) {
      setStatus("error");
      return;
    }
    setFilter(next);
    setPage(result.page);
    setItems(result.page.items);
    if (result.page.guests.length > 0 || next === filter) setGuests(result.page.guests);
    setStatus("ready");
  }

  async function loadMore() {
    if (!page.nextCursor) return;
    const result = await loadModerationAction(eventId, filter, page.nextCursor);
    if (!result.ok) return setNotice(t("failed"));
    const known = new Set(items.map((item) => item.mediaId));
    setItems([...items, ...result.page.items.filter((item) => !known.has(item.mediaId))]);
    setPage({ ...page, nextCursor: result.page.nextCursor, counts: result.page.counts });
  }

  function run(action: ModerationAction | "dismiss", mediaIds: string[]) {
    setAsking(false);
    startTransition(async () => {
      const result =
        action === "dismiss"
          ? await dismissReportsAction(eventId, mediaIds)
          : await moderateAction(eventId, action, mediaIds);
      if (!result.ok) return setNotice(t("failed"));
      setNotice(t("done", { count: result.changed }));
      await load(filter);
    });
  }

  function toggle(mediaId: string) {
    const next = new Set(selected);
    if (!next.delete(mediaId)) next.add(mediaId);
    setSelected(next);
    setAsking(false);
  }

  function block(guest: ModerationGuest) {
    startTransition(async () => {
      const result = await blockGuestAction(eventId, guest.id, !guest.blocked);
      if (!result.ok) return setNotice(t("failed"));
      setGuests(
        guests.map((other) =>
          other.id === guest.id ? { ...other, blocked: !guest.blocked } : other,
        ),
      );
      setNotice(
        t(guest.blocked ? "guests.unblockedDone" : "guests.blockedDone", {
          name: nameOf(guest.name),
        }),
      );
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <div role="tablist" aria-label={t("title")} className="flex flex-wrap gap-2">
        {FILTERS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={filter === name}
            data-testid={`filter-${name}`}
            onClick={() => void load(name)}
            className={cn(
              "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-4 font-medium outline-none ring-1 ring-border focus-visible:ring-4 focus-visible:ring-primary/30",
              filter === name ? "bg-primary text-primary-foreground ring-primary" : "bg-surface",
            )}
          >
            {t(`lists.${name}`)}
            <span className="tabular-nums opacity-80" data-testid={`count-${name}`}>
              {page.counts[name]}
            </span>
          </button>
        ))}
      </div>

      <p role="status" className="min-h-5 text-sm font-medium">
        {notice}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        {filter === "pending" && items.length > 0 ? (
          <Button onClick={() => setReviewing(true)} data-testid="open-review">
            {t("review.open")}
          </Button>
        ) : null}
        {items.length > 0 ? (
          <Button
            variant="secondary"
            onClick={() =>
              setSelected(
                selected.size === items.length
                  ? new Set()
                  : new Set(items.map((item) => item.mediaId)),
              )
            }
          >
            {selected.size === items.length ? t("clearSelection") : t("selectAll")}
          </Button>
        ) : null}
      </div>

      {ids.length > 0 ? (
        <Card className="sticky top-2 z-10 flex flex-col gap-3 p-4" data-testid="selection-bar">
          <p className="font-medium">{t("selected", { count: ids.length })}</p>
          {asking ? (
            <div
              role="group"
              aria-label={t("deleteAsk", { count: ids.length })}
              className="flex flex-col gap-3"
            >
              <p className="font-medium">{t("deleteAsk", { count: ids.length })}</p>
              <div className="flex flex-wrap gap-3">
                <Button variant="secondary" autoFocus onClick={() => setAsking(false)}>
                  {t("deleteNo")}
                </Button>
                <Button disabled={pending} onClick={() => run("delete", ids)}>
                  {t("deleteYes")}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-3">
              {ACTIONS[filter].map((action) => {
                const Icon = ICONS[action];
                return (
                  <Button
                    key={action}
                    variant={action === "delete" ? "secondary" : "primary"}
                    disabled={pending}
                    data-testid={`action-${action}`}
                    onClick={() => (action === "delete" ? setAsking(true) : run(action, ids))}
                  >
                    <Icon aria-hidden />
                    {t(`actions.${action}`)}
                  </Button>
                );
              })}
            </div>
          )}
        </Card>
      ) : null}

      {status === "loading" ? (
        <p role="status" className="text-center text-muted-foreground">
          {t("loading")}
        </p>
      ) : null}
      {status === "error" ? (
        <div className="flex flex-col items-center gap-3">
          <p role="alert">{t("error")}</p>
          <Button variant="secondary" onClick={() => void load(filter)}>
            {t("retry")}
          </Button>
        </div>
      ) : null}
      {status === "ready" && items.length === 0 ? (
        <p className="py-8 text-center text-muted-foreground">{t(`empty.${filter}`)}</p>
      ) : null}

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {items.map((item) => {
          const date = format.dateTime(new Date(item.createdAt), {
            dateStyle: "medium",
            timeStyle: "short",
          });
          const isSelected = selected.has(item.mediaId);
          const label = t(item.kind === "video" ? "tile.video" : "tile.photo", {
            guest: nameOf(item.guestName),
            date,
          });
          return (
            <li key={item.mediaId} data-testid="moderation-tile" data-media-id={item.mediaId}>
              <label
                className={cn(
                  "relative block aspect-square cursor-pointer overflow-hidden rounded-xl bg-muted ring-2",
                  isSelected ? "ring-primary" : "ring-transparent",
                )}
              >
                <input
                  type="checkbox"
                  className="absolute left-2 top-2 z-10 size-6 cursor-pointer accent-primary"
                  checked={isSelected}
                  onChange={() => toggle(item.mediaId)}
                  aria-label={`${t("select")} (${label})`}
                />
                {item.thumbUrl ? (
                  // A short-lived signed address of the storage: nothing `next/image` could serve.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.thumbUrl} alt="" className="size-full object-cover" />
                ) : null}
                {item.kind === "video" ? (
                  <span className="absolute bottom-1 left-1 flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white">
                    <Play aria-hidden className="size-3 fill-current" />
                    {t("tile.videoLabel")}
                  </span>
                ) : null}
                {item.reports > 0 ? (
                  <span className="absolute bottom-1 right-1 rounded bg-danger px-1.5 py-0.5 text-xs font-medium text-white">
                    {t("tile.reports", { count: item.reports })}
                  </span>
                ) : null}
              </label>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {nameOf(item.guestName)}
              </p>
            </li>
          );
        })}
      </ul>

      {page.nextCursor ? (
        <Button variant="secondary" className="self-center" onClick={() => void loadMore()}>
          {t("loadMore")}
        </Button>
      ) : null}

      <Card className="flex flex-col gap-4 p-6" data-testid="guests-panel">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold">{t("guests.title")}</h2>
          <p className="text-muted-foreground">{t("guests.hint")}</p>
        </div>
        <ul className="flex flex-col gap-2">
          {guests.map((guest) => (
            <li key={guest.id} className="flex flex-wrap items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                <span className="font-medium">{guest.name ?? t("guests.anonymous")}</span>
                <span className="text-sm text-muted-foreground">
                  {t("guests.photos", { count: guest.count })}
                </span>
                {guest.blocked ? (
                  <span className="rounded bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger">
                    {t("guests.blocked")}
                  </span>
                ) : null}
              </span>
              <Button
                variant="secondary"
                disabled={pending}
                data-testid="block-guest"
                aria-label={`${t(guest.blocked ? "guests.unblock" : "guests.block")} — ${guest.name ?? t("guests.anonymous")}`}
                onClick={() => block(guest)}
              >
                <ShieldBan aria-hidden />
                {t(guest.blocked ? "guests.unblock" : "guests.block")}
              </Button>
            </li>
          ))}
        </ul>
      </Card>

      {reviewing ? (
        <ReviewMode
          eventId={eventId}
          items={items.filter((item) => item.moderation === "pending")}
          onClose={() => {
            setReviewing(false);
            void load(filter);
          }}
        />
      ) : null}
    </div>
  );
}
