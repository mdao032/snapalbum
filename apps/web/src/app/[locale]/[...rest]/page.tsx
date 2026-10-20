import { notFound } from "next/navigation";

// Unknown URLs inside a locale render the localized 404 page.
export default function CatchAllPage() {
  notFound();
}
