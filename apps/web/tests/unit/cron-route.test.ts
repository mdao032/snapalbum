// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "cron-secret-with-enough-length-1234";
const serverEnv: { CRON_SECRET?: string } = { CRON_SECRET: SECRET };
vi.mock("@/config/env.server", () => ({ getServerEnv: () => serverEnv }));

const expireEvents = vi.fn(async () => ({ expired: ["e1", "e2"] }));
const purgeDueEvents = vi.fn(async () => ({ purged: ["e0"], failed: [] }));
const purgeDueAccounts = vi.fn(async () => ({ purged: ["u1"], failed: [] }));
const cleanupUploads = vi.fn(async () => ({ mediaRemoved: 3, multipartAborted: 1 }));
vi.mock("@/server/lifecycle", () => ({
  expireEvents,
  purgeDueEvents,
  purgeDueAccounts,
  cleanupUploads,
}));

const sendExpiryReminders = vi.fn(async () => ({ considered: 4, sent: 2, failed: 0 }));
const runDailyRecap = vi.fn(async () => ({
  recaps: { considered: 1, sent: 1, failed: 0 },
  albumReady: { events: 1, sent: 5, failed: 0 },
}));
vi.mock("@/server/notifications", () => ({ sendExpiryReminders, runDailyRecap }));

const checkStorageAlert = vi.fn(async () => "skipped");
vi.mock("@/server/admin", () => ({ checkStorageAlert }));

vi.mock("@/server/email/mailer", () => ({ getMailer: () => ({ mailer: true }) }));
vi.mock("@/server/storage", () => ({ getStorage: () => ({ storage: true }) }));
vi.mock("@/server/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ admin: true }) }));

const { GET } = await import("@/app/api/cron/[task]/route");

const call = (task: string, authorization?: string) =>
  GET(
    new Request(`https://app.example.test/api/cron/${task}`, {
      headers: authorization ? { authorization } : {},
    }),
    { params: Promise.resolve({ task }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  serverEnv.CRON_SECRET = SECRET;
});

describe("S-001: les tâches planifiées exigent le secret", () => {
  it("sans en-tête, avec un mauvais secret ou un secret tronqué : 401 et rien ne tourne", async () => {
    for (const header of [undefined, "Bearer nope", `Bearer ${SECRET.slice(0, -1)}`, SECRET]) {
      const response = await call("expire-events", header);
      expect(response.status).toBe(401);
    }
    expect(expireEvents).not.toHaveBeenCalled();
    expect(purgeDueEvents).not.toHaveBeenCalled();
  });

  it("sans secret configuré, personne n'entre, même avec un en-tête vide ou deviné", async () => {
    serverEnv.CRON_SECRET = undefined;
    expect((await call("daily-recap", "Bearer ")).status).toBe(401);
    expect((await call("daily-recap", "Bearer undefined")).status).toBe(401);
    expect(runDailyRecap).not.toHaveBeenCalled();
  });

  it("une tâche inconnue est introuvable, mais seulement pour qui a le secret", async () => {
    expect((await call("delete-everything", `Bearer ${SECRET}`)).status).toBe(404);
    expect((await call("delete-everything")).status).toBe(401);
  });
});

describe("SPEC 9.2, 14: chaque tâche appelle son travail", () => {
  const auth = `Bearer ${SECRET}`;

  it("expire-events ferme les albums échus puis purge ceux qui attendent", async () => {
    const response = await call("expire-events", auth);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      task: "expire-events",
      expired: 2,
      purged: ["e0"],
      failed: [],
      accounts: { purged: ["u1"], failed: [] },
    });
    expect(expireEvents.mock.invocationCallOrder[0]).toBeLessThan(
      purgeDueEvents.mock.invocationCallOrder[0]!,
    );
    // F-004: the accounts whose deletion was asked 7 days ago go after the events.
    expect(purgeDueEvents.mock.invocationCallOrder[0]).toBeLessThan(
      purgeDueAccounts.mock.invocationCallOrder[0]!,
    );
  });

  it("cleanup-uploads, reminders et daily-recap", async () => {
    expect(await (await call("cleanup-uploads", auth)).json()).toMatchObject({ mediaRemoved: 3 });
    expect(await (await call("reminders", auth)).json()).toMatchObject({ sent: 2 });
    expect(await (await call("daily-recap", auth)).json()).toMatchObject({
      albumReady: { sent: 5 },
      storageAlert: "skipped",
    });
    // SPEC 9.3: no threshold configured, no alert is asked for.
    expect(checkStorageAlert).toHaveBeenCalledWith(
      expect.objectContaining({ thresholdBytes: null }),
    );
    expect(cleanupUploads).toHaveBeenCalledTimes(1);
    expect(sendExpiryReminders).toHaveBeenCalledTimes(1);
    expect(runDailyRecap).toHaveBeenCalledTimes(1);
  });

  it("une panne est une erreur 500 (la tâche sera rejouée), jamais un succès", async () => {
    purgeDueEvents.mockRejectedValueOnce(new Error("storage down"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await call("expire-events", auth)).status).toBe(500);
  });
});
