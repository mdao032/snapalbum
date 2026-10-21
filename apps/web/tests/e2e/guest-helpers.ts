import type { Page } from "@playwright/test";
import { deflateSync } from "node:zlib";
import { expect, signIn } from "./fixtures";

/** An organiser creates an event; returns its code and id. */
export async function createEvent(page: Page): Promise<{ code: string; id: string }> {
  await signIn(page);
  await page.goto("/events/new");
  await page.getByLabel("Nom de l’événement").fill("Mariage de Léa et Tom");
  await page.getByRole("button", { name: "Créer mon événement" }).click();
  await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}$/);
  const id = page.url().split("/").pop() ?? "";
  const code = (await page.getByLabel("Lien de l’événement").inputValue()).split("/").pop() ?? "";
  return { code, id };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buffer) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A small real PNG (a gradient shifted by `seed`): every seed is a different photo. */
export function samplePhoto(seed: number, width = 96, height = 64): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8 bits, RGB
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x += 1) {
      row[1 + x * 3] = (x * 2 + seed * 37) & 255;
      row[2 + x * 3] = (y * 3 + seed * 91) & 255;
      row[3 + x * 3] = (x + y + seed * 13) & 255;
    }
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Chooses photos in the gallery button, as a guest would. */
export async function chooseFromGallery(
  page: Page,
  files: { name: string; buffer: Buffer; mimeType?: string }[],
): Promise<void> {
  // Choosing before the page is interactive would be lost: wait for hydration to settle.
  await page.waitForLoadState("networkidle");
  await page.getByTestId("gallery-input").setInputFiles(
    files.map((file) => ({
      name: file.name,
      mimeType: file.mimeType ?? "image/png",
      buffer: file.buffer,
    })),
  );
}
