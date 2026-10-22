import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import { Testimonials } from "@/components/marketing/testimonials";
import { TESTIMONIALS } from "@/content/testimonials";
import { messages } from "@snapalbum/shared/messages";

const withProvider = (entries: Parameters<typeof Testimonials>[0]["entries"]) =>
  render(
    <NextIntlClientProvider locale="fr" messages={messages.fr}>
      <Testimonials entries={entries} />
    </NextIntlClientProvider>,
  );

describe("étape 5.1: témoignages uniquement réels", () => {
  it("aucun témoignage n'est publié tant qu'il n'y en a pas de réel", () => {
    expect(TESTIMONIALS).toEqual([]);
  });

  it("sans témoignage, la section n'existe pas dans la page", () => {
    const { container } = withProvider([]);
    expect(container).toBeEmptyDOMElement();
  });

  it("avec un témoignage réel, la section apparaît avec la phrase dans la langue de la page", () => {
    withProvider([
      {
        quote: { fr: "Tout est arrivé au même endroit.", en: "All in one place." },
        author: "Marie",
      },
    ]);
    expect(screen.getByRole("heading", { level: 2, name: /Ils ont utilisé/ })).toBeInTheDocument();
    expect(screen.getByText("Tout est arrivé au même endroit.")).toBeInTheDocument();
    expect(screen.getByText("Marie")).toBeInTheDocument();
  });
});
