import { APP_NAME, BRAND_COLORS } from "@snapalbum/shared/brand";
import {
  Body,
  Button,
  Container,
  Head,
  Html,
  Hr,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { ReactNode } from "react";

/**
 * The transactional e-mails (SPEC 14), written once and rendered in the recipient's language: every
 * sentence comes from `messages/*.json` (`emails.*`), nothing is typed here. The look follows
 * `brand.ts` and stays plain on purpose: mail clients are old and unforgiving.
 */

export type Translate = (key: string, values?: Record<string, string | number>) => string;

const font =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

const styles = {
  body: { backgroundColor: BRAND_COLORS.canvas, fontFamily: font, margin: 0, padding: "24px 0" },
  container: {
    backgroundColor: "#ffffff",
    borderRadius: "16px",
    maxWidth: "520px",
    padding: "32px 28px",
  },
  brand: { color: BRAND_COLORS.primary, fontSize: "18px", fontWeight: 700, margin: "0 0 24px" },
  title: { color: BRAND_COLORS.ink, fontSize: "22px", lineHeight: "30px", margin: "0 0 16px" },
  text: { color: BRAND_COLORS.ink, fontSize: "16px", lineHeight: "24px", margin: "0 0 16px" },
  button: {
    backgroundColor: BRAND_COLORS.primary,
    borderRadius: "999px",
    color: "#ffffff",
    display: "inline-block",
    fontSize: "16px",
    fontWeight: 600,
    padding: "14px 28px",
    textDecoration: "none",
  },
  small: { color: "#5b5870", fontSize: "13px", lineHeight: "20px", margin: "0 0 8px" },
  rule: { borderColor: "#e8e6f0", margin: "28px 0 16px" },
} as const;

function Layout({
  t,
  preview,
  footer,
  children,
}: {
  t: Translate;
  preview: string;
  footer: "footerOrganiser" | "footerGuest";
  children: ReactNode;
}) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Text style={styles.brand}>{APP_NAME}</Text>
          {children}
          <Hr style={styles.rule} />
          <Text style={styles.small}>{t(footer, { appName: APP_NAME })}</Text>
        </Container>
      </Body>
    </Html>
  );
}

function Cta({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Section style={{ margin: "8px 0 20px" }}>
      <Button href={href} style={styles.button}>
        {children}
      </Button>
    </Section>
  );
}

export function WelcomeEmail({
  t,
  title,
  dashboardUrl,
  link,
  qrContentId,
}: {
  t: Translate;
  title: string;
  dashboardUrl: string;
  link: string;
  qrContentId: string;
}) {
  return (
    <Layout t={t} preview={t("welcome.preview")} footer="footerOrganiser">
      <Text style={styles.title}>{t("welcome.title", { title })}</Text>
      <Text style={styles.text}>{t("welcome.intro")}</Text>
      <Section style={{ textAlign: "center", margin: "8px 0 16px" }}>
        <Img
          src={`cid:${qrContentId}`}
          alt={t("welcome.qrAlt", { title })}
          width="200"
          height="200"
          style={{ margin: "0 auto" }}
        />
      </Section>
      <Text style={styles.text}>
        {t("welcome.linkLabel")} <Link href={link}>{link}</Link>
      </Text>
      <Text style={styles.text}>{t("welcome.next")}</Text>
      <Cta href={dashboardUrl}>{t("welcome.cta")}</Cta>
    </Layout>
  );
}

export function QuotaReachedEmail({
  t,
  title,
  max,
  offer,
  dashboardUrl,
}: {
  t: Translate;
  title: string;
  max: string;
  /** Present on the free plan: what the Event plan changes. */
  offer: { price: string; newMax: string } | null;
  dashboardUrl: string;
}) {
  return (
    <Layout t={t} preview={t("quotaReached.preview")} footer="footerOrganiser">
      <Text style={styles.title}>{t("quotaReached.title", { title })}</Text>
      <Text style={styles.text}>
        {t(offer ? "quotaReached.free" : "quotaReached.paid", { max })}
      </Text>
      {offer ? <Text style={styles.text}>{t("quotaReached.offer", offer)}</Text> : null}
      <Cta href={dashboardUrl}>{t(offer ? "quotaReached.cta" : "quotaReached.ctaPaid")}</Cta>
    </Layout>
  );
}

export function PaymentConfirmedEmail({
  t,
  title,
  product,
  amount,
  keptUntil,
  dashboardUrl,
}: {
  t: Translate;
  title: string;
  product: string;
  amount: string;
  keptUntil: string | null;
  dashboardUrl: string;
}) {
  return (
    <Layout t={t} preview={t("paymentConfirmed.preview")} footer="footerOrganiser">
      <Text style={styles.title}>{t("paymentConfirmed.title")}</Text>
      <Text style={styles.text}>{t("paymentConfirmed.body", { amount, title, product })}</Text>
      {keptUntil ? (
        <Text style={styles.text}>{t("paymentConfirmed.keptUntil", { date: keptUntil })}</Text>
      ) : null}
      <Text style={styles.text}>{t("paymentConfirmed.invoice")}</Text>
      <Cta href={dashboardUrl}>{t("paymentConfirmed.cta")}</Cta>
    </Layout>
  );
}

