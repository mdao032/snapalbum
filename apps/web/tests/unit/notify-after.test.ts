// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const after = vi.fn((task: () => Promise<void>) => task());
vi.mock("next/server", () => ({ after }));

const mailer = { name: "console" as const };
vi.mock("@/server/email/mailer", () => ({ getMailer: () => mailer }));

const notifyWelcome = vi.fn(async () => "sent");
const notifyQuotaReachedByCode = vi.fn(async () => "sent");
const notifyPaymentConfirmed = vi.fn(async () => "sent");
const notifyDeletionRequested = vi.fn(async () => "sent");
const sendAlbumReady = vi.fn(async () => 0);
vi.mock("@/server/notifications", () => ({
  notifyWelcome,
  notifyQuotaReachedByCode,
  notifyPaymentConfirmed,
  notifyDeletionRequested,
  sendAlbumReady,
}));

const {
  scheduleAlbumReady,
  scheduleDeletionNotice,
  schedulePaymentConfirmed,
  scheduleQuotaReached,
  scheduleWelcome,
} = await import("@/server/notify-after");

/** A database stand-in that only knows how many events an organiser has. */
const adminWith = (events: number | Error) =>
  ({
    from: () => ({
      select: () => ({
        eq: async () =>
          events instanceof Error ? { count: null, error: events } : { count: events, error: null },
      }),
    }),
  }) as never;

beforeEach(() => vi.clearAllMocks());

describe("SPEC 14: les e-mails partent après la réponse, sans jamais la faire échouer", () => {
  it("la bienvenue ne part qu'avec le premier événement de l'organisateur", async () => {
    scheduleWelcome(adminWith(1), "owner", "event-1");
    await vi.waitFor(() => expect(notifyWelcome).toHaveBeenCalledTimes(1));
    expect(notifyWelcome.mock.calls[0]).toEqual([{ admin: expect.anything(), mailer }, "event-1"]);

    notifyWelcome.mockClear();
    scheduleWelcome(adminWith(2), "owner", "event-2");
    await vi.waitFor(() => expect(after).toHaveBeenCalledTimes(2));
    expect(notifyWelcome).not.toHaveBeenCalled();
  });

  it("chaque geste appelle son e-mail", async () => {
    const admin = adminWith(1);
    scheduleQuotaReached(admin, "k7m2x9qvbr");
    schedulePaymentConfirmed(admin, "purchase-1");
    scheduleDeletionNotice(admin, "event-1");
    scheduleAlbumReady(admin, "event-1");
    await vi.waitFor(() => expect(sendAlbumReady).toHaveBeenCalledTimes(1));
    expect(notifyQuotaReachedByCode.mock.calls[0]?.[1]).toBe("k7m2x9qvbr");
    expect(notifyPaymentConfirmed.mock.calls[0]?.[1]).toBe("purchase-1");
    expect(notifyDeletionRequested.mock.calls[0]?.[1]).toBe("event-1");
  });

  it("une panne de messagerie est journalisée et n'est pas relancée vers l'utilisateur", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    notifyPaymentConfirmed.mockRejectedValueOnce(new Error("Resend is down"));
    schedulePaymentConfirmed(adminWith(1), "purchase-2");
    await vi.waitFor(() => expect(error).toHaveBeenCalled());
    expect(error.mock.calls[0]?.[0]).toContain("payment e-mail failed");
  });

  it("une erreur de base pendant la bienvenue est journalisée aussi", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    scheduleWelcome(adminWith(new Error("database down")), "owner", "event-3");
    await vi.waitFor(() => expect(error).toHaveBeenCalled());
    expect(notifyWelcome).not.toHaveBeenCalled();
  });
});
