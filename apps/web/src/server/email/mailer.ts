import "server-only";
import { APP_NAME } from "@snapalbum/shared/brand";
import { Resend } from "resend";
import { getServerEnv } from "@/config/env.server";

/** An e-mail ready to leave: rendered HTML and its plain-text twin (spam filters like both). */
export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Images shown inside the message (the QR code), referenced as `cid:<contentId>`. */
  inlineImages?: { filename: string; content: Buffer; contentId: string; contentType: string }[];
}

/** Where automatic e-mails go. Resend in production; a log line in development. */
export interface Mailer {
  /** Recorded in `email_log`, so it is known how each e-mail left. */
  name: "resend" | "console";
  send(email: OutgoingEmail): Promise<void>;
  /** Many e-mails with no attachment (the album link to every guest): fewer, larger requests. */
  sendMany(emails: OutgoingEmail[]): Promise<void>;
}

/** Resend accepts up to 100 e-mails in one batch call. */
const BATCH_SIZE = 100;

function resendMailer(apiKey: string, from: string): Mailer {
  const resend = new Resend(apiKey);
  return {
    name: "resend",
    async send(email) {
      const { error } = await resend.emails.send({
        from,
        to: email.to,
        subject: email.subject,
        html: email.html,
        text: email.text,
        attachments: email.inlineImages?.map((image) => ({
          filename: image.filename,
          content: image.content,
          contentId: image.contentId,
          contentType: image.contentType,
        })),
      });
      // A refusal is an error: the caller gives the claim back and the next run tries again.
      if (error) throw new Error(`Resend refused the e-mail: ${error.name} ${error.message}`);
    },
    async sendMany(emails) {
      for (let start = 0; start < emails.length; start += BATCH_SIZE) {
        const { error } = await resend.batch.send(
          emails.slice(start, start + BATCH_SIZE).map((email) => ({
            from,
            to: email.to,
            subject: email.subject,
            html: email.html,
            text: email.text,
          })),
        );
        if (error) throw new Error(`Resend refused the batch: ${error.name} ${error.message}`);
      }
    },
  };
}

/**
 * Development without a Resend key: the e-mail is written to the log, never sent anywhere. In
 * production a missing key is a mistake, and fails loudly rather than pretending to send, unless
 * `EMAIL_MODE=log` says so on purpose (tests, a staging site).
 */
function consoleMailer(): Mailer {
  return {
    name: "console",
    async send(email) {
      console.warn(`[email] to ${email.to}: ${email.subject}`);
    },
    async sendMany(emails) {
      for (const email of emails) console.warn(`[email] to ${email.to}: ${email.subject}`);
    },
  };
}

export function getMailer(): Mailer {
  const env = getServerEnv();
  if (env.RESEND_API_KEY) {
    return resendMailer(
      env.RESEND_API_KEY,
      env.EMAIL_FROM ?? `${APP_NAME} <onboarding@resend.dev>`,
    );
  }
  if (env.EMAIL_MODE === "log" || process.env.NODE_ENV !== "production") return consoleMailer();
  throw new Error("RESEND_API_KEY is not set: the e-mails cannot be sent");
}
