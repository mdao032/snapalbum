import { getTranslations } from "next-intl/server";
import { Button, buttonVariants } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/** A search by GET: the address keeps the search, so a page of results can be shared and reloaded. */
export async function SearchForm({ path, query }: { path: string; query: string }) {
  const t = await getTranslations("admin.search");

  return (
    <form action={path} method="get" role="search" className="flex flex-wrap items-center gap-3">
      <label htmlFor="admin-search" className="sr-only">
        {t("label")}
      </label>
      <input
        id="admin-search"
        name="q"
        type="search"
        defaultValue={query}
        maxLength={100}
        placeholder={t("placeholder")}
        className="min-h-12 w-full max-w-md rounded-xl bg-surface px-4 text-base ring-1 ring-border outline-none focus-visible:ring-4 focus-visible:ring-primary/30"
      />
      <Button type="submit">{t("submit")}</Button>
      {query ? (
        <Link href={path} className={cn(buttonVariants({ variant: "ghost" }))}>
          {t("reset")}
        </Link>
      ) : null}
    </form>
  );
}
