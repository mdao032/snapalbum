"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { CheckoutState } from "@/app/[locale]/(app)/events/[id]/payment/actions";

/**
 * A button that opens Stripe's payment page (R2, R4). The action is already bound to the event
 * and the product; if the server refuses (not the owner, already upgraded, payment not configured)
 * the reason is shown under the button.
 */
export function CheckoutButton({
  action,
  label,
  variant = "primary",
  testId,
}: {
  action: (previous: CheckoutState) => Promise<CheckoutState>;
  label: string;
  variant?: "primary" | "secondary";
  testId: string;
}) {
  const tApi = useTranslations("apiErrors");
  const t = useTranslations("dashboard.plan");
  const [state, formAction, pending] = useActionState(action, { status: "idle" });

  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      {/* The label with its price is long: on a narrow screen it wraps instead of leaving the card. */}
      <Button
        type="submit"
        size="lg"
        variant={variant}
        disabled={pending}
        data-testid={testId}
        className="max-w-full whitespace-normal py-2 text-center"
      >
        {pending ? <Spinner className="text-current" /> : null}
        {pending ? t("redirecting") : label}
      </Button>
      {state.status === "error" ? <Alert tone="error">{tApi(state.code)}</Alert> : null}
    </form>
  );
}
