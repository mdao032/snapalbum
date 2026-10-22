import type { ApiClient } from "../api-client";
import { ApiError } from "../api-client";
import type { PlanId } from "../plans";
import type { ApiErrorCode, SignedTarget } from "../schemas/upload";
import { checkFileLimits } from "./quota";
import {
  createQueueItem,
  markFailed,
  markRejected,
  markSent,
  markUploading,
  markWaitingQuota,
  MAX_CONCURRENT_UPLOADS,
  pickNextItems,
  QUOTA_RECHECK_MS,
  resetForRetry,
  summarizeQueue,
  type QueueItem,
  type QueueSummary,
} from "./queue";

/**
 * The upload engine (SPEC 8.1, steps 2 to 6): prepare, reserve, send directly to the storage,
 * confirm. It holds no DOM and no network code of its own: the platform (browser, mobile app)
 * brings `UploadIO`, so the web and the apps run exactly the same logic and the same tests.
 */

/** What preparation produces for one file (SPEC 8.1, step 2). `B` is the platform's blob type. */
export interface PreparedMedia<B> {
  kind: "photo" | "video";
  sha256: string;
  mimeType: string;
  /** Extension of the original, without the dot. */
  extension: string;
  bytes: number;
  displayBytes?: number;
  thumbBytes: number;
  previewFormat: "webp" | "jpeg";
  width?: number;
  height?: number;
  durationSeconds?: number;
  takenAt?: string;
  /** Placeholder of the thumbnail (BlurHash). */
  blurhash?: string;
  original: B;
  display?: B;
  thumb: B;
}

/** Why a file cannot be prepared on this device (not retried: the file itself is the problem). */
export class PrepareError extends Error {
  constructor(readonly reason: "unsupported_format" | "corrupted") {
    super(reason);
    this.name = "PrepareError";
  }
}

/** An upload address answered with an HTTP status (an expired address gives 403). */
export class PutError extends Error {
  constructor(readonly status: number) {
    super(`Upload refused with status ${status}`);
    this.name = "PutError";
  }
}

export interface UploadIO<F, B> {
  prepare(file: F): Promise<PreparedMedia<B>>;
  /** PUT `body` to a signed address, reporting the bytes sent so far. Rejects on any failure. */
  put(target: SignedTarget, body: B, onProgress: (sentBytes: number) => void): Promise<void>;
  /** The bytes `start` to `end` of `body`, for one part of a large video. */
  slice(body: B, start: number, end: number): B;
  /** An address the interface can show for the prepared thumbnail (an object URL in the browser). */
  previewUrl?(media: PreparedMedia<B>): string | undefined;
}

/**
 * Where chosen files wait on the device until the server has confirmed them (NF-010): IndexedDB
 * in the browser. Injected, so the engine stays free of any platform.
 */
export interface UploadStore<F> {
  put(id: string, file: F): Promise<void>;
  remove(id: string): Promise<void>;
  /** Every file left from an earlier visit of this page. */
  list(): Promise<{ id: string; file: F }[]>;
}

/** Why a copy could not be kept on the device: the file is still sent, but not safe from a reload. */
export type StorageProblem = "storage_full" | "storage_unavailable";

export type UploadFailureReason = ApiErrorCode | "corrupted" | "network_error" | "upload_failed";

export interface UploadItem extends QueueItem {
  name: string;
  /** 0 to 1, over every byte this file must send (display, thumbnail, original). */
  progress: number;
  /** Why the item failed, was rejected or waits (shown to the guest). */
  reason?: UploadFailureReason;
  mediaId?: string;
  /** Local picture of the file once prepared, shown in the list before and during the upload. */
  previewUrl?: string;
  /** No copy of the file could be kept on the device: closing the page now would lose it. */
  unsaved?: boolean;
}

