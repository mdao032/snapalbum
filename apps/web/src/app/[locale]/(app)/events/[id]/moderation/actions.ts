"use server";

import {
  MAX_MODERATION_BATCH,
  moderationActionSchema,
  moderationFilterSchema,
  uuidSchema,
  type ModerationAction,
  type ModerationFilter,
} from "@snapalbum/shared";
import { z } from "zod";
import { getOrganiser } from "@/server/auth";
import {
  dismissReports,
  listModeration,
  moderateMedia,
  moderationFile,
  setGuestBlocked,
  type ModerationDeps,
  type ModerationPage,
} from "@/server/moderation";
import { getStorage } from "@/server/storage";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { createSupabaseServerClient } from "@/server/supabase/server";

/** The signed-in organiser and the deps of the moderation functions, or null. */
async function context(eventId: string): Promise<{ ownerId: string; deps: ModerationDeps } | null> {
  if (!uuidSchema.safeParse(eventId).success) return null;
  const user = await getOrganiser(await createSupabaseServerClient());
  if (!user) return null;
  return { ownerId: user.id, deps: { admin: createSupabaseAdminClient(), storage: getStorage() } };
}

export type LoadResult = { ok: true; page: ModerationPage } | { ok: false };

/** One list of the moderation page, or its next page (F-070, F-071). */
export async function loadModerationAction(
  eventId: string,
  filter: ModerationFilter,
  cursor?: string,
): Promise<LoadResult> {
  const parsed = moderationFilterSchema.safeParse(filter);
  const ctx = await context(eventId);
  if (!ctx || !parsed.success) return { ok: false };
  try {
    const result = await listModeration(ctx.deps, ctx.ownerId, eventId, {
      filter: parsed.data,
      cursor,
    });
    return result.ok ? { ok: true, page: result.body } : { ok: false };
  } catch (error) {
    console.error("[moderation] list failed", error);
    return { ok: false };
  }
}

export type ActionResult = { ok: true; changed: number } | { ok: false };

const idsSchema = z.array(uuidSchema).min(1).max(MAX_MODERATION_BATCH);

/** Approves, refuses, hides, restores or deletes media, one or many (F-070, F-071). */
export async function moderateAction(
  eventId: string,
  action: ModerationAction,
  mediaIds: string[],
): Promise<ActionResult> {
  const parsedAction = moderationActionSchema.safeParse(action);
  const parsedIds = idsSchema.safeParse(mediaIds);
  const ctx = await context(eventId);
  if (!ctx || !parsedAction.success || !parsedIds.success) return { ok: false };
  try {
    const result = await moderateMedia(
      ctx.deps,
      ctx.ownerId,
      eventId,
      parsedAction.data,
      parsedIds.data,
    );
    return result.ok ? { ok: true, changed: result.body.changed } : { ok: false };
  } catch (error) {
    console.error("[moderation] action failed", error);
    return { ok: false };
  }
}

/** Keeps the reports of these media as they are: the organiser looked at them (F-073). */
export async function dismissReportsAction(
  eventId: string,
  mediaIds: string[],
): Promise<ActionResult> {
  const parsedIds = idsSchema.safeParse(mediaIds);
  const ctx = await context(eventId);
  if (!ctx || !parsedIds.success) return { ok: false };
  try {
    const result = await dismissReports(ctx.deps, ctx.ownerId, eventId, parsedIds.data);
    return result.ok ? { ok: true, changed: result.body.changed } : { ok: false };
  } catch (error) {
    console.error("[moderation] dismiss failed", error);
    return { ok: false };
  }
}

/** Blocks a guest, or lets them back (F-072). */
export async function blockGuestAction(
  eventId: string,
  guestId: string,
  blocked: boolean,
): Promise<{ ok: boolean }> {
  const ctx = await context(eventId);
  if (!ctx || !uuidSchema.safeParse(guestId).success) return { ok: false };
  try {
    const result = await setGuestBlocked(ctx.deps, ctx.ownerId, eventId, guestId, blocked === true);
    return { ok: result.ok };
  } catch (error) {
    console.error("[moderation] block failed", error);
    return { ok: false };
  }
}

/** The picture of one media, for the one-by-one approval. */
export async function moderationFileAction(
  eventId: string,
  mediaId: string,
): Promise<{ ok: true; url: string | null; kind: "photo" | "video" } | { ok: false }> {
  const ctx = await context(eventId);
  if (!ctx || !uuidSchema.safeParse(mediaId).success) return { ok: false };
  try {
    const result = await moderationFile(ctx.deps, ctx.ownerId, eventId, mediaId);
    return result.ok ? { ok: true, ...result.body } : { ok: false };
  } catch (error) {
    console.error("[moderation] file failed", error);
    return { ok: false };
  }
}
