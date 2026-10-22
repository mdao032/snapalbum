/**
 * `30` as "30 s" and `180` as "3 min" in the viewer's language: video limits are stored in seconds
 * (`plans.ts`) and read in whole minutes when they are one.
 */
export function formatDuration(seconds: number, locale: string): string {
  const wholeMinutes = seconds >= 60 && seconds % 60 === 0;
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: wholeMinutes ? "minute" : "second",
    unitDisplay: "short",
  }).format(wholeMinutes ? seconds / 60 : seconds);
}
