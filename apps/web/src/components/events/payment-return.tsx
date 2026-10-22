"use client";

import { CircleCheck, Info } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import type { ConfirmResult } from "@/server/payments";

/** The confirmation is asked again this often, and this many times, while Stripe confirms. */
const POLL_MS = 3000;
const MAX_POLLS = 20;

type Phase = "confirming" | "done" | "late" | "failed";

/**
 * What the organiser sees when Stripe sends them back (SPEC 13). On success the session is
 * confirmed with the server (which asks Stripe), then the page's data is read again: the new
 * plan and quotas appear without reloading. A payment that takes longer (delayed methods) is
 * asked about again for a minute, then the page says so honestly.
 */
export function PaymentReturn({
  state,
  sessionId,
  onConfirm,
}: {
  state: "success" | "cancelled";
  sessionId: string | undefined;
  onConfirm: (sessionId: string) => Promise<ConfirmResult>;
}) {
  const t = useTranslations("dashboard.payment");
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(sessionId ? "confirming" : "late");
  // The action is bound again on every render of the page: the effect must not start over for it.
  const confirm = useRef(onConfirm);
  useEffect(() => {
    confirm.current = onConfirm;
  });

  useEffect(() => {
    // Once answered, the address no longer carries the payment: reloading does not start over.
    const finish = (next: Phase) => {
      setPhase(next);
      router.refresh();
      window.history.replaceState(null, "", window.location.pathname);
    };
    if (state !== "success" || !sessionId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async (attempt: number) => {
      const result = await confirm
        .current(sessionId)
        .catch((): ConfirmResult => ({ status: "error" }));
      if (cancelled) return;
      if (result.status === "applied") {
        finish("done");
      } else if (result.status === "error") {
        finish("failed");
      } else if (attempt >= MAX_POLLS) {
        finish("late");
      } else {
        timer = setTimeout(() => void check(attempt + 1), POLL_MS);
      }
    };
    void check(1);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [state, sessionId, router]);

  if (state === "cancelled") {
    return (
      <div
        role="status"
        data-testid="payment-return"
        data-state="cancelled"
        className="flex items-start gap-3 rounded-2xl bg-muted/70 px-4 py-3"
      >
        <Info className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        <p>{t("cancelled")}</p>
      </div>
    );
  }

  return (
    <div
      role="status"
      data-testid="payment-return"
      data-state={phase}
      className={`flex items-start gap-3 rounded-2xl px-4 py-3 ${
        phase === "done" || phase === "confirming" ? "bg-success-soft text-success" : "bg-muted/70"
      }`}
    >
      {phase === "confirming" ? (
        <Spinner className="mt-0.5 size-5 shrink-0 text-current" />
      ) : (
        <CircleCheck className="mt-0.5 size-5 shrink-0" aria-hidden />
      )}
      <p className="font-medium">{t(phase)}</p>
    </div>
  );
}
