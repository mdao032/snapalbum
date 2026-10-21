import type { z } from "zod";
import {
  apiErrorBodySchema,
  completeUploadResponseSchema,
  galleryResponseSchema,
  joinEventResponseSchema,
  multipartResponseSchema,
  myMediaResponseSchema,
  reserveUploadResponseSchema,
  type ApiErrorCode,
  type CompleteUploadRequest,
  type CompleteUploadResponse,
  type GalleryRequest,
  type GalleryResponse,
  type JoinEventRequest,
  type JoinEventResponse,
  type MultipartRequest,
  type MultipartResponse,
  type MyMediaRequest,
  type MyMediaResponse,
  type ReserveUploadRequest,
  type ReserveUploadResponse,
} from "../schemas";

export interface ApiClientOptions {
  /** Base URL of the API, without trailing slash. Empty string means same origin (web). */
  baseUrl: string;
  /** Returns a Supabase access token for `Authorization: Bearer` (mobile). Web uses cookies. */
  getAccessToken?: () => Promise<string | null> | string | null;
  /** Injectable for tests and for runtimes without a global `fetch`. */
  fetch?: typeof fetch;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode | "network_error" | "invalid_response",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "ApiError";
  }
}

export interface ApiClient {
  /** A guest joins an event: opens the anonymous session and records the guest (F-033 to F-035). */
  joinEvent(body: JoinEventRequest): Promise<JoinEventResponse>;
  reserveUpload(body: ReserveUploadRequest): Promise<ReserveUploadResponse>;
  completeUpload(body: CompleteUploadRequest): Promise<CompleteUploadResponse>;
  /** Large videos, sent in parts (NF-013). The answer carries the same `action` as the request. */
  multipart(body: MultipartRequest): Promise<MultipartResponse>;
  /** The guest's own uploads (F-038) and deletion of one of them (G-005). */
  myMedia(body: MyMediaRequest): Promise<MyMediaResponse>;
  /** The album: a page of thumbnails, fresh addresses, or the files of the viewer (F-039, F-050 to F-054). */
  gallery(body: GalleryRequest): Promise<GalleryResponse>;
}

/** Typed client of the Next.js API routes, shared by the web, the mobile apps and the App Clip. */
export function createApiClient(options: ApiClientOptions): ApiClient {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);

  async function post<S extends z.ZodType>(
    path: string,
    body: unknown,
    schema: S,
  ): Promise<z.infer<S>> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = await options.getAccessToken?.();
    if (token) headers.Authorization = `Bearer ${token}`;

    let response: Response;
    try {
      response = await doFetch(`${options.baseUrl}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, "network_error");
    }

    const payload: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const parsed = apiErrorBodySchema.safeParse(payload);
      throw new ApiError(
        response.status,
        parsed.success ? parsed.data.error.code : "internal_error",
        parsed.success ? parsed.data.error.message : undefined,
      );
    }

    const result = schema.safeParse(payload);
    if (!result.success) throw new ApiError(response.status, "invalid_response");
    return result.data;
  }

  return {
    joinEvent: (body) => post("/api/guests/join", body, joinEventResponseSchema),
    reserveUpload: (body) => post("/api/uploads/reserve", body, reserveUploadResponseSchema),
    completeUpload: (body) => post("/api/uploads/complete", body, completeUploadResponseSchema),
    multipart: (body) => post("/api/uploads/multipart", body, multipartResponseSchema),
    myMedia: (body) => post("/api/uploads/mine", body, myMediaResponseSchema),
    gallery: (body) => post("/api/gallery", body, galleryResponseSchema),
  };
}
