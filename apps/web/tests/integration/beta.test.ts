import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Database } from "@snapalbum/shared/db-types";
import { adminOverview, listAdminPurchases } from "@/server/admin";
import {
  createBetaInvitation,
  listBetaInvitations,
  redeemBetaInvitation,
  revokeBetaInvitation,
} from "@/server/beta";
import { createEvent } from "@/server/events";

/**
 * Field beta (step 6.1) through the real API of the local database: the server module, the SQL
 * functions behind it, and the rights of the API roles. Needs `pnpm db:start`.
 */

function localEnv(): Record<string, string> {
  const text = fs.readFileSync(path.join(__dirname, "../../.env.local"), "utf8");
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
}

const env = localEnv();
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin: SupabaseClient<Database> = createClient<Database>(
  env.NEXT_PUBLIC_SUPABASE_URL!,
  env.SUPABASE_SERVICE_ROLE_KEY!,
  options,
);
const anon = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL!,
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  options,
);

const createdUsers: string[] = [];
const createdEvents: string[] = [];

async function newOrganiser(email = `beta-${randomUUID()}@example.test`) {
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (error || !data.user) throw error ?? new Error("user creation failed");
  createdUsers.push(data.user.id);
  return { id: data.user.id, email };
}

async function newEvent(owner: string) {
  const created = await createEvent(admin, owner, {
    title: "Fête de la bêta",
    eventDate: new Date().toISOString().slice(0, 10),
    type: "birthday",
    locale: "fr",
  });
  if (!created.ok) throw new Error("event not created");
  createdEvents.push(created.event.id);
  return created.event.id;
}

afterAll(async () => {
  await admin.from("beta_invitations").delete().in("redeemed_by", createdUsers);
  await admin.from("beta_invitations").delete().in("created_by", createdUsers);
  await admin.from("purchases").delete().in("user_id", createdUsers);
  await admin.from("events").delete().in("id", createdEvents);
  for (const id of createdUsers) await admin.auth.admin.deleteUser(id);
});

describe("6.1: bêta sur la vraie base", () => {
  it("6.1: un code créé par l'administrateur donne l'offre Événement à l'événement de l'organiser, une seule fois", async () => {
    const boss = await newOrganiser();
    const organiser = await newOrganiser();
    const eventId = await newEvent(organiser.id);
    const before = await adminOverview(admin);

    const invitation = await createBetaInvitation(admin, boss.id, organiser.email);
    if (!invitation.ok) throw new Error("invitation not created");

    // Typed by hand, in lower case, with a dash in the middle.
    const typed = `${invitation.code.slice(0, 5)}-${invitation.code.slice(5)}`.toLowerCase();
    const result = await redeemBetaInvitation(admin, organiser.id, eventId, typed);
    expect(result).toMatchObject({ ok: true, plan: "event" });

    const { data: event } = await admin
      .from("events")
      .select("plan, expires_at")
      .eq("id", eventId)
      .single();
    expect(event?.plan).toBe("event");
    expect(event?.expires_at).not.toBeNull();

    const again = await redeemBetaInvitation(admin, organiser.id, eventId, invitation.code);
    expect(again).toEqual({ ok: false, reason: "already_used" });

    const after = await adminOverview(admin);
    expect(after.events_beta - before.events_beta).toBe(1);
    expect(after.revenue_cents).toBe(before.revenue_cents);

    const purchases = await listAdminPurchases(admin, 1);
    expect(
      purchases.rows.some((row) => row.event_id === eventId && row.source === "beta_invitation"),
    ).toBe(true);
  });

  it("6.1: le code d'un autre organisateur et un code annulé ne marchent pas", async () => {
    const boss = await newOrganiser();
    const owner = await newOrganiser();
    const stranger = await newOrganiser();
    const strangerEvent = await newEvent(stranger.id);
    const ownerEvent = await newEvent(owner.id);

    const invitation = await createBetaInvitation(admin, boss.id, owner.email);
    if (!invitation.ok) throw new Error("invitation not created");
    expect(await redeemBetaInvitation(admin, stranger.id, strangerEvent, invitation.code)).toEqual({
      ok: false,
      reason: "invalid_code",
    });

    expect(await revokeBetaInvitation(admin, boss.id, invitation.id)).toEqual({ ok: true });
    expect(await redeemBetaInvitation(admin, owner.id, ownerEvent, invitation.code)).toEqual({
      ok: false,
      reason: "revoked",
    });

    const list = await listBetaInvitations(admin, 1);
    expect(list.rows.find((row) => row.id === invitation.id)?.state).toBe("revoked");
  });

  it("6.1: les clés publiques de l'API ne lisent ni n'appellent rien", async () => {
    const boss = await newOrganiser();
    const invitation = await createBetaInvitation(admin, boss.id, `x-${randomUUID()}@example.test`);
    if (!invitation.ok) throw new Error("invitation not created");

    const read = await anon.from("beta_invitations").select("code");
    expect(read.error?.message ?? "").toMatch(/permission denied/);

    const call = await anon.rpc(
      "redeem_beta_invitation" as never,
      {
        p_user_id: boss.id,
        p_event_id: randomUUID(),
        p_code: invitation.code,
        p_months: 12,
      } as never,
    );
    expect(call.error?.message ?? "").toMatch(/permission denied/);
  });
});
