import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const SECTIONS = [
  { href: "/admin", key: "overview" },
  { href: "/admin/events", key: "events" },
  { href: "/admin/organisers", key: "organisers" },
  { href: "/admin/payments", key: "payments" },
  { href: "/admin/reports", key: "reports" },
  { href: "/admin/feedback", key: "feedback" },
  { href: "/admin/beta", key: "beta" },
] as const;

/** The sections of the administrator area (F-090). `current` is the href of the open one. */
export async function AdminNav({ current }: { current: string }) {
  const t = await getTranslations("admin.nav");

  return (
    <nav aria-label={t("label")} className="flex flex-wrap gap-2">
      {SECTIONS.map((section) => (
        <Link
          key={section.href}
          href={section.href}
          aria-current={current === section.href ? "page" : undefined}
          className={cn(
            "inline-flex min-h-11 items-center rounded-full px-5 font-medium ring-1 ring-border",
            current === section.href
              ? "bg-primary text-primary-foreground ring-primary"
              : "bg-surface hover:bg-muted",
          )}
        >
          {t(section.key)}
        </Link>
      ))}
    </nav>
  );
}
