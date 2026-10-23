import "server-only";
import {
  ADMIN_PAGE_SIZE,
  type ApiErrorCode,
  type FeedbackRequestParsed,
  type Locale,
} from "@snapalbum/shared";
import type { Database } from "@snapalbum/shared/db-types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pageOffset, rpcJson } from "./admin";
import { composeFeedbackDigest } from "./email/compose";
import type { Mailer } from "./email/mailer";
import { pageUrl } from "./urls";
import type { RequestUser } from "./request-user";

type Client = SupabaseClient<Database>;

export type FeedbackResult = { ok: true } | { ok: false; status: number; code: ApiErrorCode };
const fail = (status: number, code: ApiErrorCode): FeedbackResult => ({ ok: false, status, code });

/**
 * Stores feedback from an organiser or a guest (step 6.2). The author is checked against the
 * event, whatever the request says: `organiser` must own the event and have a real account,
 * `guest` must have joined it. Anyone else gets "not found", like for an event that does not exist.
 */
export async function submitFeedback(
  admin: Client,
  user: RequestUser,
  body: FeedbackRequestParsed,
): Promise<FeedbackResult> {
  const { data: event, error } = await admin
    .from("events")
    .select("id, owner_id")
    .eq("public_code", body.eventCode)
    .maybeSingle();
  if (error) throw error;
  if (!event) return fail(404, "not_found");

  if (body.audience === "organiser") {
    if (user.isAnonymous || event.owner_id !== user.id) return fail(404, "not_found");
  } else {
    const { count, error: guestError } = await admin
      .from("guests")
      .select("id", { count: "exact", head: true })
      .eq("event_id", event.id)
      .eq("auth_user_id", user.id);
    if (guestError) throw guestError;
    if (!count) return fail(404, "not_found");
  }

  const { error: insertError } = await admin.from("feedback").insert({
    event_id: event.id,
    audience: body.audience,
    user_id: user.id,
    rating: body.rating,
    message: body.message,
    locale: body.locale,
  });
  if (insertError) throw insertError;
  return { ok: true };
}

export interface FeedbackRow {
  id: string;
  audience: "organiser" | "guest";
  rating: number;
  message: string;
  locale: "fr" | "en";
  created_at: string;
  handled_at: string | null;
  event_id: string | null;
  event_title: string | null;
  /** The organiser's address; guests have none. */
  author_email: string | null;
}

export interface FeedbackPage {
  total: number;
  /** Feedback not yet marked as handled. */
  open: number;
  /** Mean rating over all feedback, one decimal; 0 when there is none. */
  average: number;
  rows: FeedbackRow[];
}

/** Feedback for the administrators: not yet handled first, then the newest (step 6.2). */
export function listFeedback(admin: Client, page: number) {
  return rpcJson<FeedbackPage>(admin, "admin_list_feedback", {
    p_limit: ADMIN_PAGE_SIZE,
    p_offset: pageOffset(page),
  });
}

export async function setFeedbackHandled(
  admin: Client,
  actorId: string,
  feedbackId: string,
  handled: boolean,
): Promise<{ ok: boolean }> {
  const answer = await rpcJson<{ ok: boolean }>(admin, "admin_set_feedback_handled", {
    p_actor: actorId,
    p_id: feedbackId,
    p_handled: handled,
  });
  return { ok: answer.ok };
}

export interface FeedbackDigestDeps {
  admin: Client;
  mailer: Mailer;
}

/**
 * Step 6.2: tells the administrators when feedback arrived that nobody handled, at most once a day
 * (called by the daily task). The last digest is read from the audit log and written before the
 * e-mails go out, so a failed send is not retried every hour of the same day.
 */
export async function sendFeedbackDigest(
  deps: FeedbackDigestDeps,
): Promise<{ result: "sent" | "skipped"; count: number }> {
  const { data: last, error: lastError } = await deps.admin
    .from("audit_log")
    .select("created_at")
    .eq("action", "admin.feedback_digest")
    .order("created_at", { ascending: false })
    .limit(1);
  if (lastError) throw lastError;

  let query = deps.admin
    .from("feedback")
    .select("id", { count: "exact", head: true })
    .is("handled_at", null);
  if (last?.[0]) query = query.gt("created_at", last[0].created_at);
  const { count, error } = await query;
  if (error) throw error;
  if (!count) return { result: "skipped", count: 0 };

  const contacts = await rpcJson<{ email: string; locale: Locale }[]>(
    deps.admin,
    "admin_contacts",
    {},
  );
  if (contacts.length === 0) return { result: "skipped", count };

  const { average } = await listFeedback(deps.admin, 1);
  const { error: auditError } = await deps.admin.from("audit_log").insert({
    actor_id: null,
    action: "admin.feedback_digest",
    target_type: "platform",
    target_id: null,
    metadata: { count },
  });
  if (auditError) throw auditError;

  await deps.mailer.sendMany(
    await Promise.all(
      contacts.map(async (contact) => ({
        to: contact.email,
        ...(await composeFeedbackDigest({
          locale: contact.locale,
          count,
          average: new Intl.NumberFormat(contact.locale, { minimumFractionDigits: 1 }).format(
            average,
          ),
          adminUrl: pageUrl(contact.locale, "/admin/feedback"),
        })),
      })),
    ),
  );
  return { result: "sent", count };
}
