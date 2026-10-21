import type { UploadStore } from "@snapalbum/shared/upload";
import { openDB, type DBSchema } from "idb";

/**
 * The guest's files, kept in IndexedDB from the moment they are chosen until the server has
 * confirmed them (NF-010): a closed tab, a crash or a lost connection never loses a photo. Files
 * are stored as they are (the original, not the prepared versions), so a resumed upload is
 * prepared again from the real file.
 */

interface UploadsDb extends DBSchema {
  files: {
    key: string;
    value: { id: string; eventCode: string; file: File; addedAt: number };
    indexes: { "by-event": string };
  };
}

const DB_NAME = "snapalbum-uploads";

/** Each event has its own files: a device can hold guests of several albums. */
export function createIdbStore(eventCode: string): UploadStore<File> {
  // Opened on first use: a browser that refuses IndexedDB then fails inside `put` and `list`
  // (which the engine handles), not while the page starts.
  let opened: ReturnType<typeof openDB<UploadsDb>> | undefined;
  const database = () =>
    (opened ??= openDB<UploadsDb>(DB_NAME, 1, {
      upgrade(db) {
        const files = db.createObjectStore("files", { keyPath: "id" });
        files.createIndex("by-event", "eventCode");
      },
    }));

  return {
    async put(id, file) {
      await (await database()).put("files", { id, eventCode, file, addedAt: Date.now() });
    },
    async remove(id) {
      await (await database()).delete("files", id);
    },
    async list() {
      const rows = await (await database()).getAllFromIndex("files", "by-event", eventCode);
      return rows.sort((a, b) => a.addedAt - b.addedAt).map(({ id, file }) => ({ id, file }));
    },
  };
}

/** Asks the browser not to evict our files under storage pressure (best effort, never required). */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
