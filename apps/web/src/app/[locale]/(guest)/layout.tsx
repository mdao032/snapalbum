import type { ReactNode } from "react";

/** Guest pages: no site header or footer, the event is the only thing on screen. */
export default function GuestLayout({ children }: { children: ReactNode }) {
  return (
    <main id="contenu" className="bg-aurora mx-auto flex min-h-dvh w-full max-w-xl flex-col">
      {children}
    </main>
  );
}
