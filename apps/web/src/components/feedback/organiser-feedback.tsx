import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui/card";
import { FeedbackForm } from "./feedback-form";

/** The organiser's invitation to give feedback, at the bottom of their event page (step 6.2). */
export async function OrganiserFeedback({ eventCode }: { eventCode: string }) {
  const t = await getTranslations("feedback");
  return (
    <Card className="flex flex-col gap-4 p-6 sm:p-8" data-testid="organiser-feedback">
      <div className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold">{t("organiser.title")}</h2>
        <p className="text-muted-foreground">{t("organiser.intro")}</p>
      </div>
      <FeedbackForm audience="organiser" eventCode={eventCode} />
    </Card>
  );
}
