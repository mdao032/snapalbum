import { formatBetaCode } from "@snapalbum/shared";
import { messages } from "@snapalbum/shared/messages";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { AdminNav } from "@/components/admin/admin-nav";
import { Cell, DataTable } from "@/components/admin/data-table";
import { Pager } from "@/components/admin/pager";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { formatInstantDate } from "@/lib/events";
import { requireAdmin } from "@/server/auth";
import { isBetaMode, listBetaInvitations } from "@/server/beta";
import { createSupabaseAdminClient } from "@/server/supabase/admin";
import { createBetaInvitationAction, revokeBetaInvitationAction } from "../actions";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/beta">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: "admin.beta",
  });
  return { title: t("title") };
}

const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : "");
const FAILURES = ["already_invited", "invalid_email", "beta_off", "failed"] as const;

/** Field beta (step 6.1): invitation codes made for organisers, and what became of each. */
export default async function AdminBetaPage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/beta">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  await requireAdmin(locale);

  const query = await searchParams;
  const page = Math.max(1, Number.parseInt(one(query.page), 10) || 1);
  const failure = FAILURES.find((reason) => reason === one(query.failed));
  const t = await getTranslations("admin.beta");
  const betaOn = isBetaMode();
  const result = await listBetaInvitations(createSupabaseAdminClient(), page);
  const columns = messages[locale].admin.beta.columns;

  return (
    <div className="flex flex-col gap-6">
      <AdminNav current="/admin/beta" />
      <h2 className="text-xl font-semibold">{t("title")}</h2>
      {betaOn ? null : <Alert tone="error">{t("off")}</Alert>}
      {one(query.done) ? <Alert tone="success">{t("done")}</Alert> : null}
      {failure ? <Alert tone="error">{t(`failures.${failure}`)}</Alert> : null}

      {betaOn ? (
        <Card className="flex flex-col gap-4">
          <form action={createBetaInvitationAction} className="flex flex-col gap-4">
            <input type="hidden" name="returnTo" value="/admin/beta" />
            <Field id="beta-email" label={t("emailLabel")} hint={t("emailHint")}>
              {(aria) => (
                <Input
                  id="beta-email"
                  name="email"
                  type="email"
                  required
                  autoComplete="off"
                  maxLength={254}
                  {...aria}
                />
              )}
            </Field>
            <Button type="submit" size="lg" className="self-start" data-testid="beta-create">
              {t("create")}
            </Button>
          </form>
        </Card>
      ) : null}

      <p className="text-muted-foreground" data-testid="admin-count">
        {t("count", { count: result.total })}
      </p>
      {result.rows.length === 0 ? (
        <p>{t("empty")}</p>
      ) : (
        <DataTable caption={t("title")} columns={[...Object.values(columns), ""]}>
          {result.rows.map((row) => (
            <tr key={row.id} data-testid="beta-row" data-state={row.state}>
              <Cell>{formatInstantDate(row.created_at, locale)}</Cell>
              <Cell>{row.email}</Cell>
              <Cell className="font-mono tracking-wider">
                {row.state === "open" ? (
                  <span data-testid="beta-code">{formatBetaCode(row.code)}</span>
                ) : (
                  "-"
                )}
              </Cell>
              <Cell>{t(`states.${row.state}`)}</Cell>
              <Cell>
                {row.event_id ? (
                  <Link
                    href={`/admin/events/${row.event_id}`}
                    className="text-primary hover:underline"
                  >
                    {row.event_title || "-"}
                  </Link>
                ) : (
                  (row.event_title ?? "-")
                )}
              </Cell>
              <Cell>
                {row.state === "open" ? (
                  <form action={revokeBetaInvitationAction}>
                    <input type="hidden" name="returnTo" value="/admin/beta" />
                    <input type="hidden" name="invitationId" value={row.id} />
                    <Button type="submit" variant="secondary" data-testid="beta-revoke">
                      {t("revoke")}
                    </Button>
                  </form>
                ) : null}
              </Cell>
            </tr>
          ))}
        </DataTable>
      )}
      <Pager path="/admin/beta" page={page} total={result.total} />
    </div>
  );
}
