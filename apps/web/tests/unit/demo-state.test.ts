// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  demoReducer,
  hasPendingItems,
  initialDemoState,
  MAX_PARALLEL,
  SEND_MS,
  sentItems,
  type DemoAction,
  type DemoState,
} from "@/components/marketing/demo/demo-state";

const run = (actions: DemoAction[], from: DemoState = initialDemoState) =>
  actions.reduce(demoReducer, from);

const withThree = () =>
  run([
    { type: "openPicker" },
    { type: "toggleSample", sample: "couple" },
    { type: "toggleSample", sample: "cake" },
    { type: "toggleSample", sample: "dance" },
    { type: "send" },
  ]);

describe("étape 5.1: démonstration publique, état", () => {
  it("choisir puis retirer une photo d'exemple", () => {
    const state = run([
      { type: "openPicker" },
      { type: "toggleSample", sample: "cake" },
      { type: "toggleSample", sample: "couple" },
      { type: "toggleSample", sample: "cake" },
    ]);
    expect(state.picking).toBe(true);
    expect(state.selection).toEqual(["couple"]);
  });

  it("envoyer sans rien choisir ne change rien", () => {
    const state = run([{ type: "openPicker" }]);
    expect(demoReducer(state, { type: "send" })).toBe(state);
  });

  it("envoyer met les photos en attente et referme le choix", () => {
    const state = withThree();
    expect(state.picking).toBe(false);
    expect(state.selection).toEqual([]);
    expect(state.items.map((item) => item.status)).toEqual(["waiting", "waiting", "waiting"]);
    expect(new Set(state.items.map((item) => item.id)).size).toBe(3);
    expect(hasPendingItems(state)).toBe(true);
  });

  it("deux photos au plus partent en même temps, la suivante attend sa place", () => {
    const state = demoReducer(withThree(), { type: "tick", elapsedMs: 100 });
    expect(state.items.filter((item) => item.status === "sending")).toHaveLength(MAX_PARALLEL);
    expect(state.items[2]?.status).toBe("waiting");
  });

  it("toutes les photos arrivent, dans l'ordre, puis plus rien ne tourne", () => {
    let state = withThree();
    for (let i = 0; i < 100 && hasPendingItems(state); i += 1) {
      state = demoReducer(state, { type: "tick", elapsedMs: 100 });
    }
    expect(hasPendingItems(state)).toBe(false);
    expect(sentItems(state).map((item) => item.sample)).toEqual(["couple", "cake", "dance"]);
    expect(demoReducer(state, { type: "tick", elapsedMs: 100 })).toBe(state);
  });

  it("une photo met le temps prévu pour partir", () => {
    const state = run([
      { type: "openPicker" },
      { type: "toggleSample", sample: "sunset" },
      { type: "send" },
      { type: "tick", elapsedMs: SEND_MS / 2 },
    ]);
    expect(state.items[0]?.progress).toBeCloseTo(0.5);
    expect(state.items[0]?.status).toBe("sending");
  });

  it("sans réseau rien n'avance, au retour l'envoi reprend là où il en était", () => {
    let state = run([{ type: "setOnline", online: false }], withThree());
    const frozen = demoReducer(state, { type: "tick", elapsedMs: 5000 });
    expect(frozen).toBe(state);
    expect(sentItems(frozen)).toHaveLength(0);

    state = run(
      [
        { type: "setOnline", online: true },
        { type: "tick", elapsedMs: 700 },
      ],
      frozen,
    );
    expect(state.items[0]?.progress).toBeCloseTo(0.5);
  });

  it("la coupure en plein envoi garde l'avancement", () => {
    let state = demoReducer(withThree(), { type: "tick", elapsedMs: 700 });
    const before = state.items.map((item) => item.progress);
    state = run(
      [
        { type: "setOnline", online: false },
        { type: "tick", elapsedMs: 700 },
      ],
      state,
    );
    expect(state.items.map((item) => item.progress)).toEqual(before);
  });

  it("recommencer remet la démonstration à zéro", () => {
    expect(demoReducer(withThree(), { type: "reset" })).toEqual(initialDemoState);
  });

  it("annuler le choix referme sans rien envoyer", () => {
    const state = run([
      { type: "openPicker" },
      { type: "toggleSample", sample: "cake" },
      { type: "closePicker" },
    ]);
    expect(state.picking).toBe(false);
    expect(state.items).toEqual([]);
  });
});
