"use server";

import { uuidSchema } from "@snapalbum/shared";
import { z } from "zod";
import { getOrganiser } from "@/server/auth";
import {
  SIGN_BATCH_SIZE,
  planAlbum,
  signAlbumFiles,
  type AlbumPlan,
  type DownloadDeps,
  type DownloadVariant,
} from "@/server/download";
import { getStorage } from "@/server/storage";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { createSupabaseServerClient } from "@/server/supabase/server";

const variantSchema = z.enum(["originals", "optimized"]);

async function context(eventId: string): Promise<{ ownerId: string; deps: DownloadDeps } | null> {
  if (!uuidSchema.safeParse(eventId).success) return null;
  const user = await getOrganiser(await createSupabaseServerClient());
  if (!user) return null;
  return { ownerId: user.id, deps: { admin: createSupabaseAdminClient(), storage: getStorage() } };
}

/** One page of what the album download contains: names, dates, sizes (F-080, F-083). */
export async function planAlbumAction(
  eventId: string,
  variant: DownloadVariant,
  cursor?: string,
): Promise<{ ok: true; plan: AlbumPlan } | { ok: false }> {
  const parsed = variantSchema.safeParse(variant);
  const ctx = await context(eventId);
  if (!ctx || !parsed.success) return { ok: false };
  try {
    const result = await planAlbum(ctx.deps, ctx.ownerId, eventId, {
      variant: parsed.data,
      cursor,
    });
    return result.ok ? { ok: true, plan: result.body } : { ok: false };
  } catch (error) {
    console.error("[download] plan failed", error);
    return { ok: false };
  }
}

/** Fresh addresses for a group of files, asked right before they are downloaded. */
export async function signAlbumFilesAction(
  eventId: string,
  mediaIds: string[],
  variant: DownloadVariant,
): Promise<{ ok: true; files: { mediaId: string; url: string }[] } | { ok: false }> {
  const parsedVariant = variantSchema.safeParse(variant);
  const parsedIds = z.array(uuidSchema).min(1).max(SIGN_BATCH_SIZE).safeParse(mediaIds);
  const ctx = await context(eventId);
  if (!ctx || !parsedVariant.success || !parsedIds.success) return { ok: false };
  try {
    const result = await signAlbumFiles(
      ctx.deps,
      ctx.ownerId,
      eventId,
      parsedIds.data,
      parsedVariant.data,
    );
    return result.ok ? { ok: true, files: result.body.files } : { ok: false };
  } catch (error) {
    console.error("[download] sign failed", error);
    return { ok: false };
  }
}
