import "server-only";
import {
  albumReadyDueAt,
  buildShortLink,
  dueReminderDays,
  eventSettingsSchema,
  formatPrice,
  getPlan,
  isRecapDue,
  localeSchema,
  productDetails,
  purgeAfter,
  RECAP_MAX_AGE_DAYS,
  reminderKind,
  type Locale,
  DELETION_GRACE_DAYS,
} from "@snapalbum/shared";
import type { Database } from "@snapalbum/shared/db-types";
import { messages } from "@snapalbum/shared/messages";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clientEnv } from "@/config/env";
import {
  composeAlbumReady,
  composeDeletion,
  composeExpiryReminder,
  composePaymentConfirmed,
  composeQuotaReached,
  composeRecap,
  composeWelcome,
} from "./email/compose";
import type { OutgoingEmail } from "./email/mailer";
import { sendManyOnce, sendOnce, type SendDeps } from "./email/send";
import { qrDarkColor, qrPng } from "./qr";
import { pageUrl } from "./urls";

type Client = SupabaseClient<Database>;

/** What every notification needs: the database, the mailer, and the clock (simulated in tests). */
export interface NotifyDeps extends SendDeps {
  now?: () => Date;
}

const EVENT_COLUMNS =
  "id, owner_id, title, locale, plan, status, event_date, expires_at, deleted_at, media_count, public_code, accent_color, settings";

type EventRow = Pick<
  Database["public"]["Tables"]["events"]["Row"],
  | "id"
  | "owner_id"
  | "title"
  | "locale"
  | "plan"
  | "status"
  | "event_date"
  | "expires_at"
  | "deleted_at"
  | "media_count"
  | "public_code"
  | "accent_color"
  | "settings"
>;

