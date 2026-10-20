import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";

// Shown while a marketing page streams in: same silhouette as the home hero.
export default function Loading() {
  const t = useTranslations("states");

  return (
    <div className="container-page grid gap-12 py-14 sm:py-20 lg:grid-cols-2">
      <p role="status" className="sr-only">
        {t("loadingLabel")}
      </p>
      <div className="flex flex-col items-center gap-5 lg:items-start">
        <Skeleton className="h-9 w-48 rounded-full" />
        <Skeleton className="h-16 w-full max-w-xl" />
        <Skeleton className="h-16 w-4/5 max-w-lg" />
        <Skeleton className="h-14 w-56 rounded-full" />
      </div>
      <Skeleton className="mx-auto h-96 w-full max-w-sm rounded-3xl" />
    </div>
  );
}
