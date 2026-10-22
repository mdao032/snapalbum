import "server-only";
import type { Database } from "@snapalbum/shared/db-types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Mailer, OutgoingEmail } from "./mailer";

type Client = SupabaseClient<Database>;

export interface SendDeps {
  admin: Client;
  mailer: Mailer;
}

/** An e-mail identified by what it is about and who gets it: sent once, however often asked. */
export interface MailKey {
  /** The kind of e-mail (`welcome`, `expiry_reminder_7`...). */
  kind: string;
  eventId: string;
  /** Who gets it, without an address: an account, a guest or a purchase identifier. */
  recipientKey: string;
}

/** A claim older than this was left by a task that died: another run takes it over. */
const STALE_CLAIM_MINUTES = 15;

async function claim(admin: Client, key: MailKey): Promise<boolean> {
  const { data, error } = await admin.rpc("claim_email", {
    p_kind: key.kind,
    p_event_id: key.eventId,
    p_recipient: key.recipientKey,
    p_stale_minutes: STALE_CLAIM_MINUTES,
  });
  if (error) throw error;
  return data === true;
}

async function release(admin: Client, key: MailKey): Promise<void> {
  await admin.rpc("release_email", {
    p_kind: key.kind,
    p_event_id: key.eventId,
    p_recipient: key.recipientKey,
  });
}

async function finish(admin: Client, key: MailKey, provider: string): Promise<void> {
  const { error } = await admin.rpc("finish_email", {
    p_kind: key.kind,
    p_event_id: key.eventId,
    p_recipient: key.recipientKey,
    p_provider: provider,
  });
  if (error) throw error;
}

export type SendOutcome = "sent" | "skipped";

/**
 * Sends one automatic e-mail, once (SPEC 14). The line in `email_log` is taken first: a second
 * run, a second server or a replayed webhook finds it and sends nothing. If sending fails the
 * line is given back, so the next run tries again, and the error is raised.
 */
export async function sendOnce(
  deps: SendDeps,
  key: MailKey,
  build: () => Promise<OutgoingEmail>,
): Promise<SendOutcome> {
  if (!(await claim(deps.admin, key))) return "skipped";
  try {
    await deps.mailer.send(await build());
    await finish(deps.admin, key, deps.mailer.name);
    return "sent";
  } catch (error) {
    await release(deps.admin, key).catch(() => undefined);
    throw error;
  }
}

/**
 * The same for many recipients of the same kind (the album link to every guest): claims what is
 * still to send, sends it in batches, and gives every claim back if the sending fails.
 */
export async function sendManyOnce(
  deps: SendDeps,
  kind: string,
  eventId: string,
  items: { recipientKey: string; build: () => Promise<OutgoingEmail> }[],
): Promise<number> {
  const claimed: MailKey[] = [];
  const emails: OutgoingEmail[] = [];
  try {
    for (const item of items) {
      const key = { kind, eventId, recipientKey: item.recipientKey };
      if (!(await claim(deps.admin, key))) continue;
      claimed.push(key);
      emails.push(await item.build());
    }
    if (emails.length > 0) await deps.mailer.sendMany(emails);
    for (const key of claimed) await finish(deps.admin, key, deps.mailer.name);
    return claimed.length;
  } catch (error) {
    for (const key of claimed) await release(deps.admin, key).catch(() => undefined);
    throw error;
  }
}