async function loadEvent(admin: Client, eventId: string): Promise<EventRow | null> {
  const { data, error } = await admin
    .from("events")
    .select(EVENT_COLUMNS)
    .eq("id", eventId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

const asLocale = (value: string | null | undefined): Locale => {
  const parsed = localeSchema.safeParse(value);
  return parsed.success ? parsed.data : "fr";
};

/** Where to write to an organiser, and in which language (their profile, else the event's). */
async function organiserContact(
  admin: Client,
  ownerId: string,
  fallbackLocale: string,
): Promise<{ email: string; locale: Locale } | null> {
  const { data, error } = await admin.auth.admin.getUserById(ownerId);
  if (error || !data.user?.email) return null;
  const { data: profile } = await admin
    .from("profiles")
    .select("locale")
    .eq("user_id", ownerId)
    .maybeSingle();
  return { email: data.user.email, locale: asLocale(profile?.locale ?? fallbackLocale) };
}

const longDate = (instant: string | Date, locale: Locale) =>
  new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(
    typeof instant === "string" ? new Date(instant) : instant,
  );

function email(to: string, composed: { subject: string; html: string; text: string }) {
  return { to, ...composed } satisfies OutgoingEmail;
}

/** "Bienvenue + QR code" (SPEC 14): the first event of an organiser. */
export async function notifyWelcome(deps: NotifyDeps, eventId: string) {
  const event = await loadEvent(deps.admin, eventId);
  if (!event) return "skipped";
  const contact = await organiserContact(deps.admin, event.owner_id, event.locale);
  if (!contact) return "skipped";
  const link = buildShortLink(clientEnv.NEXT_PUBLIC_SHORT_LINK_BASE, event.public_code);
  return sendOnce(deps, { kind: "welcome", eventId, recipientKey: event.owner_id }, async () => {
    const qr = await qrPng(link, qrDarkColor("ink", event.accent_color));
    const composed = await composeWelcome({
      locale: contact.locale,
      title: event.title,
      dashboardUrl: pageUrl(contact.locale, `/events/${event.id}`),
      link,
      qrContentId: "event-qr",
    });
    return {
      ...email(contact.email, composed),
      inlineImages: [
        { filename: "qr.png", content: qr, contentId: "event-qr", contentType: "image/png" },
      ],
    };
  });
}

/** "Quota atteint" (R1): the album refused a file for lack of room; the organiser hears of it once. */
export async function notifyQuotaReached(deps: NotifyDeps, eventId: string) {
  const event = await loadEvent(deps.admin, eventId);
  if (!event || event.status !== "active") return "skipped";
  const contact = await organiserContact(deps.admin, event.owner_id, event.locale);
  if (!contact) return "skipped";
  const free = event.plan === "free";
  const number = new Intl.NumberFormat(contact.locale);
  return sendOnce(
    deps,
    { kind: "quota_reached", eventId, recipientKey: event.owner_id },
    async () =>
      email(
        contact.email,
        await composeQuotaReached({
          locale: contact.locale,
          title: event.title,
          max: number.format(getPlan(event.plan as "free" | "event" | "pro").maxMedia),
          offer: free
            ? {
                price: formatPrice(productDetails("event").priceCents, contact.locale),
                newMax: number.format(getPlan("event").maxMedia),
              }
            : null,
          dashboardUrl: pageUrl(contact.locale, `/events/${event.id}`),
        }),
      ),
  );
}

/** The same, found by the public code the guest's request carries. */
export async function notifyQuotaReachedByCode(deps: NotifyDeps, publicCode: string) {
  const { data, error } = await deps.admin
    .from("events")
    .select("id")
    .eq("public_code", publicCode)
    .maybeSingle();
  if (error) throw error;
  return data ? notifyQuotaReached(deps, data.id) : "skipped";
}

/** "Paiement confirmé" (SPEC 14): once per purchase, whether the webhook or the return page got there first. */
export async function notifyPaymentConfirmed(deps: NotifyDeps, purchaseId: string) {
  const { data: purchase, error } = await deps.admin
    .from("purchases")
    .select("id, event_id, user_id, product, amount_cents, currency, event_title")
    .eq("id", purchaseId)
    .maybeSingle();
  if (error) throw error;
  if (!purchase?.event_id) return "skipped";
  const event = await loadEvent(deps.admin, purchase.event_id);
  const contact = await organiserContact(deps.admin, purchase.user_id, event?.locale ?? "fr");
  if (!event || !contact) return "skipped";
  const product = purchase.product === "extension" ? "extension" : "event";
  return sendOnce(
    deps,
    { kind: "payment_confirmed", eventId: event.id, recipientKey: purchase.id },
    async () =>
      email(
        contact.email,
        await composePaymentConfirmed({
          locale: contact.locale,
          title: purchase.event_title,
          product: messages[contact.locale].account.purchases.products[product],
          amount: formatPrice(purchase.amount_cents, contact.locale),
          keptUntil: event.expires_at ? longDate(event.expires_at, contact.locale) : null,
          dashboardUrl: pageUrl(contact.locale, `/events/${event.id}`),
        }),
      ),
  );
}

/** "Confirmation de suppression" (F-004, R5): the organiser asked to delete an event. */
export async function notifyDeletionRequested(deps: NotifyDeps, eventId: string) {
  const event = await loadEvent(deps.admin, eventId);
  if (!event?.deleted_at) return "skipped";
  const contact = await organiserContact(deps.admin, event.owner_id, event.locale);
  if (!contact) return "skipped";
  return sendOnce(
    deps,
    // The date is part of the key: deleting again after a cancellation is a new request.
    { kind: "deletion_requested", eventId, recipientKey: `${event.owner_id}:${event.deleted_at}` },
    async () =>
      email(
        contact.email,
        await composeDeletion({
          locale: contact.locale,
          title: event.title,
          date: longDate(purgeAfter(event.deleted_at!), contact.locale),
          cancelUrl: pageUrl(contact.locale, `/events/${event.id}`),
        }),
      ),
  );
}

/** Every page of a query, 500 rows at a time (a request returns at most 1 000 rows). */
async function allPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await page(from, from + 499);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 500) return rows;
  }
}

