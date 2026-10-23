import type { Locale } from "@snapalbum/shared";
import { APP_NAME } from "@snapalbum/shared/brand";
import { messages } from "@snapalbum/shared/messages";
import { render } from "@react-email/render";
import { formatBytes } from "@/lib/events";
import { createTranslator } from "next-intl";
import type { ReactElement } from "react";
import {
  AccountDeletionEmail,
  FeedbackDigestEmail,
  StorageAlertEmail,
  AlbumReadyEmail,
  CohostInvitationEmail,
  DeletionEmail,
  ExpiryReminderEmail,
  PaymentConfirmedEmail,
  QuotaReachedEmail,
  RecapEmail,
  WelcomeEmail,
  type Translate,
} from "./templates";

/** A rendered e-mail: subject, HTML and plain text, in the recipient's language. */
export interface ComposedEmail {
  subject: string;
  html: string;
  text: string;
}

/** The `emails` messages of a language, as a plain function. */
export function emailTranslator(locale: Locale): Translate {
  const translate = createTranslator({
    locale,
    messages: messages[locale] as unknown as Record<string, unknown>,
    namespace: "emails",
  }) as unknown as Translate;
  return (key, values) => translate(key, values);
}

async function build(subject: string, element: ReactElement): Promise<ComposedEmail> {
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { subject, html, text };
}

export function composeWelcome(input: {
  locale: Locale;
  title: string;
  dashboardUrl: string;
  link: string;
  qrContentId: string;
}) {
  const t = emailTranslator(input.locale);
  return build(
    t("welcome.subject", { appName: APP_NAME }),
    <WelcomeEmail
      t={t}
      title={input.title}
      dashboardUrl={input.dashboardUrl}
      link={input.link}
      qrContentId={input.qrContentId}
    />,
  );
}

export function composeQuotaReached(input: {
  locale: Locale;
  title: string;
  max: string;
  offer: { price: string; newMax: string } | null;
  dashboardUrl: string;
}) {
  const t = emailTranslator(input.locale);
  return build(
    t("quotaReached.subject", { title: input.title }),
    <QuotaReachedEmail
      t={t}
      title={input.title}
      max={input.max}
      offer={input.offer}
      dashboardUrl={input.dashboardUrl}
    />,
  );
}

export function composePaymentConfirmed(input: {
  locale: Locale;
  title: string;
  product: string;
  amount: string;
  keptUntil: string | null;
  dashboardUrl: string;
}) {
  const t = emailTranslator(input.locale);
  return build(
    t("paymentConfirmed.subject", { product: input.product }),
    <PaymentConfirmedEmail
      t={t}
      title={input.title}
      product={input.product}
      amount={input.amount}
      keptUntil={input.keptUntil}
      dashboardUrl={input.dashboardUrl}
    />,
  );
}

export function composeExpiryReminder(input: {
  locale: Locale;
  title: string;
  date: string;
  days: number;
  graceDays: number;
  months: number;
  price: string;
  dashboardUrl: string;
}) {
  const t = emailTranslator(input.locale);
  return build(
    t("expiryReminder.subject", { title: input.title, date: input.date }),
    <ExpiryReminderEmail t={t} {...input} />,
  );
}

export function composeRecap(input: {
  locale: Locale;
  title: string;
  count: number;
  dashboardUrl: string;
}) {
  const t = emailTranslator(input.locale);
  return build(
    t("recap.subject", { title: input.title, count: input.count }),
    <RecapEmail t={t} title={input.title} count={input.count} dashboardUrl={input.dashboardUrl} />,
  );
}

export function composeAlbumReady(input: { locale: Locale; title: string; albumUrl: string }) {
  const t = emailTranslator(input.locale);
  return build(
    t("albumReady.subject", { title: input.title }),
    <AlbumReadyEmail t={t} title={input.title} albumUrl={input.albumUrl} />,
  );
}

export function composeAccountDeletion(input: { locale: Locale; date: string; cancelUrl: string }) {
  const t = emailTranslator(input.locale);
  return build(
    t("accountDeletion.subject"),
    <AccountDeletionEmail t={t} date={input.date} cancelUrl={input.cancelUrl} />,
  );
}

export function composeStorageAlert(input: {
  locale: Locale;
  bytes: number;
  thresholdBytes: number;
  adminUrl: string;
}) {
  const t = emailTranslator(input.locale);
  return build(
    t("storageAlert.subject"),
    <StorageAlertEmail
      t={t}
      used={formatBytes(input.bytes, input.locale)}
      threshold={formatBytes(input.thresholdBytes, input.locale)}
      adminUrl={input.adminUrl}
    />,
  );
}

export function composeFeedbackDigest(input: {
  locale: Locale;
  count: number;
  average: string;
  adminUrl: string;
}) {
  const t = emailTranslator(input.locale);
  return build(
    t("feedbackDigest.subject"),
    <FeedbackDigestEmail
      t={t}
      count={input.count}
      average={input.average}
      adminUrl={input.adminUrl}
    />,
  );
}

export function composeDeletion(input: {
  locale: Locale;
  title: string;
  date: string;
  cancelUrl: string;
}) {
  const t = emailTranslator(input.locale);
  return build(
    t("deletion.subject", { title: input.title }),
    <DeletionEmail t={t} title={input.title} date={input.date} cancelUrl={input.cancelUrl} />,
  );
}

export function composeCohostInvitation(input: {
  locale: Locale;
  title: string;
  inviter: string;
  acceptUrl: string;
}) {
  const t = emailTranslator(input.locale);
  return build(
    t("cohost.subject", { title: input.title, inviter: input.inviter }),
    <CohostInvitationEmail
      t={t}
      title={input.title}
      inviter={input.inviter}
      acceptUrl={input.acceptUrl}
    />,
  );
}
