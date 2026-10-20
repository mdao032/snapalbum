import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

describe("NF-031: bouton", () => {
  it("NF-031: garantit une zone tactile d'au moins 44 px", () => {
    render(<Button>Envoyer</Button>);
    expect(screen.getByRole("button", { name: "Envoyer" }).className).toContain("min-h-11");
  });

  it("déclenche l'action au clic", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Envoyer</Button>);
    await userEvent.click(screen.getByRole("button", { name: "Envoyer" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("ne réagit pas quand il est désactivé", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Envoyer
      </Button>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Envoyer" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("peut rendre un lien avec asChild", () => {
    render(
      <Button asChild>
        <a href="https://example.test/accueil">Accueil</a>
      </Button>,
    );
    expect(screen.getByRole("link", { name: "Accueil" })).toHaveAttribute(
      "href",
      "https://example.test/accueil",
    );
  });
});

describe("cn", () => {
  it("fusionne les classes Tailwind en conflit", () => {
    const isHidden = Boolean(0);
    expect(cn("px-2", "px-4", isHidden && "hidden")).toBe("px-4");
  });
});
