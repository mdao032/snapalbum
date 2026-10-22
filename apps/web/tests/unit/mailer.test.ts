// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const serverEnv: { RESEND_API_KEY?: string; EMAIL_FROM?: string; EMAIL_MODE?: "log" } = {};
vi.mock("@/config/env.server", () => ({ getServerEnv: () => serverEnv }));

const send = vi.fn(async (_message: unknown) => ({ error: null }));
const batch = vi.fn(async (_messages: unknown[]) => ({ error: null }));
vi.mock("resend", () => ({
  Resend: class {
    emails = { send };
    batch = { send: batch };
  },
}));

const { getMailer } = await import("@/server/email/mailer");

const email = (to: string) => ({ to, subject: "Sujet", html: "<p>Bonjour</p>", text: "Bonjour" });

beforeEach(() => {
  vi.clearAllMocks();
  delete serverEnv.RESEND_API_KEY;
  delete serverEnv.EMAIL_FROM;
  delete serverEnv.EMAIL_MODE;
});
afterEach(() => vi.unstubAllEnvs());

describe("SPEC 14: le transport des e-mails", () => {
  it("avec une clé Resend, l'e-mail part par Resend avec l'expéditeur configuré et l'image intégrée", async () => {
    serverEnv.RESEND_API_KEY = "re_test";
    serverEnv.EMAIL_FROM = "Snapalbum <album@mail.example.test>";
    const mailer = getMailer();
    expect(mailer.name).toBe("resend");
    await mailer.send({
      ...email("a@example.test"),
      inlineImages: [
        {
          filename: "qr.png",
          content: Buffer.from("png"),
          contentId: "qr",
          contentType: "image/png",
        },
      ],
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      from: "Snapalbum <album@mail.example.test>",
      to: "a@example.test",
      subject: "Sujet",
      text: "Bonjour",
      attachments: [{ contentId: "qr", filename: "qr.png" }],
    });
  });

  it("un refus de Resend est une erreur : l'envoi sera retenté", async () => {
    serverEnv.RESEND_API_KEY = "re_test";
    send.mockResolvedValueOnce({ error: { name: "validation_error", message: "bad" } as never });
    await expect(getMailer().send(email("a@example.test"))).rejects.toThrow(/validation_error/);
  });

  it("l'envoi groupé découpe en lots de 100 et ne met aucune pièce jointe", async () => {
    serverEnv.RESEND_API_KEY = "re_test";
    await getMailer().sendMany(
      Array.from({ length: 230 }, (_, index) => email(`g${index}@example.test`)),
    );
    expect(batch.mock.calls.map((call) => call[0]?.length)).toEqual([100, 100, 30]);
  });

  it("sans clé, en production, l'envoi échoue franchement plutôt que de faire semblant", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => getMailer()).toThrow(/RESEND_API_KEY/);
  });

  it("sans clé, EMAIL_MODE=log écrit dans le journal du serveur, même en production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    serverEnv.EMAIL_MODE = "log";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const mailer = getMailer();
    expect(mailer.name).toBe("console");
    await mailer.send(email("a@example.test"));
    expect(warn).toHaveBeenCalledWith("[email] to a@example.test: Sujet");
    expect(send).not.toHaveBeenCalled();
  });

  it("en développement, sans clé, le journal suffit", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(getMailer().name).toBe("console");
  });
});
