// Load test of the guest upload pipeline (ROADMAP, tests de la phase 2): 300 guests at once, 10
// photos each, through the real API (reserve, direct upload to the storage, complete).
//
// Prepare:   node tests/load/prepare.mjs --guests 300 --plan event
// Run:       k6 run -e BASE_URL=http://localhost:3100 tests/load/guests.k6.js
//            (in Docker: -e STORAGE_REWRITE=127.0.0.1:9100=host.docker.internal:9100)
// Check:     node tests/load/check.mjs
//
// Like the real upload engine (`packages/shared/src/upload/engine.ts`), every step is tried again
// after a network failure, a 429 or a 5xx, with a growing delay (1 s, 2 s, 4 s...). The gated
// figure is the share of photos that were LOST in the end (never confirmed after every try); the
// failures of single attempts are reported (`attempt_failures`) but are not a loss.
// Pacing keeps reservations under the per-event limit of 1 000 a minute.
import crypto from "k6/crypto";
import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Rate } from "k6/metrics";

const state = JSON.parse(open("./state.json"));
const BASE_URL = __ENV.BASE_URL || "http://localhost:3100";
const PHOTOS_PER_GUEST = Number(__ENV.PHOTOS || 10);
const PACING_SECONDS = Number(__ENV.PACING || 60);
const MAX_ATTEMPTS = Number(__ENV.ATTEMPTS || 5);

const confirmed = new Counter("photos_confirmed");
const refusedForRoom = new Counter("photos_refused_album_full");
const attemptFailures = new Counter("attempt_failures");
const lostPhotos = new Rate("photo_loss_rate");

export const options = {
  scenarios: {
    guests: {
      executor: "per-vu-iterations",
      vus: state.tokens.length,
      iterations: 1,
      maxDuration: "30m",
    },
  },
  thresholds: {
    // ROADMAP: error rate under 0.1 %, success rate above 99.5 %.
    photo_loss_rate: ["rate<0.001"],
  },
};

/** A tiny file that looks like a WebP to the server's signature check (S-002). */
function webp(size) {
  const bytes = new Uint8Array(size);
  bytes.set([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
  return bytes.buffer;
}

/** The same for a JPEG original. */
function jpeg(size) {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  return bytes.buffer;
}

/** What the engine tries again: no answer at all, too many requests, a server error. */
const retryable = (response) =>
  response.status === 0 || response.status === 429 || response.status >= 500;

/** Runs `send` until it answers with something final, at most `MAX_ATTEMPTS` times. */
function withRetries(send) {
  let response;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    response = send();
    if (!retryable(response)) return response;
    attemptFailures.add(1);
    // Exponential delay with a little jitter, as the engine does (capped at 60 s).
    sleep(Math.min(60, 2 ** attempt) * (0.75 + Math.random() * 0.5));
  }
  return response;
}

function putTo(target, body) {
  // k6 in Docker reaches the emulator through another name: the address is rewritten and the
  // original Host header kept, since the signature covers it.
  const [from, to] = (__ENV.STORAGE_REWRITE || "").split("=");
  const url = from && to ? target.url.replace(from, to) : target.url;
  const host = from ? { Host: from } : {};
  return http.put(url, body, { headers: { ...target.headers, ...host } });
}

export default function () {
  const token = state.tokens[__VU - 1];
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  for (let n = 0; n < PHOTOS_PER_GUEST; n += 1) {
    sleep(Math.random() * PACING_SECONDS);
    const body = JSON.stringify({
      eventCode: state.eventCode,
      kind: "photo",
      sha256: crypto.sha256(`${__VU}-${n}-${Math.random()}`, "hex"),
      mimeType: "image/jpeg",
      extension: "jpg",
      bytes: 20000,
      displayBytes: 4000,
      thumbBytes: 800,
      previewFormat: "webp",
      width: 4000,
      height: 3000,
    });

    // The whole circuit is repeated, as the engine does: an interrupted upload starts again from a
    // new reservation (the same file keeps its fingerprint, so nothing is duplicated).
    let done = false;
    let full = false;
    for (let circuit = 0; circuit < MAX_ATTEMPTS && !done && !full; circuit += 1) {
      const reserved = withRetries(() =>
        http.post(`${BASE_URL}/api/uploads/reserve`, body, { headers }),
      );
      if (reserved.status === 409 && reserved.json("error.code") === "album_full") {
        // A full album is the expected answer once the quota is reached: not a loss.
        full = true;
        break;
      }
      if (reserved.status !== 200) {
        attemptFailures.add(1);
        sleep(2 ** circuit);
        continue;
      }
      const slot = reserved.json();
      if (slot.status === "already_received") {
        done = true;
        break;
      }
      const stored = [
        withRetries(() => putTo(slot.display, webp(4000))),
        withRetries(() => putTo(slot.thumb, webp(800))),
        // Paid plans keep the original too (R2): a small file with a JPEG signature.
        slot.original ? withRetries(() => putTo(slot.original, jpeg(20000))) : { status: 200 },
      ].every((answer) => answer.status === 200);
      if (!stored) {
        attemptFailures.add(1);
        sleep(2 ** circuit);
        continue;
      }
      const confirmation = withRetries(() =>
        http.post(`${BASE_URL}/api/uploads/complete`, JSON.stringify({ mediaId: slot.mediaId }), {
          headers,
        }),
      );
      done = check(confirmation, { confirmed: (r) => r.status === 200 });
      if (!done) attemptFailures.add(1);
    }

    if (full) {
      refusedForRoom.add(1);
      continue;
    }
    lostPhotos.add(!done);
    if (done) confirmed.add(1);
  }
}
