// @vitest-environment node
import { APP_NAME } from "@snapalbum/shared/brand";
import { messages } from "@snapalbum/shared/messages";
import { describe, expect, it } from "vitest";
import {
  composeAlbumReady,
  composeCohostInvitation,
  composeDeletion,
  composeExpiryReminder,
  composePaymentConfirmed,
  composeQuotaReached,
  composeRecap,
  composeWelcome,
  emailTranslator,
} from "@/server/email/compose";

/**
 * SPEC 14: every template renders in French and in English, with its subject, its link, a plain
 * text twin, and no sentence left behind in the code.
 */

const TITLE = "Mariage de Léa et Tom";
const LINK = "https://snapalbum.test/events/abc";

const renders = {
  welcome: (locale: "fr" | "en") =>
    composeWelcome({
      locale,
      title: TITLE,
      dashboardUrl: LINK,
      link: "https://snapalbum.test/k7m2x9qvbr",
      qrContentId: "event-qr",
    }),
  quotaFree: (locale: "fr" | "en") =>
    composeQuotaReached({
      locale,
      title: TITLE,
      max: "200",
      offer: { price: "49 €", newMax: "10 000" },
      dashboardUrl: LINK,
    }),
  quotaPaid: (locale: "fr" | "en") =>
    composeQuotaReached({
      locale,
      title: TITLE,
      max: "10 000",
      offer: null,
      dashboardUrl: LINK,
    }),
  payment: (locale: "fr" | "en") =>
    composePaymentConfirmed({
      locale,
      title: TITLE,
      product: "Event",
      amount: "49 €",
      keptUntil: "20 June 2027",
      dashboardUrl: LINK,
    }),
  reminder: (locale: "fr" | "en") =>
    composeExpiryReminder({
      locale,
      title: TITLE,
      date: "20 juin 2031",
      days: 7,
      graceDays: 7,
      months: 12,
      price: "19 €",
      dashboardUrl: LINK,
    }),
  recap: (locale: "fr" | "en") =>
    composeRecap({ locale, title: TITLE, count: 42, dashboardUrl: LINK }),
  albumReady: (locale: "fr" | "en") => composeAlbumReady({ locale, title: TITLE, albumUrl: LINK }),
  deletion: (locale: "fr" | "en") =>
    composeDeletion({ locale, title: TITLE, date: "20 juin 2031", cancelUrl: LINK }),
  cohost: (locale: "fr" | "en") =>
    composeCohostInvitation({ locale, title: TITLE, inviter: "Léa", acceptUrl: LINK }),
};

describe("SPEC 14, section 12: les modèles d'e-mail, en français et en anglais", () => {
  for (const [name, render] of Object.entries(renders)) {
    for (const locale of ["fr", "en"] as const) {
      it(`${name} (${locale}) : sujet, lien, texte brut, aucune variable laissée`, async () => {
        const email = await render(locale);
        expect(email.subject.length).toBeGreaterThan(5);
        expect(email.subject).not.toMatch(/[{}]/);
        expect(email.html).toContain(`href="${LINK}"`);
        expect(email.html).toContain(APP_NAME);
        expect(email.html).not.toMatch(/\{[a-zA-Z]+\}/);
        // The plain-text twin has the content and none of the markup.
        expect(email.text.length).toBeGreaterThan(40);
        expect(email.text).not.toMatch(/<[a-z][^>]*>/i);
        expect(email.text).not.toMatch(/\{[a-zA-Z]+\}/);
      });
    }
  }

  it("le français et l'anglais ne se mélangent pas", async () => {
    const fr = await renders.reminder("fr");
    const en = await renders.reminder("en");
    expect(fr.subject).toContain("ferme le");
    expect(en.subject).toContain("closes on");
    expect(fr.text).toContain("Téléchargez");
    expect(en.text).toContain("Download");
  });

  it("le titre de l'événement est dans le sujet et dans le corps, sans être échappé de travers", async () => {
    const email = await renders.albumReady("fr");
    expect(email.subject).toContain(TITLE);
    expect(email.text).toContain(TITLE);
  });

  it("le QR code de bienvenue est une image intégrée, avec un texte alternatif", async () => {
    const email = await renders.welcome("fr");
    expect(email.html).toContain('src="cid:event-qr"');
    expect(email.html).toMatch(/alt="QR code de l.album/);
  });

  it("le rappel dit combien de jours restent, au pluriel comme au singulier", async () => {
    const soon = await composeExpiryReminder({
      locale: "fr",
      title: TITLE,
      date: "13 octobre 2026",
      days: 1,
      graceDays: 7,
      months: 12,
      price: "19 €",
      dashboardUrl: LINK,
    });
    expect(soon.text).toContain("Plus qu’un jour");
    const week = await renders.reminder("fr");
    expect(week.text).toContain("Il reste 7 jours");
  });

  it("le récapitulatif accorde le sujet : aucune photo, une photo, plusieurs", async () => {
    const subject = async (count: number) =>
      (await composeRecap({ locale: "fr", title: TITLE, count, dashboardUrl: LINK })).subject;
    expect(await subject(0)).toContain("aucune photo");
    expect(await subject(1)).toContain("1 photo ou vidéo envoyée");
    expect(await subject(12)).toContain("12 photos et vidéos envoyées");
  });

  it("l'e-mail aux invités explique l'origine de l'adresse et sa durée de vie (RGPD)", async () => {
    const email = await renders.albumReady("fr");
    expect(email.text).toContain("effacée");
    expect(email.text).toContain("vous avez demandé");
  });

  it("chaque clé des modèles existe dans les deux langues", () => {
    const keys = (locale: "fr" | "en") => Object.keys(messages[locale].emails).sort();
    expect(keys("en")).toEqual(keys("fr"));
    expect(emailTranslator("fr")("greeting")).toBe("Bonjour,");
  });
});
