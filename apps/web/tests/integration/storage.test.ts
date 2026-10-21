import { CreateBucketCommand, DeleteBucketCommand, S3Client } from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mediaKey, MULTIPART_PART_SIZE_BYTES, eventPrefix } from "@snapalbum/shared";
import { createStorage, type Storage } from "@/server/storage";

const endpoint = process.env.S3_TEST_ENDPOINT ?? "http://127.0.0.1:9100";
const credentials = { accessKeyId: "snapalbum", secretAccessKey: "snapalbum-secret" };
const bucket = `snapalbum-test-${randomUUID().slice(0, 8)}`;

let storage: Storage;
const admin = new S3Client({ region: "us-east-1", endpoint, forcePathStyle: true, credentials });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const bytes = (size: number, fill = 7) => new Uint8Array(size).fill(fill);

async function put(url: string, headers: Record<string, string>, body: Uint8Array) {
  return fetch(url, { method: "PUT", headers, body: new Blob([body as BlobPart]) });
}

beforeAll(async () => {
  try {
    await admin.send(new CreateBucketCommand({ Bucket: bucket }));
  } catch (error) {
    throw new Error(
      `The S3 emulator is not reachable on ${endpoint}. Start it with \`pnpm storage:start\`. (${String(error)})`,
    );
  }
  storage = createStorage({
    endpoint,
    bucket,
    region: "us-east-1",
    forcePathStyle: true,
    ...credentials,
  });
});

afterAll(async () => {
  await storage?.deleteEventObjects(eventPrefix(EVENT_A)).catch(() => undefined);
  await storage?.deleteEventObjects(eventPrefix(EVENT_B)).catch(() => undefined);
  await admin.send(new DeleteBucketCommand({ Bucket: bucket })).catch(() => undefined);
});

const EVENT_A = randomUUID();
const EVENT_B = randomUUID();
const media = () => randomUUID();

describe("SPEC 9: envoi direct par adresse signée", () => {
  it("SPEC 9: le navigateur peut déposer un fichier, qu'on retrouve avec sa taille et son type", async () => {
    const key = mediaKey(EVENT_A, media(), "display");
    const body = bytes(2048);
    const signed = await storage.presignUpload(key, {
      contentType: "image/webp",
      contentLength: body.length,
    });

    const response = await put(signed.url, signed.headers, body);
    expect(response.status).toBe(200);

    expect(await storage.head(key)).toMatchObject({ size: 2048, contentType: "image/webp" });
  });

  it("S-002: un fichier d'une autre taille que celle annoncée est refusé par le stockage", async () => {
    const key = mediaKey(EVENT_A, media(), "display");
    const signed = await storage.presignUpload(key, {
      contentType: "image/webp",
      contentLength: 1000,
    });
    const response = await put(
      signed.url,
      { ...signed.headers, "Content-Length": "5000" },
      bytes(5000),
    );
    expect(response.ok).toBe(false);
    expect(await storage.head(key)).toBeNull();
  });

  it("S-002: un autre type de contenu que celui signé est refusé", async () => {
    const key = mediaKey(EVENT_A, media(), "display");
    const signed = await storage.presignUpload(key, {
      contentType: "image/webp",
      contentLength: 100,
    });
    const response = await put(
      signed.url,
      { ...signed.headers, "Content-Type": "text/html" },
      bytes(100),
    );
    expect(response.ok).toBe(false);
    expect(await storage.head(key)).toBeNull();
  });

  it("S-002: l'adresse ne sert qu'à la clé signée, pas à une autre", async () => {
    const signed = await storage.presignUpload(mediaKey(EVENT_A, media(), "thumb"), {
      contentType: "image/webp",
      contentLength: 10,
    });
    const other = mediaKey(EVENT_A, media(), "thumb");
    const tampered = signed.url.replace(/\/events\/[^?]+/, `/${other}`);
    expect((await put(tampered, signed.headers, bytes(10))).ok).toBe(false);
    expect(await storage.head(other)).toBeNull();
  });

  it("SPEC 8.1: une adresse expirée n'accepte plus rien (nouvelle réservation nécessaire)", async () => {
    const key = mediaKey(EVENT_A, media(), "display");
    const signed = await storage.presignUpload(key, {
      contentType: "image/webp",
      contentLength: 10,
      expiresInSeconds: 1,
    });
    await sleep(2500);
    expect((await put(signed.url, signed.headers, bytes(10))).ok).toBe(false);
  });

  it("SPEC 9.1: aucune adresse n'est valable plus d'une heure, même si on en demande plus", async () => {
    const key = mediaKey(EVENT_A, media(), "display");
    const upload = await storage.presignUpload(key, {
      contentType: "image/webp",
      contentLength: 10,
      expiresInSeconds: 7 * 24 * 3600,
    });
    expect(new URL(upload.url).searchParams.get("X-Amz-Expires")).toBe("3600");
    const read = await storage.presignRead(key, { expiresInSeconds: 86_400 });
    expect(new URL(read).searchParams.get("X-Amz-Expires")).toBe("3600");
  });

  it("SPEC 9.1: refuse une durée nulle ou négative", async () => {
    await expect(
      storage.presignUpload("events/x", {
        contentType: "a/b",
        contentLength: 1,
        expiresInSeconds: 0,
      }),
    ).rejects.toThrow();
  });
});

