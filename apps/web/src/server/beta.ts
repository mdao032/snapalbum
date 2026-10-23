import "server-only";
import {
  ADMIN_PAGE_SIZE,
  generateBetaCode,
  normalizeBetaCode,
  productDetails,
  type BetaRedeemFailure,
} from "@snapalbum/shared";
import type { Database } from "@snapalbum/shared/db-types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomInt } from "node:crypto";
import { getServerEnv } from "@/config/env.server";
import { pageOffset, rpcJson, type AdminPage } from "./admin";

type Client = SupabaseClient<Database>;

/**
 * Field beta (step 6.1). An administrator makes a single-use code for an organiser's address; the
 * organiser enters it on a free event and receives the Event plan without paying. The database
 * decides (`redeem_beta_invitation`); this module draws the codes, applies the plan's retention and
 * translates the answers. Switched by `BETA_MODE`.
 */

export function isBetaMode(): boolean {
  return getServerEnv().BETA_MODE === true;
}

export interface BetaInvitationRow {
  id: string;
  code: string;
  email: string;
  created_at: string;
  revoked_at: string | null;
  redeemed_at: string | null;
  event_id: string | null;
  event_title: string | null;
  state: "open" | "revoked" | "redeemed";
}

export function listBetaInvitations(admin: Client, page: number) {
  return rpcJson<AdminPage<BetaInvitationRow>>(admin, "admin_list_beta_invitations", {
    p_limit: ADMIN_PAGE_SIZE,
    p_offset: pageOffset(page),
  });
}

export type CreateInvitationResult =
  | { ok: true; id: string; code: string }
  | { ok: false; reason: "beta_off" | "invalid_email" | "already_invited" };

/** Tries a few codes: a clash between two random codes is possible, though very unlikely. */
const CODE_ATTEMPTS = 5;

export async function createBetaInvitation(
  admin: Client,
  actorId: string,
  email: string,
  draw: (maxExclusive: number) => number = randomInt,
): Promise<CreateInvitationResult> {
  if (!isBetaMode()) return { ok: false, reason: "beta_off" };
  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
    const code = generateBetaCode(draw);
    const answer = await rpcJson<{ ok: boolean; reason?: string; id?: string }>(
      admin,
      "create_beta_invitation",
      { p_actor: actorId, p_email: email, p_code: code },
    );
    if (answer.ok && answer.id) return { ok: true, id: answer.id, code };
    if (answer.reason === "already_invited") return { ok: false, reason: "already_invited" };
    if (answer.reason !== "duplicate_code") return { ok: false, reason: "invalid_email" };
  }
  throw new Error("Could not draw a free invitation code");
}

export async function revokeBetaInvitation(
  admin: Client,
  actorId: string,
  invitationId: string,
): Promise<{ ok: boolean }> {
  const answer = await rpcJson<{ ok: boolean }>(admin, "revoke_beta_invitation", {
    p_actor: actorId,
    p_id: invitationId,
  });
  return { ok: answer.ok };
}

export type RedeemResult =
  | { ok: true; plan: string; expiresAt: string }
  | { ok: false; reason: BetaRedeemFailure | "beta_off" | "malformed" };

/** Gives the Event plan to a free event with the invitation code the organiser entered. */
export async function redeemBetaInvitation(
  admin: Client,
  userId: string,
  eventId: string,
  input: string,
): Promise<RedeemResult> {
  if (!isBetaMode()) return { ok: false, reason: "beta_off" };
  const code = normalizeBetaCode(input);
  if (!code) return { ok: false, reason: "malformed" };
  const answer = await rpcJson<{
    ok: boolean;
    reason?: BetaRedeemFailure;
    plan?: string;
    expires_at?: string;
  }>(admin, "redeem_beta_invitation", {
    p_user_id: userId,
    p_event_id: eventId,
    p_code: code,
    // The same retention as a paid Event plan, read from `plans.ts`.
    p_months: productDetails("event").months,
  });
  if (!answer.ok) return { ok: false, reason: answer.reason ?? "invalid_code" };
  return { ok: true, plan: answer.plan ?? "event", expiresAt: answer.expires_at ?? "" };
}
