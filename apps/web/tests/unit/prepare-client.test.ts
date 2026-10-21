import { PrepareError } from "@snapalbum/shared/upload";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PreparedImage } from "@/lib/upload/prepare-image";
import type { WorkerRequest, WorkerResponse } from "@/lib/upload/prepare-protocol";

const prepareImage = vi.fn();
const fingerprint = vi.fn();
vi.mock("@/lib/upload/prepare-image", () => ({ prepareImage }));
vi.mock("@/lib/upload/files", () => ({ fingerprint }));

const image: PreparedImage = {
  width: 64,
  height: 96,
  display: new Blob(["d"]),
  thumb: new Blob(["t"]),
  previewFormat: "webp",
  blurhash: "00L39k",
  sha256: "a".repeat(64),
};

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: { data: WorkerResponse }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  posted: WorkerRequest[] = [];
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(request: WorkerRequest) {
    this.posted.push(request);
  }

  terminate() {
    this.terminated = true;
  }

  reply(response: WorkerResponse) {
    this.onmessage?.({ data: response });
  }
}

const file = new File(["x"], "a.jpg", { type: "image/jpeg" });

/** A fresh copy of the module: the worker is created once per page, so each test starts over. */
async function load() {
  vi.resetModules();
  return import("@/lib/upload/prepare-client");
}

describe("SPEC 8.1: préparation dans un Web Worker, repli sur la page", () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    prepareImage.mockReset().mockResolvedValue(image);
    fingerprint.mockReset().mockResolvedValue("b".repeat(64));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function withWorkers() {
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("OffscreenCanvas", class {});
  }

  it("SPEC 8.1: sans Worker ni OffscreenCanvas, la page prépare elle-même", async () => {
    vi.stubGlobal("Worker", undefined);
    vi.stubGlobal("OffscreenCanvas", undefined);
    const { preparePhoto, hashFile } = await load();
    expect(await preparePhoto(file)).toBe(image);
    expect(await hashFile(file)).toBe("b".repeat(64));
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it("SPEC 8.1: avec un Worker, le travail lui est confié et sa réponse rendue", async () => {
    withWorkers();
    const { preparePhoto, hashFile } = await load();
    const photo = preparePhoto(file);
    const worker = FakeWorker.instances[0];
    expect(worker?.posted).toEqual([expect.objectContaining({ op: "photo", file })]);
    worker?.reply({ id: worker.posted[0]?.id ?? -1, ok: true, op: "photo", result: image });
    expect(await photo).toBe(image);

    const hash = hashFile(file);
    worker?.reply({ id: worker.posted[1]?.id ?? -1, ok: true, op: "hash", result: "c".repeat(64) });
    expect(await hash).toBe("c".repeat(64));
    // One worker for the whole page, and the page did none of the work.
    expect(FakeWorker.instances).toHaveLength(1);
    expect(prepareImage).not.toHaveBeenCalled();
  });

  it("SPEC 8.1: plusieurs fichiers en même temps reçoivent chacun leur réponse", async () => {
    withWorkers();
    const { preparePhoto } = await load();
    const first = preparePhoto(file);
    const second = preparePhoto(file);
    const worker = FakeWorker.instances[0];
    const [one, two] = worker?.posted ?? [];
    expect(one?.id).not.toBe(two?.id);
    // Answered in the opposite order.
    worker?.reply({
      id: two?.id ?? -1,
      ok: true,
      op: "photo",
      result: { ...image, width: 2 },
    });
    worker?.reply({ id: one?.id ?? -1, ok: true, op: "photo", result: { ...image, width: 1 } });
    expect((await first).width).toBe(1);
    expect((await second).width).toBe(2);
  });

  it("SPEC 8.1: un fichier illisible est refusé avec la même raison que sur la page", async () => {
    withWorkers();
    const { preparePhoto } = await load();
    const photo = preparePhoto(file);
    const worker = FakeWorker.instances[0];
    worker?.reply({ id: worker.posted[0]?.id ?? -1, ok: false, reason: "corrupted" });
    await expect(photo).rejects.toMatchObject({ name: "PrepareError", reason: "corrupted" });
  });

  it("SPEC 8.1: une panne du Worker n'est pas un refus du fichier (il sera réessayé)", async () => {
    withWorkers();
    const { preparePhoto } = await load();
    const photo = preparePhoto(file);
    const worker = FakeWorker.instances[0];
    worker?.reply({ id: worker.posted[0]?.id ?? -1, ok: false, reason: "error", message: "oops" });
    const error = await photo.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(PrepareError);
  });

  it("SPEC 8.1: un Worker qui ne sait pas dessiner laisse la page faire le travail", async () => {
    withWorkers();
    const { preparePhoto } = await load();
    const photo = preparePhoto(file);
    const worker = FakeWorker.instances[0];
    worker?.reply({ id: worker.posted[0]?.id ?? -1, ok: false, reason: "unavailable" });
    expect(await photo).toBe(image);
    expect(prepareImage).toHaveBeenCalledWith(file);
  });

  it("SPEC 8.1: un Worker qui plante rend la main à la page, pour les envois en cours et les suivants", async () => {
    withWorkers();
    const { preparePhoto, hashFile } = await load();
    const waiting = preparePhoto(file);
    const worker = FakeWorker.instances[0];
    worker?.onerror?.();
    expect(await waiting).toBe(image);
    expect(worker?.terminated).toBe(true);

    // Later files go straight to the page; no second worker is started.
    expect(await hashFile(file)).toBe("b".repeat(64));
    expect(await preparePhoto(file)).toBe(image);
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it("SPEC 8.1: un appareil qui ne peut dessiner nulle part refuse le fichier comme format non pris en charge", async () => {
    vi.stubGlobal("Worker", undefined);
    const { preparePhoto } = await load();
    // Imported after the reset: the same copy of the module the client uses.
    const { CanvasUnavailableError } = await import("@/lib/upload/surface");
    prepareImage.mockRejectedValue(new CanvasUnavailableError());
    await expect(preparePhoto(file)).rejects.toMatchObject({
      name: "PrepareError",
      reason: "unsupported_format",
    });
  });
});
