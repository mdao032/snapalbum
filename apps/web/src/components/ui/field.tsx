import type { ReactNode } from "react";

/**
 * A form field: visible label, optional hint and error, wired for screen readers.
 * `children` receives the ids to put on the control (`aria-describedby`, `aria-invalid`).
 */
export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: (props: { "aria-describedby"?: string; "aria-invalid": boolean }) => ReactNode;
}) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      {children({
        "aria-describedby": describedBy || undefined,
        "aria-invalid": Boolean(error),
      })}
      {hint ? (
        <p id={`${id}-hint`} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