export function ExpiryReminderEmail({
  t,
  title,
  date,
  days,
  graceDays,
  months,
  price,
  dashboardUrl,
}: {
  t: Translate;
  title: string;
  date: string;
  days: number;
  graceDays: number;
  months: number;
  price: string;
  dashboardUrl: string;
}) {
  return (
    <Layout t={t} preview={t("expiryReminder.preview")} footer="footerOrganiser">
      <Text style={styles.title}>{t("expiryReminder.title", { title, date })}</Text>
      <Text style={styles.text}>{t("expiryReminder.intro", { days, graceDays })}</Text>
      <Text style={styles.text}>{t("expiryReminder.download")}</Text>
      <Text style={styles.text}>{t("expiryReminder.extend", { months, price })}</Text>
      <Cta href={dashboardUrl}>{t("expiryReminder.cta")}</Cta>
    </Layout>
  );
}

export function RecapEmail({
  t,
  title,
  count,
  dashboardUrl,
}: {
  t: Translate;
  title: string;
  count: number;
  dashboardUrl: string;
}) {
  return (
    <Layout t={t} preview={t("recap.preview")} footer="footerOrganiser">
      <Text style={styles.title}>{t("recap.title", { title })}</Text>
      <Text style={styles.text}>{t("recap.count", { count })}</Text>
      <Text style={styles.text}>{t("recap.next")}</Text>
      <Cta href={dashboardUrl}>{t("recap.cta")}</Cta>
    </Layout>
  );
}

export function AlbumReadyEmail({
  t,
  title,
  albumUrl,
}: {
  t: Translate;
  title: string;
  albumUrl: string;
}) {
  return (
    <Layout t={t} preview={t("albumReady.preview")} footer="footerGuest">
      <Text style={styles.title}>{t("albumReady.title", { title })}</Text>
      <Text style={styles.text}>{t("albumReady.intro")}</Text>
      <Cta href={albumUrl}>{t("albumReady.cta")}</Cta>
    </Layout>
  );
}

export function DeletionEmail({
  t,
  title,
  date,
  cancelUrl,
}: {
  t: Translate;
  title: string;
  date: string;
  cancelUrl: string;
}) {
  return (
    <Layout t={t} preview={t("deletion.preview")} footer="footerOrganiser">
      <Text style={styles.title}>{t("deletion.title", { title })}</Text>
      <Text style={styles.text}>{t("deletion.intro", { date })}</Text>
      <Text style={styles.text}>{t("deletion.cancel")}</Text>
      <Cta href={cancelUrl}>{t("deletion.cta")}</Cta>
    </Layout>
  );
}

/** The confirmation of an account deletion the organiser asked for (F-004). */
export function AccountDeletionEmail({
  t,
  date,
  cancelUrl,
}: {
  t: Translate;
  date: string;
  cancelUrl: string;
}) {
  return (
    <Layout t={t} preview={t("accountDeletion.preview")} footer="footerOrganiser">
      <Text style={styles.title}>{t("accountDeletion.title")}</Text>
      <Text style={styles.text}>{t("accountDeletion.intro", { date, appName: APP_NAME })}</Text>
      <Text style={styles.text}>{t("accountDeletion.cancel")}</Text>
      <Cta href={cancelUrl}>{t("accountDeletion.cta")}</Cta>
    </Layout>
  );
}

/** SPEC 9.3: the stored volume went over the alert threshold. For the administrators. */
export function StorageAlertEmail({
  t,
  used,
  threshold,
  adminUrl,
}: {
  t: Translate;
  used: string;
  threshold: string;
  adminUrl: string;
}) {
  return (
    <Layout t={t} preview={t("storageAlert.preview")} footer="footerOrganiser">
      <Text style={styles.title}>{t("storageAlert.title")}</Text>
      <Text style={styles.text}>{t("storageAlert.intro", { used, threshold })}</Text>
      <Cta href={adminUrl}>{t("storageAlert.cta")}</Cta>
    </Layout>
  );
}

/** Step 6.2: new feedback was left since the last digest. For the administrators. */
export function FeedbackDigestEmail({
  t,
  count,
  average,
  adminUrl,
}: {
  t: Translate;
  count: number;
  average: string;
  adminUrl: string;
}) {
  return (
    <Layout t={t} preview={t("feedbackDigest.preview")} footer="footerOrganiser">
      <Text style={styles.title}>{t("feedbackDigest.title")}</Text>
      <Text style={styles.text}>{t("feedbackDigest.intro", { count, average })}</Text>
      <Cta href={adminUrl}>{t("feedbackDigest.cta")}</Cta>
    </Layout>
  );
}

/** Ready for the co-organisers of F-005; nothing sends it until that feature exists. */
export function CohostInvitationEmail({
  t,
  title,
  inviter,
  acceptUrl,
}: {
  t: Translate;
  title: string;
  inviter: string;
  acceptUrl: string;
}) {
  return (
    <Layout t={t} preview={t("cohost.preview")} footer="footerOrganiser">
      <Text style={styles.title}>{t("cohost.title", { title, inviter })}</Text>
      <Text style={styles.text}>{t("cohost.intro", { inviter })}</Text>
      <Cta href={acceptUrl}>{t("cohost.cta")}</Cta>
    </Layout>
  );
}
