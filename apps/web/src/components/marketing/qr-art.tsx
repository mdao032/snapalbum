import { cn } from "@/lib/utils";

// A decorative 9x9 pattern that evokes a QR code without being scannable.
const QR_ROWS = [
  "111111101",
  "100000101",
  "101110100",
  "101110111",
  "101110100",
  "100000101",
  "111111100",
  "000000001",
  "101101011",
];

/** A decorative pattern that evokes a QR code without being scannable. */
export function QrArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 9 9" className={cn(className)} shapeRendering="crispEdges" aria-hidden>
      {QR_ROWS.flatMap((row, y) =>
        [...row].map((cell, x) =>
          cell === "1" ? (
            <rect
              key={`${x}-${y}`}
              x={x}
              y={y}
              width="1"
              height="1"
              rx="0.15"
              fill="currentColor"
            />
          ) : null,
        ),
      )}
    </svg>
  );
}
