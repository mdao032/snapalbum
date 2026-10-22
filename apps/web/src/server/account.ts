import "server-only";
import { DELETION_GRACE_DAYS, purgeAfter } from "@snapalbum/shared";
import type { Database } from "@snapalbum/shared/db-types";
import type { SupabaseClient } from "@supabase/supabase-js";

type Client = SupabaseClient<Database>;

/**
 * The organiser's account, from the point of view of their rights (F-004, G-004): a copy of their
 * data, and the deletion of the account with the same 7 days of reflection as an event (R5). The
 * server writes with the service role after the caller has been identified; the rules themselves
 * live in database functions (`request_account_deletion` and its siblings) so that they run in
 * one transaction.
 */

export type RequestDeletionResult =
  | { ok: true; deletedAt: Date; purgeAt: Date; eventIds: string[] }
  | { ok: false; reason: "already_requested" | "no_profile" };

/** Marks the account and closes its active events: guests no longer see them, the 7 days start. */
export async function requestAccountDeletion(
  admin: Client,
  userId: string,
  now: Date = new Date(),
): Promise<RequestDeletionResult> {
  const { data, error } = await admin.rpc("request_account_deletion", {
    p_user_id: userId,
    p_now: now.toISOString(),
  });
  if (error) throw error;
  const answer = data as unknown as {
    ok: boolean;
    reason?: "already_requested" | "no_profile";
    event_ids?: string[];
  };
  if (!answer.ok) return { ok: false, reason: answer.reason ?? "no_profile" };
  return { ok: true, deletedAt: now, purgeAt: purgeAfter(now), eventIds: answer.event_ids ?? [] };
}

export type CancelDeletionResult =
  { ok: true; restored: number } | { ok: false; reason: "not_requested" | "too_late" };

/** Brings the account and the events closed by the request back, within the 7 days. */
export async function cancelAccountDeletion(
  admin: Client,
  userId: string,
  now: Date = new Date(),
): Promise<CancelDeletionResult> {
  const { data, error } = await admin.rpc("cancel_account_deletion", {
    p_user_id: userId,
    p_now: now.toISOString(),
    p_grace_days: DELETION_GRACE_DAYS,
  });
  if (error) throw error;
  const answer = data as unknown as {
    ok: boolean;
    reason?: "not_requested" | "too_late";
    restored?: number;
  };
  return answer.ok
    ? { ok: true, restored: answer.restored ?? 0 }
    : { ok: false, reason: answer.reason ?? "not_requested" };
}

