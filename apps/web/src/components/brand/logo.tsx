import { APP_NAME } from "@snapalbum/shared/brand";
import { cn } from "@/lib/utils";

/** The logo mark: a camera aperture inside a soft squircle. Purely decorative. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      aria-hidden
      className={cn("size-9 shrink-0", className)}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="logo-bg" x1="4" y1="2" x2="36" y2="38" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8466ff" />
          <stop offset="1" stopColor="#5a37e8" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="12" fill="url(#logo-bg)" />
      <circle cx="20" cy="20" r="8.5" stroke="white" strokeWidth="2.5" />
      <circle cx="20" cy="20" r="3" fill="white" />
      <circle cx="30" cy="10.5" r="2.2" fill="#ff7a59" />
    </svg>
  );
}

export function Logo({ className, nameClassName }: { className?: string; nameClassName?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className={cn("text-lg font-semibold tracking-tight", nameClassName)}>{APP_NAME}</span>
    </span>
  );
}
