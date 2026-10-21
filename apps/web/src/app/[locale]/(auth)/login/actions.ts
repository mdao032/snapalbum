"use server";

import { localeSchema } from "@snapalbum/shared";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientEnv } from "@/config/env";
import { requestMagicLink, startGoogleSignIn, type MagicLinkError } from "@/server/auth";
import { createSupabaseServerClient } from "@/server/supabase/server";

export type LoginFormState =
  | { status: "idle" }
  | { status: "sent"; email: string; resent: boolean }
  | {
      status: "error";
      error: MagicLinkError | "oauth_failed";
      /** Set when the failure came from "send again": the card stays on screen with the error. */
      resendEmail?: string;
    };

async function clientIp(): Promise<string | undefined> {
  const requestHeaders = await headers();
  return requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined;
}

function textField(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** Sends the sign-in link (F-001). Used by the login form and by its "send again" button. */
export async function sendMagicLinkAction(
  _previous: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const supabase = await createSupabaseServerClient();
  const result = await requestMagicLink(
    supabase,
    {
      email: textField(formData, "email"),
      locale: textField(formData, "locale"),
      next: textField(formData, "next"),
      turnstileToken: textField(formData, "cf-turnstile-response"),
    },
    { ip: await clientIp(), siteUrl: clientEnv.NEXT_PUBLIC_SITE_URL },
  );
  const resending = formData.get("resend") === "1";
  if (!result.ok) {
    const resendEmail = resending ? textField(formData, "email") : undefined;
    return { status: "error", error: result.error, resendEmail };
  }
  return { status: "sent", email: result.email, resent: resending };
}

/** Sends the visitor to Google's consent screen (F-002). */
export async function signInWithGoogleAction(
  _previous: LoginFormState,
  formData: FormData,
): Promise<LoginFormState> {
  const locale = localeSchema.safeParse(textField(formData, "locale"));
  if (!locale.success) return { status: "error", error: "oauth_failed" };

  const supabase = await createSupabaseServerClient();
  const result = await startGoogleSignIn(supabase, {
    locale: locale.data,
    next: textField(formData, "next"),
    siteUrl: clientEnv.NEXT_PUBLIC_SITE_URL,
  });
  if (!result.ok) return { status: "error", error: "oauth_failed" };
  redirect(result.url);
}
