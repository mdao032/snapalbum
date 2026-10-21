import { createApiClient } from "@snapalbum/shared/api-client";
import type { PlanId } from "@snapalbum/shared/plans";
import { createUploadEngine, type UploadEngine } from "@snapalbum/shared/upload";
import { browserUploadIO } from "@/lib/upload/browser-io";

/**
 * The upload machinery of the guest page: preparation of images, the shared engine and the API
 * client with its validation. It is a separate chunk, loaded when the first photo is chosen, so
 * the page itself stays within its JavaScript budget (NF-002).
 */
export function createGuestEngine(options: {
  eventCode: string;
  plan: PlanId;
  onNeedJoin: () => void;
}): UploadEngine<File> {
  return createUploadEngine<File, Blob>({
    api: createApiClient({ baseUrl: "" }),
    io: browserUploadIO,
    eventCode: options.eventCode,
    plan: options.plan,
    onNeedJoin: options.onNeedJoin,
  });
}
