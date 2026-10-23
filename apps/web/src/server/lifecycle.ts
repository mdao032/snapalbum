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
  /** Most accounts deleted in one run (each can hold many albums); the rest waits. */
  accountBatch?: number;
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
      if (await purgeEventNow(deps, id)) report.purged.push(id);
    } catch (failure) {
      report.failed.push(id);
      console.error("[lifecycle] purge failed", id, failure);
    }
  }
  return report;
}

/**
 * Purges one event that waits for it: its files, then its rows and the audit line, then the
 * anonymous accounts of guests who belong to no other event. False when it is not waiting.
 */
async function purgeEventNow(deps: LifecycleDeps, eventId: string): Promise<boolean> {
  await deps.storage.deleteEventObjects(`events/${eventId}/`);
  const { data, error } = await deps.admin.rpc("purge_event", { p_event_id: eventId });
  if (error) throw error;
  const answer = data as unknown as { ok: boolean; guest_users?: string[] };
  if (!answer.ok) return false;
  await removeOrphanGuests(deps.admin, answer.guest_users ?? []);
  return true;
}

export interface AccountPurgeReport {
  purged: string[];
  failed: string[];
}

/**
 * Deletes the accounts whose organiser asked for it 7 days ago (F-004, G-004): every event first
 * (files, then rows), the photos the account sent to other people's events, the database's own
 * last step, and only then the sign-in account itself. Any step that fails leaves the account for
 * the next run, which starts again where the data is: nothing is half deleted without a way to
 * finish. The audit lines carry no name and no address.
 */
export async function purgeDueAccounts(deps: LifecycleDeps): Promise<AccountPurgeReport> {
  const now = (deps.now ?? (() => new Date()))();
  const cutoff = new Date(now.getTime() - DELETION_GRACE_DAYS * DAY_MS).toISOString();
  const { data: due, error } = await deps.admin
    .from("profiles")
    .select("user_id")
    .not("deleted_at", "is", null)
    .lte("deleted_at", cutoff)
    .order("deleted_at")
    .limit(deps.accountBatch ?? ACCOUNT_BATCH);
  if (error) throw error;

  const report: AccountPurgeReport = { purged: [], failed: [] };
  for (const { user_id: userId } of due) {
    try {
      if (await purgeAccount(deps, userId)) report.purged.push(userId);
    } catch (failure) {
      report.failed.push(userId);
      console.error("[lifecycle] account purge failed", userId, failure);
    }
  }
  return report;
}

/** Default for `accountBatch`: each account can hold many albums, the rest waits for the next run. */
const ACCOUNT_BATCH = 10;

async function purgeAccount(deps: LifecycleDeps, userId: string): Promise<boolean> {
  const { admin } = deps;
  const prepared = await admin.rpc("prepare_account_purge", { p_user_id: userId });
  if (prepared.error) throw prepared.error;
  const { ok, event_ids: eventIds = [] } = prepared.data as unknown as {
    ok: boolean;
    event_ids?: string[];
  };
  if (!ok) return false;

  for (const eventId of eventIds) {
    if (!(await purgeEventNow(deps, eventId))) {
      throw new Error(`event ${eventId} of a deleted account was not purged`);
    }
  }
  await removeGuestContentOf(deps, userId);

  const finished = await admin.rpc("finish_account_purge", { p_user_id: userId });
  if (finished.error) throw finished.error;
  if (!(finished.data as unknown as { ok: boolean }).ok) {
    throw new Error(`account ${userId} could not be finished`);
  }
  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (deleteError) throw deleteError;
  return true;
}

/**
 * An organiser who also took part in other people's events as a guest has photos there: they go
 * with the account (files and rows). The guest rows themselves go with the sign-in account.
 */
async function removeGuestContentOf(deps: LifecycleDeps, userId: string): Promise<void> {
  const { admin, storage } = deps;
  const { data: guests, error } = await admin
    .from("guests")
    .select("id")
    .eq("auth_user_id", userId);
  if (error) throw error;
  for (const { id: guestId } of guests) {
    for (;;) {
      const { data: media, error: mediaError } = await admin
        .from("media")
        .select("id, key_original, key_display, key_thumb")
        .eq("guest_id", guestId)
        .limit(200);
      if (mediaError) throw mediaError;
      if (media.length === 0) break;
      for (const item of media) {
        const keys = [item.key_original, item.key_display, item.key_thumb].filter(
          (key): key is string => Boolean(key),
        );
        await Promise.all(keys.map((key) => storage.deleteObject(key)));
      }
      const { error: deleteError } = await admin
        .from("media")
        .delete()
        .in(
          "id",
          media.map((item) => item.id),
        );
      if (deleteError) throw deleteError;
    }
  }
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
    .select("id, event_id, key_original, key_display, key_thumb")
    .eq("status", "pending")
    .lt("created_at", cutoff)
    .limit(500);
  if (staleError) throw staleError;
  // Counted per event before they disappear: the beta's send success rate needs them (step 6.3).
  const abandoned = new Map<string, number>();
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
    abandoned.set(media.event_id, (abandoned.get(media.event_id) ?? 0) + 1);
  }
  for (const [eventId, count] of abandoned) {
    const { error } = await (
      deps.admin.rpc as unknown as (
        name: string,
        args: Record<string, unknown>,
      ) => PromiseLike<{ error: unknown }>
    )("bump_uploads_abandoned", { p_event_id: eventId, p_count: count });
    if (error) throw error;
  }
  return report;
}
