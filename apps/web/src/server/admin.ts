import "server-only";
import {
  ADMIN_PAGE_SIZE,
  shouldAlertStorage,
  STORAGE_ALERT_REPEAT_DAYS,
  type Locale,
} from "@snapalbum/shared";
import type { Database } from "@snapalbum/shared/db-types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { composeStorageAlert } from "./email/compose";
import type { Mailer } from "./email/mailer";
import type { Storage } from "./storage";
import { pageUrl } from "./urls";

type Client = SupabaseClient<Database>;

/**
 * What the administrator sees and does (F-090 to F-092, SPEC 9.3). Everything goes through the
 * service role after the page has checked the role (`requireAdmin`), and each gesture leaves a line
 * in the audit log with the administrator's identifier. Lists and figures come from database
 * functions (`admin_*`): they join the sign-in accounts, which the API does not expose.
 */

export async function rpcJson<T>(
  admin: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await (
    admin.rpc as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: unknown }>
  )(name, args);
  if (error) throw error;
  return data as T;
}

export interface Overview {
  events_total: number;
  events_30d: number;
  events_active: number;
  events_suspended: number;
  events_pending_deletion: number;
  events_paid: number;
  /** Events that received the Event plan with a beta invitation code (step 6.1). */
  events_beta: number;
  /** Sends of the beta events that reached the album, and those refused or never confirmed (6.3). */
  beta_uploads_delivered: number;
  beta_uploads_failed: number;
  organisers_total: number;
  media_total: number;
  media_30d: number;
  bytes_total: number;
  revenue_cents: number;
  purchases_paid: number;
  purchases_refunded: number;
  open_reports: number;
}

export function adminOverview(admin: Client, now: Date = new Date()): Promise<Overview> {
  return rpcJson<Overview>(admin, "admin_overview", { p_now: now.toISOString() });
}

export interface AdminPage<T> {
  total: number;
  rows: T[];
}

export interface AdminEventRow {
  id: string;
  title: string;
  public_code: string;
  status: string;
  plan: string;
  event_date: string;
  created_at: string;
  expires_at: string | null;
  media_count: number;
  bytes_used: number;
  owner_id: string;
  owner_email: string | null;
  open_reports: number;
}

export interface AdminOrganiserRow {
  user_id: string;
  email: string | null;
  display_name: string | null;
  locale: string;
  role: string;
  created_at: string;
  deleted_at: string | null;
  events_count: number;
  paid_cents: number;
}

export interface AdminPurchaseRow {
  id: string;
  event_id: string | null;
  event_title: string;
  product: string;
  /** `stripe`, or `beta_invitation` for a plan given by an invitation code (step 6.1). */
  source: string;
  amount_cents: number;
  currency: string;
  status: string;
  created_at: string;
  refunded_at: string | null;
  stripe_payment_intent_id: string | null;
  owner_email: string | null;
}

/** The 0-based offset of a 1-based page number (anything odd is the first page). */
export function pageOffset(page: number): number {
  const safe = Number.isInteger(page) && page >= 1 && page <= 100_000 ? page : 1;
  return (safe - 1) * ADMIN_PAGE_SIZE;
}

export function listAdminEvents(admin: Client, query: string, page: number) {
  return rpcJson<AdminPage<AdminEventRow>>(admin, "admin_list_events", {
    p_query: query.slice(0, 100) || null,
    p_limit: ADMIN_PAGE_SIZE,
    p_offset: pageOffset(page),
  });
}

export function listAdminOrganisers(admin: Client, query: string, page: number) {
  return rpcJson<AdminPage<AdminOrganiserRow>>(admin, "admin_list_organisers", {
    p_query: query.slice(0, 100) || null,
    p_limit: ADMIN_PAGE_SIZE,
    p_offset: pageOffset(page),
  });
}

export function listAdminPurchases(admin: Client, page: number) {
  return rpcJson<AdminPage<AdminPurchaseRow>>(admin, "admin_list_purchases", {
    p_limit: ADMIN_PAGE_SIZE,
    p_offset: pageOffset(page),
  });
}

export interface AdminEventDetail {
  event: Database["public"]["Tables"]["events"]["Row"];
  ownerEmail: string | null;
  purchases: Pick<
    Database["public"]["Tables"]["purchases"]["Row"],
    | "id"
    | "product"
    | "amount_cents"
    | "currency"
    | "status"
    | "created_at"
    | "stripe_payment_intent_id"
  >[];
  reports: OpenReport[];
}

/** One media with open reports: who flagged it for what, and a short-lived picture of it. */
export interface OpenReport {
  mediaId: string;
  eventId: string;
  eventTitle: string;
  kind: string;
  status: string;
  count: number;
  reasons: string[];
  firstReportedAt: string;
  thumbUrl: string | null;
}

/** Most open reports shown at once; the oldest come first. */
const OPEN_REPORTS_SHOWN = 100;

/**
 * The open reports, grouped by media, oldest first (F-090): of the whole platform, or of one
 * event. The picture is a thumbnail's short-lived signed address (SPEC 9.1).
 */
