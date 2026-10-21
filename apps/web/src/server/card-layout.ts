/** Text helpers for the printable cards, kept free of any PDF library so they are easy to test. */

/**
 * Replaces characters the PDF font cannot draw (emoji, scripts outside Latin-1 and the Windows
 * punctuation set) with `?`, so a creative event name never makes the PDF fail.
 */
export function sanitizeForFont(text: string, supported: ReadonlySet<number>): string {
  return Array.from(text.normalize("NFC").replace(/\s+/g, " ").trim(), (char) =>
    supported.has(char.codePointAt(0) ?? 0) ? char : "?",
  ).join("");
}

/**
 * Breaks `text` into lines no wider than `maxWidth` (as measured by `measure`). A word wider than
 * a line is cut where it overflows. Beyond `maxLines` the last line ends with an ellipsis.
 */
export function wrapText(
  text: string,
  maxWidth: number,
  maxLines: number,
  measure: (value: string) => number,
): string[] {
  const lines: string[] = [];
  let current = "";

  const push = (value: string) => {
    lines.push(value);
    current = "";
  };

  for (const word of text.split(" ").filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (measure(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) push(current);
    let rest = word;
    while (measure(rest) > maxWidth && rest.length > 1) {
      let cut = rest.length - 1;
      while (cut > 1 && measure(rest.slice(0, cut)) > maxWidth) cut -= 1;
      push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    current = rest;
  }
  if (current) push(current);

  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1] ?? "";
  while (last.length > 1 && measure(`${last}…`) > maxWidth) last = last.slice(0, -1);
  kept[maxLines - 1] = `${last.trimEnd()}…`;
  return kept;
}

/** Millimetres to PDF points (1/72 inch). */
export function mm(value: number): number {
  return (value * 72) / 25.4;
}