export interface TaskReport {
  considered: number;
  sent: number;
  failed: number;
}

/** How many messages are prepared at once: fast enough for a busy Saturday, gentle with Resend. */
const SEND_CONCURRENCY = 5;

/**
 * Runs `send` for each item, a few at a time, one failure never stopping the others (the next run
 * retries it).
 */
async function eachSafely<T>(items: T[], send: (item: T) => Promise<string>): Promise<TaskReport> {
  const report: TaskReport = { considered: items.length, sent: 0, failed: 0 };
  for (let start = 0; start < items.length; start += SEND_CONCURRENCY) {
    await Promise.all(
      items.slice(start, start + SEND_CONCURRENCY).map(async (item) => {
        try {
          if ((await send(item)) === "sent") report.sent += 1;
        } catch (error) {
          report.failed += 1;
          console.error("[email] a message could not be sent", error);
        }
      }),
    );
  }
  return report;
}

/**
 * Expiry reminders, J-7 and J-1 (R3): for every album that will close within a week, the one
 * reminder that is due, once. Download link and extension offer in the message.
 */
export async function sendExpiryReminders(deps: NotifyDeps): Promise<TaskReport> {
  const now = (deps.now ?? (() => new Date()))();
  const horizon = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);
  const events = await allPages<EventRow>((from, to) =>
    deps.admin
      .from("events")
      .select(EVENT_COLUMNS)
      .eq("status", "active")
      .neq("plan", "pro")
      .gt("expires_at", now.toISOString())
      .lte("expires_at", horizon.toISOString())
      .order("id")
      .range(from, to),
  );

  return eachSafely(events, async (event) => {
    const days = dueReminderDays(event.expires_at!, now);
    if (days === null) return "skipped";
    const contact = await organiserContact(deps.admin, event.owner_id, event.locale);
    if (!contact) return "skipped";
    const extension = productDetails("extension");
    return sendOnce(
      deps,
      { kind: reminderKind(days), eventId: event.id, recipientKey: event.owner_id },
      async () =>
        email(
          contact.email,
          await composeExpiryReminder({
            locale: contact.locale,
            title: event.title,
            date: longDate(event.expires_at!, contact.locale),
            days,
            graceDays: DELETION_GRACE_DAYS,
            months: extension.months,
            price: formatPrice(extension.priceCents, contact.locale),
            dashboardUrl: pageUrl(contact.locale, `/events/${event.id}`),
          }),
        ),
    );
  });
}

/** Guests who asked, with consent, to be told when the album is ready (F-044). */
async function guestsToTell(admin: Client, eventId: string) {
  const { data, error } = await admin
    .from("guests")
    .select("id, notify_email")
    .eq("event_id", eventId)
    .not("notify_email", "is", null)
    .not("notify_consent_at", "is", null)
    .is("blocked_at", null);
  if (error) throw error;
  return data.flatMap((guest) =>
    guest.notify_email ? [{ id: guest.id, email: guest.notify_email }] : [],
  );
}

/**
 * "Album prêt" for the guests of one event (F-044): the album link to everyone who asked, once.
 * Nothing goes out when the organiser did not open the gallery to guests: there is nothing to see.
 */
export async function sendAlbumReady(deps: NotifyDeps, eventId: string): Promise<number> {
  const event = await loadEvent(deps.admin, eventId);
  if (!event || event.status !== "active") return 0;
  const settings = eventSettingsSchema.safeParse(event.settings);
  if (!settings.success || !settings.data.gallery_visible) return 0;
  const guests = await guestsToTell(deps.admin, eventId);
  if (guests.length === 0) return 0;

  const locale = asLocale(event.locale);
  const albumUrl = pageUrl(locale, `/e/${event.public_code}`);
  return sendManyOnce(
    deps,
    "album_ready",
    event.id,
    guests.map((guest) => ({
      recipientKey: guest.id,
      build: async () =>
        email(guest.email, await composeAlbumReady({ locale, title: event.title, albumUrl })),
    })),
  );
}

