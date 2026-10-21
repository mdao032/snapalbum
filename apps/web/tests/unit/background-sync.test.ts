import { afterEach, describe, expect, it, vi } from "vitest";
import { startBackgroundSync, SYNC_TAG } from "@/lib/upload/background-sync";

afterEach(() => {
  vi.unstubAllGlobals();
});

function fakeBrowser(options: { sync: boolean; register?: () => Promise<unknown> }) {
  const listeners: ((event: { data: unknown }) => void)[] = [];
  const syncRegister = vi.fn(async () => undefined);
  const ready = Promise.resolve({ sync: options.sync ? { register: syncRegister } : undefined });
  vi.stubGlobal("navigator", {
    serviceWorker: {
      register: vi.fn(options.register ?? (async () => ({}))),
      ready,
      addEventListener: (_type: string, listener: (event: { data: unknown }) => void) =>
        listeners.push(listener),
    },
  });
  vi.stubGlobal("window", options.sync ? { SyncManager: class {} } : {});
  return { listeners, syncRegister };
}

describe("SPEC 8.3: Background Sync là où il existe, jamais promis ailleurs", () => {
  it("SPEC 8.3: sans service worker (ou sans SyncManager, comme iOS), rien n'est enregistré ni promis", () => {
    vi.stubGlobal("navigator", {});
    expect(startBackgroundSync(() => undefined).supported).toBe(false);
    fakeBrowser({ sync: false });
    const none = startBackgroundSync(() => undefined);
    expect(none.supported).toBe(false);
    expect(() => none.request()).not.toThrow();
  });

  it("SPEC 8.3: avec Background Sync, le réveil du navigateur relance les envois de la page", () => {
    const { listeners } = fakeBrowser({ sync: true });
    const wake = vi.fn();
    expect(startBackgroundSync(wake).supported).toBe(true);
    listeners.forEach((listener) => listener({ data: { type: "snapalbum:retry" } }));
    listeners.forEach((listener) => listener({ data: { type: "autre" } }));
    listeners.forEach((listener) => listener({ data: null }));
    expect(wake).toHaveBeenCalledTimes(1);
  });

  it("SPEC 8.3: demande une synchronisation sous l'étiquette prévue", async () => {
    const { syncRegister } = fakeBrowser({ sync: true });
    startBackgroundSync(() => undefined).request();
    await vi.waitFor(() => expect(syncRegister).toHaveBeenCalledWith(SYNC_TAG));
  });

  it("SPEC 8.3: un enregistrement refusé (navigation privée) laisse les autres reprises faire leur travail", async () => {
    fakeBrowser({
      sync: true,
      register: async () => {
        throw new Error("blocked");
      },
    });
    const sync = startBackgroundSync(() => undefined);
    expect(() => sync.request()).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
});
