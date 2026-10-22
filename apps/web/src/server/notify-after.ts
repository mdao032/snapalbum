import "server-only";
import type { Database } from "@snapalbum/shared/db-types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { getMailer } from "./email/mailer";
import {
  notifyDeletionRequested,
  notifyPaymentConfirmed,
  notifyQuotaReachedByCode,
  notifyWelcome,
  sendAlbumReady,
} from "./notifications";

type Client = SupabaseClient<Database>;

/**
 * Sends an e-mail once the answer has left: the person who clicked is not kept waiting, and a
 * problem with the mail provider never turns their action into a failure. A failed e-mail is
 * logged, and the ones that are tied to a date are tried again by the scheduled tasks.
 */
function later(
  label: string,
  send: (deps: { admin: Client; mailer: ReturnType<typeof getMailer> }) => Promise<unknown>,
  admin: Client,
) {
  after(async () => {
    try {
      await send({ admin, mailer: getMailer() });
    } catch (error) {
      console.error(`[email] ${label} failed`, error);
    }
  });
}

/** The welcome message with the QR code goes with the first event of an organiser only. */
export function scheduleWelcome(admin: Client, ownerId: string, eventId: string) {
  later(
    "welcome e-mail",
    async (deps) => {
      const { count, error } = await admin
        .from("events")
        .select("id", { count: "exact", head: true })
        .eq("owner_id", ownerId);
      if (error) throw error;
      if (count === 1) await notifyWelcome(deps, eventId);
    },
    admin,
  );
}

/** R1: the first refusal for lack of room warns the organiser, once. */
export function scheduleQuotaReached(admin: Client, publicCode: string) {
  later("quota e-mail", (deps) => notifyQuotaReachedByCode(deps, publicCode), admin);
}

/** SPEC 14: the payment confirmation, once per purchase. */
export function schedulePaymentConfirmed(admin: Client, purchaseId: string) {
  later("payment e-mail", (deps) => notifyPaymentConfirmed(deps, purchaseId), admin);
}

/** R5: the confirmation of a deletion the organiser asked for. */
export function scheduleDeletionNotice(admin: Client, eventId: string) {
  later("deletion e-mail", (deps) => notifyDeletionRequested(deps, eventId), admin);
}

/** F-044: the album link to the guests who asked, as soon as the organiser says it is ready. */
export function scheduleAlbumReady(admin: Client, eventId: string) {
  later("album e-mails", (deps) => sendAlbumReady(deps, eventId), admin);
}
