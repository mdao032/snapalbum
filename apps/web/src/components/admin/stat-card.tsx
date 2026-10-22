import { Card } from "@/components/ui/card";

/** One figure of the overview, with what it means and, optionally, a line under it. */
export function StatCard({
  label,
  value,
  hint,
  testId,
}: {
  label: string;
  value: string;
  hint?: string;
  testId?: string;
}) {
  return (
    <Card className="flex flex-col gap-1" data-testid={testId}>
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      <p className="text-3xl font-semibold tracking-tight">{value}</p>
      {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
    </Card>
  );
}