export async function listOpenReports(
  admin: Client,
  storage: Storage,
  eventId?: string,
): Promise<OpenReport[]> {
  let query = admin
    .from("reports")
    .select(
      "media_id, reason, created_at, media!inner(event_id, kind, status, key_thumb, key_display, events!inner(title))",
    )
    .is("resolved_at", null)
    .order("created_at", { ascending: true })
    .limit(500);
  if (eventId) query = query.eq("media.event_id", eventId);
  const { data, error } = await query;
  if (error) throw error;

  const grouped = new Map<string, OpenReport & { key: string | null }>();
  for (const row of data ?? []) {
    const media = row.media as unknown as {
      event_id: string;
      kind: string;
      status: string;
      key_thumb: string | null;
      key_display: string | null;
      events: { title: string };
    };
    const known = grouped.get(row.media_id);
    if (known) {
      known.count += 1;
      if (!known.reasons.includes(row.reason)) known.reasons.push(row.reason);
      continue;
    }
    grouped.set(row.media_id, {
      mediaId: row.media_id,
      eventId: media.event_id,
      eventTitle: media.events.title,
      kind: media.kind,
      status: media.status,
      count: 1,
      reasons: [row.reason],
      firstReportedAt: row.created_at,
      thumbUrl: null,
      key: media.key_thumb ?? media.key_display,
    });
  }

  const shown = [...grouped.values()].slice(0, OPEN_REPORTS_SHOWN);
  return Promise.all(
    shown.map(async ({ key, ...report }) => ({
      ...report,
      thumbUrl:
        key && report.status !== "deleted"
          ? await storage.presignRead(key).catch(() => null)
          : null,
    })),
  );
}

/** One event with its organiser, its payments and its open reports (F-090, F-091). */
export async function getAdminEvent(
  admin: Client,
  storage: Storage,
  eventId: string,
): Promise<AdminEventDetail | null> {
  const { data: event, error } = await admin
    .from("events")
    .select("*")
    .eq("id", eventId)
    .maybeSingle();
  if (error) throw error;
  if (!event) return null;

  const [owner, purchases, reports] = await Promise.all([
    admin.auth.admin.getUserById(event.owner_id),
    admin
      .from("purchases")
      .select("id, product, amount_cents, currency, status, created_at, stripe_payment_intent_id")
      .eq("event_id", eventId)
      .order("created_at", { ascending: false }),
    listOpenReports(admin, storage, eventId),
  ]);
  if (purchases.error) throw purchases.error;
  return {
    event,
    ownerEmail: owner.data.user?.email ?? null,
    purchases: purchases.data ?? [],
    reports,
  };
}

export type AdminActionResult = { ok: true } | { ok: false; reason: "not_possible" };

/** Suspends an active event or lifts the suspension (F-091): guests stop seeing it, nothing is deleted. */
export async function setEventSuspended(
  admin: Client,
  actorId: string,
  eventId: string,
  suspended: boolean,
): Promise<AdminActionResult> {
  const answer = await rpcJson<{ ok: boolean }>(admin, "admin_set_event_suspended", {
    p_event_id: eventId,
    p_suspended: suspended,
    p_actor: actorId,
  });
  return answer.ok ? { ok: true } : { ok: false, reason: "not_possible" };
}

/** Grants months of conservation without payment (F-091). */
export async function extendEvent(
  admin: Client,
  actorId: string,
  eventId: string,
  months: number,
  now: Date = new Date(),
): Promise<AdminActionResult> {
  const answer = await rpcJson<{ ok: boolean }>(admin, "admin_extend_event", {
    p_event_id: eventId,
    p_months: months,
    p_actor: actorId,
    p_now: now.toISOString(),
  });
  return answer.ok ? { ok: true } : { ok: false, reason: "not_possible" };
}

export interface StorageAlertDeps {
  admin: Client;
  mailer: Mailer;
  /** Alert threshold in bytes; null when none is configured. */
  thresholdBytes: number | null;
  now?: () => Date;
}

/**
 * SPEC 9.3: writes to the administrators when the stored volume goes over the threshold, at most
 * once every `STORAGE_ALERT_REPEAT_DAYS` days (the last alert is read from the audit log). Does
 * nothing without a threshold. Called by the daily task.
 */
export async function checkStorageAlert(
  deps: StorageAlertDeps,
): Promise<"sent" | "skipped" | "no_threshold"> {
  const now = (deps.now ?? (() => new Date()))();
  if (!deps.thresholdBytes) return "no_threshold";

  const overview = await adminOverview(deps.admin, now);
  const since = new Date(now.getTime() - STORAGE_ALERT_REPEAT_DAYS * 24 * 60 * 60 * 1000);
  const { data: last, error } = await deps.admin
    .from("audit_log")
    .select("created_at")
    .eq("action", "admin.storage_alert")
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;

  const lastAlertAt = last?.[0] ? new Date(last[0].created_at) : null;
  if (
    !shouldAlertStorage({
      totalBytes: overview.bytes_total,
      thresholdBytes: deps.thresholdBytes,
      lastAlertAt,
      now,
    })
  ) {
    return "skipped";
  }

  const contacts = await rpcJson<{ email: string; locale: Locale }[]>(
    deps.admin,
    "admin_contacts",
    {},
  );
  if (contacts.length === 0) return "skipped";

  // The line is written first: a failed e-mail is not retried every hour of the same day.
  const { error: auditError } = await deps.admin.from("audit_log").insert({
    actor_id: null,
    action: "admin.storage_alert",
    target_type: "platform",
    target_id: null,
    metadata: { bytes: overview.bytes_total, threshold: deps.thresholdBytes },
  });
  if (auditError) throw auditError;

  await deps.mailer.sendMany(
    await Promise.all(
      contacts.map(async (contact) => ({
        to: contact.email,
        ...(await composeStorageAlert({
          locale: contact.locale,
          bytes: overview.bytes_total,
          thresholdBytes: deps.thresholdBytes!,
          adminUrl: pageUrl(contact.locale, "/admin"),
        })),
      })),
    ),
  );
  return "sent";
}
