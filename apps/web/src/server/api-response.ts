import type { ApiErrorBody, ApiErrorCode } from "@snapalbum/shared";
import type { z } from "zod";

/** An error answer in the shape every client understands (`apiErrorBodySchema`). */
export function apiError(status: number, code: ApiErrorCode, headers?: HeadersInit): Response {
  const body: ApiErrorBody = { error: { code } };
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

export function apiJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** The JSON body of a request, validated with Zod (NF-043), or the error answer to send back. */
export async function parseBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<{ ok: true; data: z.output<S> } | { ok: false; response: Response }> {
  const raw: unknown = await request.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, response: apiError(400, "validation_failed") };
  return { ok: true, data: parsed.data };
}

/** Turns an unexpected failure into the standard 500 answer (logged, never shown to the client). */
export async function guarded(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    console.error("[api] unexpected failure", error);
    return apiError(500, "internal_error");
  }
}
