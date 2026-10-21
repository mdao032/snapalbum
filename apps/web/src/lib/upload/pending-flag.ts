/**
 * Set while files wait on the device. The guest page reads it at load to know whether to bring
 * the upload machinery back (and resume) without having loaded it for nothing.
 */
export const pendingFlagKey = (eventCode: string) => `snapalbum:pending:${eventCode}`;

export function readPendingFlag(eventCode: string): boolean {
  try {
    return localStorage.getItem(pendingFlagKey(eventCode)) !== null;
  } catch {
    return false;
  }
}

export function writePendingFlag(eventCode: string, pending: boolean): void {
  try {
    if (pending) localStorage.setItem(pendingFlagKey(eventCode), "1");
    else localStorage.removeItem(pendingFlagKey(eventCode));
  } catch {
    // Storage blocked: the page then simply does not resume by itself after a reload.
  }
}