/** Events that already have an e-mail of this kind in the log: nothing to look up for them. */
async function alreadyLogged(
  admin: Client,
  kind: string,
  eventIds: string[],
): Promise<Set<string>> {
  const logged = new Set<string>();
  for (let start = 0; start < eventIds.length; start += 100) {
    const { data, error } = await admin
      .from("email_log")
      .select("event_id")
      .eq("kind", kind)
      .eq("status", "sent")
      .in("event_id", eventIds.slice(start, start + 100));
    if (error) throw error;
    for (const row of data) logged.add(row.event_id);
  }
  return logged;
}

/** Events with at least one guest waiting for the album link (consent given, not blocked). */
async function eventsWithGuestsToTell(admin: Client): Promise<string[]> {
  const rows = await allPages<{ event_id: string }>((from, to) =>
    admin
      .from("guests")
      .select("event_id")
      .not("notify_email", "is", null)
      .not("notify_consent_at", "is", null)
      .is("blocked_at", null)
      .order("event_id")
      .range(from, to),
  );
  return [...new Set(rows.map((row) => row.event_id))];
}

/**
 * The daily task of the day after (SPEC 14, F-044): the recap to each organiser whose party is
 * over, and the album link to the guests of every event whose album is ready (declared by the
 * organiser, or the day after the event by default). Work grows with the parties of the last
 * week and with the guests who asked for a link, never with every event ever created.
 */
export async function runDailyRecap(
  deps: NotifyDeps,
): Promise<{ recaps: TaskReport; albumReady: { events: number; sent: number; failed: number } }> {
  const now = (deps.now ?? (() => new Date()))();
  const day = (offset: number) =>
    new Date(now.getTime() + offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const recent = await allPages<EventRow>((from, to) =>
    deps.admin
      .from("events")
      .select(EVENT_COLUMNS)
      .eq("status", "active")
      .gte("event_date", day(-(RECAP_MAX_AGE_DAYS + 2)))
      .lte("event_date", day(-1))
      .order("id")
      .range(from, to),
  );
  const dueRecaps = recent.filter((event) => isRecapDue(event.event_date, now));
  const done = await alreadyLogged(
    deps.admin,
    "recap_next_day",
    dueRecaps.map((event) => event.id),
  );
  const recaps = await eachSafely(
    dueRecaps.filter((event) => !done.has(event.id)),
    async (event) => {
      const contact = await organiserContact(deps.admin, event.owner_id, event.locale);
      if (!contact) return "skipped";
      return sendOnce(
        deps,
        { kind: "recap_next_day", eventId: event.id, recipientKey: event.owner_id },
        async () =>
          email(
            contact.email,
            await composeRecap({
              locale: contact.locale,
              title: event.title,
              count: event.media_count,
              dashboardUrl: pageUrl(contact.locale, `/events/${event.id}`),
            }),
          ),
      );
    },
  );

  const waiting = await eventsWithGuestsToTell(deps.admin);
  const albumReady = { events: 0, sent: 0, failed: 0 };
  for (let start = 0; start < waiting.length; start += 100) {
    const { data: events, error } = await deps.admin
      .from("events")
      .select(EVENT_COLUMNS)
      .eq("status", "active")
      .gte("event_date", day(-40))
      .in("id", waiting.slice(start, start + 100));
    if (error) throw error;
    for (const event of events) {
      const settings = eventSettingsSchema.safeParse(event.settings);
      const readyAt = settings.success ? (settings.data.album_ready_at ?? null) : null;
      if (albumReadyDueAt({ eventDate: event.event_date, readyAt }).getTime() > now.getTime()) {
        continue;
      }
      albumReady.events += 1;
      try {
        albumReady.sent += await sendAlbumReady(deps, event.id);
      } catch (failure) {
        albumReady.failed += 1;
        console.error("[email] the album link could not be sent", failure);
      }
    }
  }
  return { recaps, albumReady };
}
