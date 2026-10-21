import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { File as NodeFile } from "node:buffer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createIdbStore, requestPersistentStorage } from "@/lib/upload/idb-store";
import { pendingFlagKey, readPendingFlag, writePendingFlag } from "@/lib/upload/pending-flag";

const photo = (name: string) =>
  new NodeFile(["pixels"], name, { type: "image/jpeg" }) as unknown as File;

describe("NF-010: copie des fichiers dans IndexedDB", () => {
  beforeEach(() => {
    // A new, empty database for each test (the previous one may still be open).
    globalThis.indexedDB = new IDBFactory();
  });

  it("NF-010: un fichier copié se retrouve intact au retour, dans l'ordre d'ajout", async () => {
    const store = createIdbStore("k7m2x9qvbr");
    await store.put("a", photo("IMG_1.jpg"));
    await store.put("b", photo("IMG_2.jpg"));
    const left = await createIdbStore("k7m2x9qvbr").list();
    expect(left.map((entry) => [entry.id, entry.file.name])).toEqual([
      ["a", "IMG_1.jpg"],
      ["b", "IMG_2.jpg"],
    ]);
    expect(await left[0]?.file.text()).toBe("pixels");
  });

  it("NF-010: un fichier retiré après confirmation ne revient pas", async () => {
    const store = createIdbStore("k7m2x9qvbr");
    await store.put("a", photo("IMG_1.jpg"));
    await store.remove("a");
    expect(await store.list()).toEqual([]);
    // Retirer ce qui n'existe plus n'est pas une erreur.
    await expect(store.remove("a")).resolves.toBeUndefined();
  });

  it("NF-010: chaque événement a ses fichiers : un autre album ne reprend pas les photos de celui-ci", async () => {
    await createIdbStore("event-one").put("a", photo("one.jpg"));
    await createIdbStore("event-two").put("b", photo("two.jpg"));
    expect((await createIdbStore("event-one").list()).map((entry) => entry.id)).toEqual(["a"]);
    expect((await createIdbStore("event-two").list()).map((entry) => entry.id)).toEqual(["b"]);
  });

  it("NF-010: renvoyer le même identifiant remplace la copie au lieu de la doubler", async () => {
    const store = createIdbStore("k7m2x9qvbr");
    await store.put("a", photo("first.jpg"));
    await store.put("a", photo("second.jpg"));
    expect((await store.list()).map((entry) => entry.file.name)).toEqual(["second.jpg"]);
  });
});

describe("SPEC 8.3: stockage persistant", () => {
  it("SPEC 8.3: demande au navigateur de ne pas effacer les fichiers, sans jamais échouer", async () => {
    const persist = vi.fn(async () => true);
    vi.stubGlobal("navigator", { ...navigator, storage: { persist } });
    expect(await requestPersistentStorage()).toBe(true);
    expect(persist).toHaveBeenCalled();

    vi.stubGlobal("navigator", {
      ...navigator,
      storage: {
        persist: async () => {
          throw new Error("denied");
        },
      },
    });
    expect(await requestPersistentStorage()).toBe(false);

    vi.stubGlobal("navigator", { ...navigator, storage: undefined });
    expect(await requestPersistentStorage()).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe("NF-010: indicateur d'envois en attente", () => {
  it("NF-010: s'écrit, se lit et s'efface, par événement", () => {
    writePendingFlag("a", true);
    expect(readPendingFlag("a")).toBe(true);
    expect(readPendingFlag("b")).toBe(false);
    expect(localStorage.getItem(pendingFlagKey("a"))).toBe("1");
    writePendingFlag("a", false);
    expect(readPendingFlag("a")).toBe(false);
  });

  it("NF-010: un stockage bloqué ne fait jamais échouer la page", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readPendingFlag("a")).toBe(false);
    expect(() => writePendingFlag("a", true)).not.toThrow();
    spy.mockRestore();
    set.mockRestore();
  });
});