describe("SPEC 9.1: lecture par adresse signée", () => {
  it("SPEC 9.1: une adresse de lecture rend le contenu, avec un nom de téléchargement au besoin", async () => {
    const key = mediaKey(EVENT_A, media(), "original", "jpg");
    const body = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    const signed = await storage.presignUpload(key, {
      contentType: "image/jpeg",
      contentLength: body.length,
    });
    expect((await put(signed.url, signed.headers, body)).status).toBe(200);

    const plain = await fetch(await storage.presignRead(key));
    expect(new Uint8Array(await plain.arrayBuffer())).toEqual(body);

    const named = await fetch(await storage.presignRead(key, { downloadName: "Léa & Tom 1.jpg" }));
    expect(named.headers.get("content-disposition")).toBe('attachment; filename="L_a___Tom_1.jpg"');
  });

  it("S-002: lit les premiers octets d'un fichier pour contrôler sa signature binaire", async () => {
    const key = mediaKey(EVENT_A, media(), "original", "jpg");
    const body = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9, 9, 9, 9]);
    const signed = await storage.presignUpload(key, {
      contentType: "image/jpeg",
      contentLength: body.length,
    });
    await put(signed.url, signed.headers, body);
    expect(Array.from(await storage.readStart(key, 4))).toEqual([0xff, 0xd8, 0xff, 0xe0]);
  });

  it("SPEC 8.1: un objet absent se reconnaît (confirmation d'envoi)", async () => {
    expect(await storage.head(mediaKey(EVENT_A, media(), "display"))).toBeNull();
  });
});

describe("R5: suppression", () => {
  it("R5: supprime un fichier", async () => {
    const key = mediaKey(EVENT_A, media(), "thumb");
    const signed = await storage.presignUpload(key, {
      contentType: "image/webp",
      contentLength: 5,
    });
    await put(signed.url, signed.headers, bytes(5));
    await storage.deleteObject(key);
    expect(await storage.head(key)).toBeNull();
  });

  it("R5: purge tous les fichiers d'un événement, et seulement les siens", async () => {
    const keysA = [media(), media(), media()].map((id) => mediaKey(EVENT_A, id, "display"));
    const keyB = mediaKey(EVENT_B, media(), "display");
    for (const key of [...keysA, keyB]) {
      const signed = await storage.presignUpload(key, {
        contentType: "image/webp",
        contentLength: 3,
      });
      await put(signed.url, signed.headers, bytes(3));
    }
    const deleted = await storage.deleteEventObjects(eventPrefix(EVENT_A));
    expect(deleted).toBeGreaterThanOrEqual(3);
    for (const key of keysA) expect(await storage.head(key)).toBeNull();
    expect(await storage.head(keyB)).not.toBeNull();
  });

  it("R5: une purge sans événement précis est refusée, le compartiment ne peut pas être vidé", async () => {
    for (const prefix of [
      "",
      "events/",
      "events",
      "events/not-a-uuid/",
      `events/${EVENT_A}`,
      "../",
    ]) {
      await expect(storage.deleteEventObjects(prefix)).rejects.toThrow("Refusing");
    }
  });

  it("R5: purger un événement sans fichier ne fait rien", async () => {
    expect(await storage.deleteEventObjects(eventPrefix(randomUUID()))).toBe(0);
  });
});