/** Rows of a table, 500 at a time (a request returns at most 1 000 rows). */
async function allRows<T>(
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

export interface AccountExport {
  /** Version of this format, so that a reader can tell what to expect. */
  format: 1;
  exportedAt: string;
  note: string;
  account: {
    id: string;
    email: string | null;
    displayName: string | null;
    language: string;
    createdAt: string;
    deletionRequestedAt: string | null;
  };
  events: ExportedEvent[];
  purchases: {
    id: string;
    product: string;
    eventTitle: string;
    amountCents: number;
    currency: string;
    status: string;
    createdAt: string;
    refundedAt: string | null;
  }[];
}

interface ExportedEvent {
  id: string;
  title: string;
  type: string;
  date: string;
  language: string;
  plan: string;
  status: string;
  deletionReason: string | null;
  createdAt: string;
  expiresAt: string | null;
  welcomeMessage: string | null;
  publicCode: string;
  settings: Record<string, unknown>;
  mediaCount: number;
  bytesUsed: number;
  shareLinks: { createdAt: string; revokedAt: string | null }[];
  guests: {
    id: string;
    firstName: string | null;
    joinedAt: string;
    acceptedTermsAt: string | null;
    blockedAt: string | null;
    mediaCount: number;
  }[];
  media: {
    id: string;
    guestId: string;
    kind: string;
    mimeType: string;
    status: string;
    moderation: string;
    takenAt: string | null;
    uploadedAt: string;
    width: number | null;
    height: number | null;
    durationSeconds: number | null;
    bytesOriginal: number | null;
    bytesDisplay: number | null;
    favorite: boolean;
  }[];
}

const NOTE =
  "Copy of the data of your account (G-004). The photos and videos themselves are downloaded from each event, as ZIP files. E-mail addresses that guests left to be notified are not included: they are theirs, and the organiser never sees them.";

/**
 * A copy of the organiser's data (G-004, "JSON + media"): profile, events with their settings,
 * the list of their photos and videos, guests' first names, share links (without their secret)
 * and purchases. Left out on purpose: the access code (only ever stored as a hash), file
 * addresses, share tokens and guests' e-mail addresses. The files themselves are downloaded
 * from each event, as ZIP files (F-080).
 */
export async function buildAccountExport(
  admin: Client,
  user: { id: string; email?: string | null },
  now: Date = new Date(),
): Promise<AccountExport> {
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("display_name, locale, created_at, deleted_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profileError) throw profileError;

  const events = await allRows((from, to) =>
    admin
      .from("events")
      .select("*")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: true })
      .range(from, to),
  );

  const exported: ExportedEvent[] = [];
  for (const event of events) {
    const [media, guests, links] = await Promise.all([
      allRows((from, to) =>
        admin
          .from("media")
          .select(
            "id, guest_id, kind, mime_type, status, moderation, taken_at, captured_at, created_at, width, height, duration_s, bytes_original, bytes_display, is_favorite",
          )
          .eq("event_id", event.id)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      ),
      allRows((from, to) =>
        admin
          .from("guests")
          .select("id, display_name, created_at, terms_accepted_at, blocked_at")
          .eq("event_id", event.id)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      ),
      allRows((from, to) =>
        admin
          .from("share_links")
          .select("created_at, revoked_at")
          .eq("event_id", event.id)
          .order("created_at", { ascending: true })
          .range(from, to),
      ),
    ]);

    const perGuest = new Map<string, number>();
    for (const item of media) perGuest.set(item.guest_id, (perGuest.get(item.guest_id) ?? 0) + 1);

    // The access code is only ever stored hashed; the hash is not data worth handing over either.
    const settings: Record<string, unknown> = { ...(event.settings as Record<string, unknown>) };
    delete settings.access_code_hash;

    exported.push({
      id: event.id,
      title: event.title,
      type: event.type,
      date: event.event_date,
      language: event.locale,
      plan: event.plan,
      status: event.status,
      deletionReason: event.deletion_reason,
      createdAt: event.created_at,
      expiresAt: event.expires_at,
      welcomeMessage: event.welcome_message,
      publicCode: event.public_code,
      settings,
      mediaCount: event.media_count,
      bytesUsed: event.bytes_used,
      shareLinks: links.map((link) => ({ createdAt: link.created_at, revokedAt: link.revoked_at })),
      guests: guests.map((guest) => ({
        id: guest.id,
        firstName: guest.display_name,
        joinedAt: guest.created_at,
        acceptedTermsAt: guest.terms_accepted_at,
        blockedAt: guest.blocked_at,
        mediaCount: perGuest.get(guest.id) ?? 0,
      })),
      media: media.map((item) => ({
        id: item.id,
        guestId: item.guest_id,
        kind: item.kind,
        mimeType: item.mime_type,
        status: item.status,
        moderation: item.moderation,
        takenAt: item.taken_at ?? item.captured_at,
        uploadedAt: item.created_at,
        width: item.width,
        height: item.height,
        durationSeconds: item.duration_s,
        bytesOriginal: item.bytes_original,
        bytesDisplay: item.bytes_display,
        favorite: item.is_favorite,
      })),
    });
  }

  const purchases = await allRows((from, to) =>
    admin
      .from("purchases")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .range(from, to),
  );

  return {
    format: 1,
    exportedAt: now.toISOString(),
    note: NOTE,
    account: {
      id: user.id,
      email: user.email ?? null,
      displayName: profile?.display_name ?? null,
      language: profile?.locale ?? "fr",
      createdAt: profile?.created_at ?? now.toISOString(),
      deletionRequestedAt: profile?.deleted_at ?? null,
    },
    events: exported,
    purchases: purchases.map((purchase) => ({
      id: purchase.id,
      product: purchase.product,
      eventTitle: purchase.event_title,
      amountCents: purchase.amount_cents,
      currency: purchase.currency,
      status: purchase.status,
      createdAt: purchase.created_at,
      refundedAt: purchase.refunded_at,
    })),
  };
}
