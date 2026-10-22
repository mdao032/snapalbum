import "server-only";
import { DELETION_GRACE_DAYS } from "@snapalbum/shared";
import type { Database } from "@snapalbum/shared/db-types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Storage } from "./storage";

type Client = SupabaseClient<Database>;

/**
 * The life of an event after the party (SPEC 9.2): an album whose conservation ran out is closed,
 * then purged 7 days later, base and storage, with a line in the audit log for each. These are
 * the bodies of the scheduled tasks; the routes only check the secret and call them.
 */

export interface LifecycleDeps {
  admin: Client;
  storage: Storage;
  now?: () => Date;
  /** Most events purged in one run; the rest waits for the next one. */
  purgeBatch?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PURGE_BATCH = 50;

/**
 * Closes the albums whose `expires_at` has passed and erases the e-mail addresses their guests
 * left (SPEC 7). One database function does it all in one transaction, and writes the audit line.
 */
export async function expireEvents(deps: LifecycleDeps): Promise<{ expired: string[] }> {
  const now = (deps.now ?? (() => new Date()))();
  const { data, error } = await deps.admin.rpc("expire_due_events", { p_now: now.toISOString() });
  if (error) throw error;
  const answer = data as unknown as { expired?: string[] };
  return { expired: answer.expired ?? [] };
}

export interface PurgeReport {
  purged: string[];
  failed: string[];
}

/**
 * Purges the events that have waited for 7 days (R5 for the ones the organiser deleted, SPEC 9.2
 * for the ones that expired): every file first, then the rows and the audit line in one
 * transaction, then the anonymous accounts of guests who belong to no other event. The storage
 * comes first on purpose: a crash in between leaves rows to purge again, never files without an
 * owner. An event that fails is left for the next run; the others go on.
 */
export async function purgeDueEvents(deps: LifecycleDeps): Promise<PurgeReport> {
  const now = (deps.now ?? (() => new Date()))();
  const cutoff = new Date(now.getTime() - DELETION_GRACE_DAYS * DAY_MS).toISOString();
  const { data: due, error } = await deps.admin
    .from("events")
    .select("id")
    .eq("status", "pending_deletion")
    .lte("deleted_at", cutoff)
    .order("deleted_at")
    .limit(deps.purgeBatch ?? DEFAULT_PURGE_BATCH);
  if (error) throw error;

  const report: PurgeReport = { purged: [], failed: [] };
  for (const { id } of due) {
    try {
      await deps.storage.deleteEventObjects(`events/${id}/`);
      const { data, error: purgeError } = await deps.admin.rpc("purge_event", { p_event_id: id });
      if (purgeError) throw purgeError;
      const answer = data as unknown as { ok: boolean; guest_users?: string[] };
      if (!answer.ok) continue;
      report.purged.push(id);
      await removeOrphanGuests(deps.admin, answer.guest_users ?? []);
    } catch (failure) {
      report.failed.push(id);
      console.error("[lifecycle] purge failed", id, failure);
    }
  }
  return report;
}

/**
 * Guests are anonymous accounts. Once their event is gone, one that belongs to no other event
 * has nothing left to do here: it is deleted too (RGPD: nothing is kept without a reason).
 */
async function removeOrphanGuests(admin: Client, authUserIds: string[]): Promise<void> {
  for (const userId of authUserIds) {
    const { count, error } = await admin
      .from("guests")
      .select("id", { count: "exact", head: true })
      .eq("auth_user_id", userId);
    if (error || (count ?? 0) > 0) continue;
    const { data } = await admin.auth.admin.getUserById(userId);
    // Only anonymous accounts: a guest who is also an organiser keeps their account.
    if (data.user?.is_anonymous) await admin.auth.admin.deleteUser(userId).catch(() => undefined);
  }
}

/** Reservations never confirmed are dropped after this long (SPEC 9.2). */
const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface CleanupReport {
  mediaRemoved: number;
  multipartAborted: number;
}

/**
 * The hourly clean-up (SPEC 9.2): media still `pending` after 24 hours (a closed tab, a lost
 * phone) lose their reservation and whatever file they left; multipart uploads past their expiry
 * are aborted so the parts stop costing storage. Counters follow by trigger.
 */
export async function cleanupUploads(deps: LifecycleDeps): Promise<CleanupReport> {
  const now = (deps.now ?? (() => new Date()))();
  const report: CleanupReport = { mediaRemoved: 0, multipartAborted: 0 };

  const { data: uploads, error: uploadsError } = await deps.admin
    .from("uploads")
    .select("id, media_id, multipart_upload_id")
    .lt("expires_at", now.toISOString())
    .limit(200);
  if (uploadsError) throw uploadsError;
  for (const upload of uploads) {
    const { data: media } = await deps.admin
      .from("media")
      .select("key_original")
      .eq("id", upload.media_id)
      .maybeSingle();
    if (media?.key_original) {
      await deps.storage
        .abortMultipart(media.key_original, upload.multipart_upload_id)
        .catch(() => undefined);
    }
    await deps.admin.from("uploads").delete().eq("id", upload.id);
    report.multipartAborted += 1;
  }

  const cutoff = new Date(now.getTime() - PENDING_MAX_AGE_MS).toISOString();
  const { data: stale, error: staleError } = await deps.admin
    .from("media")
    .select("id, key_original, key_display, key_thumb")
    .eq("status", "pending")
    .lt("created_at", cutoff)
    .limit(500);
  if (staleError) throw staleError;
  for (const media of stale) {
    const keys = [media.key_original, media.key_display, media.key_thumb].filter(
      (key): key is string => Boolean(key),
    );
    await Promise.all(keys.map((key) => deps.storage.deleteObject(key).catch(() => undefined)));
    const { error } = await deps.admin
      .from("media")
      .delete()
      .eq("id", media.id)
      .eq("status", "pending");
    if (error) throw error;
    report.mediaRemoved += 1;
  }
  return report;
}