describe("NF-013: envoi en morceaux", () => {
  const partSize = MULTIPART_PART_SIZE_BYTES;

  async function sendPart(key: string, uploadId: string, partNumber: number, body: Uint8Array) {
    const url = await storage.presignPart(key, uploadId, partNumber, {
      contentLength: body.length,
    });
    const response = await fetch(url, {
      method: "PUT",
      headers: { "Content-Length": String(body.length) },
      body: new Blob([body as BlobPart]),
    });
    expect(response.status).toBe(200);
    return { partNumber, etag: response.headers.get("etag") ?? "" };
  }

  it("NF-013: envoie une vidéo en trois morceaux puis la finalise", async () => {
    const key = mediaKey(EVENT_A, media(), "original", "mp4");
    const uploadId = await storage.createMultipart(key, "video/mp4");
    const sizes = [partSize, partSize, 1024 * 1024];

    const parts = [];
    for (const [index, size] of sizes.entries()) {
      parts.push(await sendPart(key, uploadId, index + 1, bytes(size, index + 1)));
    }
    // Sent out of order on purpose: the storage needs them sorted, the helper does it.
    await storage.completeMultipart(key, uploadId, [parts[2]!, parts[0]!, parts[1]!]);

    expect(await storage.head(key)).toMatchObject({ size: sizes.reduce((a, b) => a + b) });
  }, 120_000);

  it("NF-013: après une coupure, les morceaux déjà reçus se retrouvent pour reprendre au bon endroit", async () => {
    const key = mediaKey(EVENT_A, media(), "original", "mp4");
    const uploadId = await storage.createMultipart(key, "video/mp4");
    const first = await sendPart(key, uploadId, 1, bytes(partSize, 1));
    const second = await sendPart(key, uploadId, 2, bytes(partSize, 2));

    const received = await storage.listParts(key, uploadId);
    expect(received.map((part) => part.partNumber)).toEqual([1, 2]);
    expect(received.every((part) => part.size === partSize)).toBe(true);
    expect(received.map((part) => part.etag)).toEqual([first.etag, second.etag]);

    const last = await sendPart(key, uploadId, 3, bytes(500, 3));
    await storage.completeMultipart(key, uploadId, [
      ...received.map((p) => ({ partNumber: p.partNumber, etag: p.etag })),
      last,
    ]);
    expect((await storage.head(key))?.size).toBe(partSize * 2 + 500);
  }, 120_000);

  it("NF-013: annuler un envoi en morceaux libère ce qui avait été reçu", async () => {
    const key = mediaKey(EVENT_A, media(), "original", "mp4");
    const uploadId = await storage.createMultipart(key, "video/mp4");
    await sendPart(key, uploadId, 1, bytes(partSize));
    await storage.abortMultipart(key, uploadId);
    await expect(storage.listParts(key, uploadId)).rejects.toThrow();
    expect(await storage.head(key)).toBeNull();
  }, 120_000);

  it("NF-013: refuse un numéro de morceau hors de 1 à 10 000", async () => {
    for (const number of [0, -1, 10_001, 1.5]) {
      await expect(
        storage.presignPart("events/x", "id", number, { contentLength: 1 }),
      ).rejects.toThrow("Invalid part");
    }
  });
});
