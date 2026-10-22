/**
 * The state of the public demo (step 5.1): a guest "sends" sample photos that never leave the page.
 * Pure and deterministic so it can be tested without a browser; the component only feeds it time.
 * Nothing here touches the network, storage or the camera.
 */

export const SAMPLE_IDS = ["couple", "cake", "dance", "bouquet", "cousins", "sunset"] as const;
export type SampleId = (typeof SAMPLE_IDS)[number];

/** How long one photo takes to "send", and how many go at once (like the real queue, in small). */
export const SEND_MS = 1400;
export const MAX_PARALLEL = 2;

export type ItemStatus = "waiting" | "sending" | "sent";

export interface DemoItem {
  id: number;
  sample: SampleId;
  status: ItemStatus;
  /** 0 to 1. */
  progress: number;
}

export interface DemoState {
  items: DemoItem[];
  online: boolean;
  picking: boolean;
  selection: SampleId[];
  nextId: number;
}

export const initialDemoState: DemoState = {
  items: [],
  online: true,
  picking: false,
  selection: [],
  nextId: 1,
};

export type DemoAction =
  | { type: "openPicker" }
  | { type: "closePicker" }
  | { type: "toggleSample"; sample: SampleId }
  | { type: "send" }
  | { type: "setOnline"; online: boolean }
  | { type: "tick"; elapsedMs: number }
  | { type: "reset" };

/** Photos still to go: they are the reason to keep the clock running. */
export function hasPendingItems(state: DemoState): boolean {
  return state.items.some((item) => item.status !== "sent");
}

export function sentItems(state: DemoState): DemoItem[] {
  return state.items.filter((item) => item.status === "sent");
}

function advance(items: DemoItem[], elapsedMs: number): DemoItem[] {
  const next = items.map((item) => ({ ...item }));
  // Fill the free places in the order the photos were chosen.
  let active = next.filter((item) => item.status === "sending").length;
  for (const item of next) {
    if (active >= MAX_PARALLEL) break;
    if (item.status === "waiting") {
      item.status = "sending";
      active += 1;
    }
  }
  for (const item of next) {
    if (item.status !== "sending") continue;
    item.progress = Math.min(1, item.progress + elapsedMs / SEND_MS);
    if (item.progress >= 1) item.status = "sent";
  }
  return next;
}

export function demoReducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case "openPicker":
      return { ...state, picking: true, selection: [] };
    case "closePicker":
      return { ...state, picking: false, selection: [] };
    case "toggleSample":
      return {
        ...state,
        selection: state.selection.includes(action.sample)
          ? state.selection.filter((sample) => sample !== action.sample)
          : [...state.selection, action.sample],
      };
    case "send": {
      if (state.selection.length === 0) return state;
      const added: DemoItem[] = state.selection.map((sample, index) => ({
        id: state.nextId + index,
        sample,
        status: "waiting",
        progress: 0,
      }));
      return {
        ...state,
        items: [...state.items, ...added],
        picking: false,
        selection: [],
        nextId: state.nextId + added.length,
      };
    }
    case "setOnline":
      return { ...state, online: action.online };
    case "tick":
      // Without a network nothing moves: photos wait where they are and carry on when it is back.
      if (!state.online || !hasPendingItems(state)) return state;
      return { ...state, items: advance(state.items, action.elapsedMs) };
    case "reset":
      return initialDemoState;
  }
}
