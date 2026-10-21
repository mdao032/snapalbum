import { createApiClient } from "@snapalbum/shared/api-client";
import type { PlanId } from "@snapalbum/shared/plans";
import {
  createUploadEngine,
  type StorageProblem,
  type UploadEngine,
} from "@snapalbum/shared/upload";
import { startBackgroundSync } from "@/lib/upload/background-sync";
import { browserUploadIO } from "@/lib/upload/browser-io";
import { createIdbStore, requestPersistentStorage } from "@/lib/upload/idb-store";
import { writePendingFlag } from "@/lib/upload/pending-flag";

/**
 * The upload machinery of the guest page: preparation of images, the shared engine, the local
 * copies in IndexedDB (NF-010), the resumes and the API client with its validation. It is a
 * separate chunk, loaded when the first photo is chosen (or at load when files were left on the
 * device), so the page itself stays within its JavaScript budget (NF-002).
 */
export function createGuestEngine(options: {
  eventCode: string;
  plan: PlanId;
  onNeedJoin: () => void;
  onStorageProblem: (problem: StorageProblem) => void;
}): UploadEngine<File> {
  const { eventCode } = options;
  const engine = createUploadEngine<File, Blob>({
    api: createApiClient({ baseUrl: "" }),
    io: browserUploadIO,
    eventCode,
    plan: options.plan,
    store: createIdbStore(eventCode),
    onNeedJoin: options.onNeedJoin,
    onStorageProblem: options.onStorageProblem,
  });

  // Until the files of an earlier visit are taken back, an empty list must not clear the flag.
  let ready = false;
  const sync = startBackgroundSync(() => engine.retryNow());
  engine.subscribe(() => {
    const items = engine.getItems();
    if (ready) {
      writePendingFlag(
        eventCode,
        items.some((item) => item.status !== "sent" && item.status !== "rejected"),
      );
    }
    if (items.some((item) => item.status === "failed" || item.status === "waiting_quota")) {
      sync.request();
    }
  });

  return {
    ...engine,
    add(files) {
      ready = true;
      void requestPersistentStorage();
      engine.add(files);
    },
    async restore() {
      try {
        return await engine.restore();
      } finally {
        ready = true;
        writePendingFlag(
          eventCode,
          engine.getItems().some((item) => item.status !== "sent" && item.status !== "rejected"),
        );
      }
    },
  };
}
