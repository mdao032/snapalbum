import { ADMIN_PAGE_SIZE } from "@snapalbum/shared";
import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/** Previous and next page of a list, keeping the search; nothing when there is one page. */
export async function Pager({
  path,
  page,
  total,
  query,
}: {
  path: string;
  page: number;
  total: number;
  query?: string;
}) {
  const t = await getTranslations("admin.pagination");
  const pages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  if (pages <= 1) return null;
  const href = (target: number) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (target > 1) params.set("page", String(target));
    const text = params.toString();
    return text ? `${path}?${text}` : path;
  };

  return (
    <nav aria-label={t("label")} className="flex flex-wrap items-center justify-between gap-3">
      {page > 1 ? (
        <Link href={href(page - 1)} className={cn(buttonVariants({ variant: "secondary" }))}>
          {t("previous")}
        </Link>
      ) : (
        <span />
      )}
      <span className="text-muted-foreground">{t("page", { page, pages })}</span>
      {page < pages ? (
        <Link href={href(page + 1)} className={cn(buttonVariants({ variant: "secondary" }))}>
          {t("next")}
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