export interface UploadEngineOptions<F extends { name: string }, B> {
  api: Pick<ApiClient, "reserveUpload" | "completeUpload" | "multipart">;
  io: UploadIO<F, B>;
  eventCode: string;
  /** Plan of the event: files over its size or duration limits are refused before any upload. */
  plan?: PlanId;
  now?: () => number;
  /** Runs `run` after `delayMs`; returns a function that cancels it. Injectable for tests. */
  schedule?: (run: () => void, delayMs: number) => () => void;
  newId?: () => string;
  maxConcurrent?: number;
  /** Local copies of the files (NF-010). Without it, files live in memory only. */
  store?: UploadStore<F>;
  /** Called when a file could not be copied to the store. */
  onStorageProblem?: (problem: StorageProblem) => void;
  /** Called once when the guest has to join the event first (no session or not a guest yet). */
  onNeedJoin?: () => void;
}

export interface UploadEngine<F> {
  /** Adds files to the queue and starts sending them. */
  add(files: readonly F[]): void;
  /** Takes back the files left by an earlier visit and sends them; resolves with their number. */
  restore(): Promise<number>;
  /** Tries every waiting or failed file again now (connection back, album enlarged). */
  retryNow(): void;
  /** The event moved to another plan (R2): the limits applied before sending follow it. */
  setPlan(plan: PlanId): void;
  /** Starts again after the guest has joined the event. */
  resumeAfterJoin(): void;
  getItems(): readonly UploadItem[];
  getSummary(): QueueSummary;
  subscribe(listener: () => void): () => void;
}

/** How a failure is handled: another try later, a permanent refusal, a wait, or "join first". */
export type FailureDecision =
  | { action: "retry"; reason: UploadFailureReason }
  | { action: "reject"; reason: UploadFailureReason }
  | { action: "wait_quota"; reason: UploadFailureReason }
  | { action: "join" };

const PERMANENT_API_ERRORS: readonly ApiErrorCode[] = [
  "video_too_long",
  "file_too_large",
  "unsupported_format",
  "invalid_file",
  "upload_window_closed",
  "event_suspended",
  "guest_blocked",
  "validation_failed",
  "not_found",
];

/** Decides what a failure means (pure, tested on its own). */
export function classifyFailure(error: unknown): FailureDecision {
  if (error instanceof PrepareError) return { action: "reject", reason: error.reason };
  if (error instanceof ApiError) {
    const code = error.code;
    // Both limits go away when the organiser upgrades (R1, R2): the file waits, it is not lost.
    if (code === "album_full" || code === "video_limit_reached") {
      return { action: "wait_quota", reason: code };
    }
    if (code === "unauthorized" || code === "forbidden" || code === "terms_required") {
      return { action: "join" };
    }
    if (code === "network_error") return { action: "retry", reason: "network_error" };
    if ((PERMANENT_API_ERRORS as readonly string[]).includes(code)) {
      return { action: "reject", reason: code as ApiErrorCode };
    }
    // rate_limited, upload_incomplete, internal_error, invalid_response...: later, not never.
    return {
      action: "retry",
      reason: code === "invalid_response" ? "upload_failed" : (code as ApiErrorCode),
    };
  }
  if (error instanceof PutError) return { action: "retry", reason: "upload_failed" };
  return { action: "retry", reason: "network_error" };
}

