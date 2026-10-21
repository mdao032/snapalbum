"use client";

import { Check, Copy, Link2, Trash2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export interface ShareLinkItem {
  id: string;
  url: string;
  createdAt: string;
  revokedAt: string | null;
}

type Outcome = { ok: true; links: ShareLinkItem[] } | { ok: false; error: "failed" | "too_many" };

/**
 * Read-only share links of the gallery (F-054): anyone holding one sees the approved photos
 * without an account. The organiser creates several (one per family, say) and stops any of them,
 * with a confirmation, since it cuts everyone who received that link off.
 */
export function ShareLinks({
  initialLinks,
  onCreate,
  onRevoke,
}: {
  initialLinks: ShareLinkItem[];
  onCreate: () => Promise<Outcome>;
  onRevoke: (linkId: string) => Promise<Outcome>;
}) {
  const t = useTranslations("dashboard.shareLinks");
  const format = useFormatter();
  const [links, setLinks] = useState(initialLinks);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const active = links.filter((link) => !link.revokedAt);

  function apply(outcome: Outcome, done?: string) {
    if (outcome.ok) {
      setLinks(outcome.links);
      setNotice(done ?? null);
    } else {
      setNotice(outcome.error === "too_many" ? t("tooMany") : t("failed"));
    }
  }

  function create() {
    setNotice(null);
    startTransition(async () => apply(await onCreate()));
  }

  function revoke(linkId: string) {
    setAsking(null);
    setNotice(null);
    startTransition(async () => apply(await onRevoke(linkId), t("revoked")));
  }

  async function copy(link: ShareLinkItem) {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(link.id);
      setNotice(null);
    } catch {
      setNotice(t("copyFailed"));
    }
  }

  return (
    <Card className="p-6 sm:p-8">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold">{t("title")}</h2>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>

        {active.length === 0 ? <p className="text-muted-foreground">{t("empty")}</p> : null}

        <ul className="flex flex-col gap-4">
          {active.map((link) => (
            <li key={link.id} className="flex flex-col gap-3 rounded-2xl bg-muted/60 p-4">
              <label className="flex flex-col gap-1 text-sm font-medium">
                {t("linkLabel")}
                <input
                  readOnly
                  value={link.url}
                  onFocus={(event) => event.currentTarget.select()}
                  className="min-h-12 w-full rounded-xl bg-surface px-4 text-base font-normal ring-1 ring-border outline-none focus-visible:ring-4 focus-visible:ring-primary/30"
                />
              </label>
              <p className="text-sm text-muted-foreground">
                {t("createdOn", {
                  date: format.dateTime(new Date(link.createdAt), { dateStyle: "medium" }),
                })}
              </p>
              {asking === link.id ? (
                <div role="group" aria-label={t("revokeAsk")} className="flex flex-col gap-3">
                  <p className="font-medium">{t("revokeAsk")}</p>
                  <div className="flex flex-wrap gap-3">
                    <Button variant="secondary" autoFocus onClick={() => setAsking(null)}>
                      {t("revokeNo")}
                    </Button>
                    <Button disabled={pending} onClick={() => revoke(link.id)}>
                      {t("revokeYes")}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-3">
                  <Button type="button" variant="secondary" onClick={() => void copy(link)}>
                    {copied === link.id ? <Check aria-hidden /> : <Copy aria-hidden />}
                    {copied === link.id ? t("copied") : t("copy")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => setAsking(link.id)}
                  >
                    <Trash2 aria-hidden />
                    {t("revoke")}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-2">
          <Button type="button" disabled={pending} onClick={create} className="self-start">
            <Link2 aria-hidden />
            {pending ? t("creating") : t("create")}
          </Button>
          <p role="status" className="min-h-5 text-sm text-muted-foreground">
            {notice}
          </p>
        </div>
      </div>
    </Card>
  );
}