export function createUploadEngine<F extends { name: string }, B extends { size: number }>(
  options: UploadEngineOptions<F, B>,
): UploadEngine<F> {
  const { api, io, eventCode } = options;
  const now = options.now ?? Date.now;
  const schedule =
    options.schedule ??
    ((run, delay) => {
      const timer = setTimeout(run, delay);
      return () => clearTimeout(timer);
    });
  let counter = 0;
  const newId = options.newId ?? (() => `local-${now()}-${(counter += 1)}`);
  const maxConcurrent = options.maxConcurrent ?? MAX_CONCURRENT_UPLOADS;

  let items: UploadItem[] = [];
  const files = new Map<string, F>();
  const prepared = new Map<string, PreparedMedia<B>>();
  const listeners = new Set<() => void>();
  const store = options.store;
  /** Files being copied to the store: they must not start before the copy is safe. */
  const held = new Set<string>();
  let paused = false;
  let cancelWake: (() => void) | null = null;
  let cancelProbe: (() => void) | null = null;
  let plan = options.plan;

  function emit() {
    // A new array each time: React-style consumers compare by identity.
    items = [...items];
    for (const listener of listeners) listener();
  }

  function update(id: string, change: (item: UploadItem) => UploadItem) {
    items = items.map((item) => (item.id === id ? change(item) : item));
    emit();
  }

  /** Waits a minute, then lets the oldest file kept for lack of room try its luck (R1, R2). */
  function scheduleProbe() {
    if (cancelProbe) return;
    cancelProbe = schedule(() => {
      cancelProbe = null;
      const oldest = items
        .filter((item) => item.status === "waiting_quota")
        .sort((a, b) => a.addedAt - b.addedAt)[0];
      if (!oldest) return;
      update(oldest.id, (item) => ({ ...resetForRetry(item), reason: undefined }));
      pump();
    }, QUOTA_RECHECK_MS);
  }

  /**
   * One file went through: what stopped the others is lifted too, so they try right away. A photo
   * proves the album has room; only a video proves the video limit is not reached.
   */
  function releaseWaiting(kind: "photo" | "video") {
    const frees = (item: UploadItem) =>
      item.status === "waiting_quota" &&
      (item.reason === "album_full" || (kind === "video" && item.reason === "video_limit_reached"));
    if (!items.some(frees)) return;
    cancelProbe?.();
    cancelProbe = null;
    items = items.map((item) =>
      frees(item) ? { ...resetForRetry(item), reason: undefined } : item,
    );
    emit();
    if (items.some((item) => item.status === "waiting_quota")) scheduleProbe();
  }

  function pump() {
    cancelWake?.();
    cancelWake = null;
    if (paused) return;

    const picked = pickNextItems(
      items.filter((item) => !held.has(item.id)),
      now(),
      maxConcurrent,
    );
    for (const item of picked) {
      update(item.id, (current) => ({ ...markUploading(current), progress: 0, reason: undefined }));
      void run(item.id);
    }

    // Wake up when the first failed file may be retried.
    const waiting = items.filter((item) => item.status === "failed").map((item) => item.retryAt);
    if (waiting.length > 0) {
      cancelWake = schedule(pump, Math.max(0, Math.min(...waiting) - now()));
    }
  }

  async function sendAll(id: string, media: PreparedMedia<B>) {
    const total = (media.display?.size ?? 0) + media.thumb.size + media.original.size;
    let done = 0;
    const progressOf = (current: number) =>
      update(id, (item) => ({ ...item, progress: Math.min(0.99, (done + current) / total) }));

    const reserved = await api.reserveUpload({
      eventCode,
      kind: media.kind,
      sha256: media.sha256,
      mimeType: media.mimeType,
      extension: media.extension as never,
      bytes: media.bytes,
      displayBytes: media.displayBytes,
      thumbBytes: media.thumbBytes,
      previewFormat: media.previewFormat,
      width: media.width,
      height: media.height,
      durationSeconds: media.durationSeconds,
      takenAt: media.takenAt,
      blurhash: media.blurhash,
    });
    if (reserved.status === "already_received") return reserved.mediaId;
    update(id, (item) => ({ ...item, mediaId: reserved.mediaId }));

    // Prepared versions first: they are small and make the photo visible sooner.
    const sends: { target: SignedTarget; body: B }[] = [];
    if (reserved.display && media.display)
      sends.push({ target: reserved.display, body: media.display });
    sends.push({ target: reserved.thumb, body: media.thumb });
    if (reserved.original) sends.push({ target: reserved.original, body: media.original });
    for (const send of sends) {
      await io.put(send.target, send.body, progressOf);
      done += send.body.size;
    }

    if (reserved.multipart) {
      const { partSize, partCount } = reserved.multipart;
      await api.multipart({ action: "create", mediaId: reserved.mediaId });
      // After an interruption the server knows which parts it already has.
      const status = await api.multipart({ action: "status", mediaId: reserved.mediaId });
      const stored = new Map(
        status.action === "status" ? status.parts.map((p) => [p.partNumber, p.size]) : [],
      );
      for (let part = 1; part <= partCount; part += 1) {
        const start = (part - 1) * partSize;
        const end = Math.min(start + partSize, media.original.size);
        if (stored.get(part) === end - start) {
          done += end - start;
          continue;
        }
        const signed = await api.multipart({
          action: "part",
          mediaId: reserved.mediaId,
          partNumber: part,
        });
        if (signed.action !== "part") throw new ApiError(500, "invalid_response");
        await io.put(signed.target, io.slice(media.original, start, end), progressOf);
        done += end - start;
      }
      await api.multipart({ action: "complete", mediaId: reserved.mediaId });
    }

    await api.completeUpload({ mediaId: reserved.mediaId });
    return reserved.mediaId;
  }

  /** Confirmed or refused for good: the memory and the local copy can go (NF-010). */
  function forget(id: string) {
    files.delete(id);
    prepared.delete(id);
    store?.remove(id).catch(() => undefined);
  }

  async function persist(id: string, file: F) {
    try {
      await store?.put(id, file);
    } catch (error) {
      update(id, (item) => ({ ...item, unsaved: true }));
      const full = error instanceof Error && error.name === "QuotaExceededError";
      options.onStorageProblem?.(full ? "storage_full" : "storage_unavailable");
    } finally {
      held.delete(id);
    }
  }

  async function run(id: string) {
    const file = files.get(id);
    if (!file) return;
    try {
      let media = prepared.get(id);
      if (!media) {
        media = await io.prepare(file);
        prepared.set(id, media);
        const previewUrl = io.previewUrl?.(media);
        if (previewUrl) update(id, (item) => ({ ...item, previewUrl }));
      }
      if (plan) {
        const limit = checkFileLimits({
          plan,
          kind: media.kind,
          bytes: media.bytes,
          durationSeconds: media.durationSeconds,
        });
        if (!limit.ok) {
          throw new ApiError(limit.reason === "file_too_large" ? 413 : 422, limit.reason);
        }
      }
      const mediaId = await sendAll(id, media);
      // Confirmed by the server: the local copy can go (NF-010).
      forget(id);
      update(id, (item) => ({ ...markSent(item), progress: 1, mediaId, reason: undefined }));
      releaseWaiting(media.kind);
    } catch (error) {
      const decision = classifyFailure(error);
      switch (decision.action) {
        case "join":
          update(id, (item) => resetForRetry({ ...item, status: "queued" }));
          paused = true;
          options.onNeedJoin?.();
          break;
        case "reject":
          forget(id);
          update(id, (item) => ({ ...markRejected(item), reason: decision.reason }));
          break;
        case "wait_quota":
          update(id, (item) => ({ ...markWaitingQuota(item), reason: decision.reason }));
          scheduleProbe();
          break;
        case "retry":
          update(id, (item) => ({ ...markFailed(item, now()), reason: decision.reason }));
          break;
      }
    }
    pump();
  }

  return {
    add(newFiles) {
      const saving: Promise<void>[] = [];
      for (const file of newFiles) {
        const id = newId();
        files.set(id, file);
        if (store) {
          held.add(id);
          saving.push(persist(id, file));
        }
        items.push({ ...createQueueItem(id, now()), name: file.name, progress: 0 });
      }
      emit();
      pump();
      // Sending starts once each file is safely copied (or the copy has failed).
      if (saving.length > 0) void Promise.all(saving).then(pump);
    },
    async restore() {
      if (!store) return 0;
      const left = (await store.list()).filter((entry) => !files.has(entry.id));
      for (const entry of left) {
        files.set(entry.id, entry.file);
        items.push({
          ...createQueueItem(entry.id, now()),
          name: entry.file.name,
          progress: 0,
        });
      }
      if (left.length > 0) {
        emit();
        pump();
      }
      return left.length;
    },
    setPlan(next) {
      plan = next;
    },
    retryNow() {
      cancelProbe?.();
      cancelProbe = null;
      items = items.map((item) =>
        item.status === "failed" || item.status === "waiting_quota"
          ? { ...resetForRetry(item), reason: undefined }
          : item,
      );
      emit();
      pump();
    },
    resumeAfterJoin() {
      paused = false;
      pump();
    },
    getItems: () => items,
    getSummary: () => summarizeQueue(items),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
