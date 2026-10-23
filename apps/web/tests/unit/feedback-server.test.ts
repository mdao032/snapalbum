// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { Mailer, OutgoingEmail } from "@/server/email/mailer";
import {
  listFeedback,
  sendFeedbackDigest,
  setFeedbackHandled,
  submitFeedback,
} from "@/server/feedback";
import { fakeAdmin, type Row } from "./fake-admin";

const OWNER = "0aaaaaaa-1111-4111-8111-111111111111";
const GUEST = "0bbbbbbb-2222-4222-8222-222222222222";
const STRANGER = "0ccccccc-3333-4333-8333-333333333333";
const EVENT = {
  id: "3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4d11",
  owner_id: OWNER,
  public_code: "abcdefghjk",
};

const body = (audience: "organiser" | "guest") => ({
  audience,
  eventCode: "abcdefghjk",
  rating: 4,
  message: "Très bien",
  locale: "fr" as const,
});

function world() {
  const feedback: Row[] = [];
  const admin = fakeAdmin({
    events: [EVENT],
    guests: [{ id: "g1", event_id: EVENT.id, auth_user_id: GUEST }],
    feedback,
  });
  return { admin, feedback };
}

describe("6.2: enregistrer un avis", () => {
  it("6.2: le propriétaire de l'événement laisse un avis d'organisateur", async () => {
    const { admin, feedback } = world();
    expect(
      await submitFeedback(admin, { id: OWNER, isAnonymous: false }, body("organiser")),
    ).toEqual({
      ok: true,
    });
    expect(feedback).toHaveLength(1);
    expect(feedback[0]).toMatchObject({
      event_id: EVENT.id,
      audience: "organiser",
      user_id: OWNER,
      rating: 4,
      message: "Très bien",
      locale: "fr",
    });
  });

  it("6.2: un invité de l'événement laisse un avis d'invité", async () => {
    const { admin, feedback } = world();
    expect(await submitFeedback(admin, { id: GUEST, isAnonymous: true }, body("guest"))).toEqual({
      ok: true,
    });
    expect(feedback[0]).toMatchObject({ audience: "guest", user_id: GUEST });
  });

  it("6.2: on ne se fait pas passer pour un autre public ni pour un autre événement", async () => {
    const { admin, feedback } = world();
    const notFound = { ok: false, status: 404, code: "not_found" };
    // A guest claiming to be the organiser; a stranger as organiser; a stranger as guest.
    expect(
      await submitFeedback(admin, { id: GUEST, isAnonymous: true }, body("organiser")),
    ).toEqual(notFound);
    expect(
      await submitFeedback(admin, { id: STRANGER, isAnonymous: false }, body("organiser")),
    ).toEqual(notFound);
    expect(await submitFeedback(admin, { id: STRANGER, isAnonymous: true }, body("guest"))).toEqual(
      notFound,
    );
    // The owner's anonymous-flagged session never counts as an organiser.
    expect(
      await submitFeedback(admin, { id: OWNER, isAnonymous: true }, body("organiser")),
    ).toEqual(notFound);
    expect(feedback).toEqual([]);
  });

  it("6.2: un événement inconnu répond comme un événement qui n'est pas à soi", async () => {
    const { admin } = world();
    expect(
      await submitFeedback(
        admin,
        { id: OWNER, isAnonymous: false },
        { ...body("organiser"), eventCode: "zzzzzzzzzz" },
      ),
    ).toEqual({ ok: false, status: 404, code: "not_found" });
  });
});

describe("6.2: liste et traitement", () => {
  it("6.2: la liste envoie la taille et le décalage de page ; le traitement, l'administrateur et l'état", async () => {
    const calls: Record<string, Row> = {};
    const admin = fakeAdmin(
      {},
      {
        admin_list_feedback: (args) => {
          calls.list = args;
          return { total: 0, open: 0, average: 0, rows: [] };
        },
        admin_set_feedback_handled: (args) => {
          calls.handled = args;
          return { ok: true };
        },
      },
    );
    await listFeedback(admin, 2);
    expect(calls.list).toEqual({ p_limit: 25, p_offset: 25 });
    expect(await setFeedbackHandled(admin, OWNER, "f1", true)).toEqual({ ok: true });
    expect(calls.handled).toEqual({ p_actor: OWNER, p_id: "f1", p_handled: true });
  });
});

describe("6.2: l'avis du jour pour les administrateurs", () => {
  function digest(options: { feedback: Row[]; audit?: Row[] }) {
    const audit = options.audit ?? [];
    const admin = fakeAdmin(
      { feedback: options.feedback, audit_log: audit },
      {
        admin_contacts: () => [
          { email: "dao@example.test", locale: "fr" },
          { email: "ops@example.test", locale: "en" },
        ],
        admin_list_feedback: () => ({ total: 3, open: 2, average: 4.5, rows: [] }),
      },
    );
    const sent: OutgoingEmail[] = [];
    const mailer: Mailer = {
      name: "console",
      async send(email) {
        sent.push(email);
      },
      async sendMany(emails) {
        sent.push(...emails);
      },
    };
    return { audit, sent, run: () => sendFeedbackDigest({ admin, mailer }) };
  }

  it("6.2: rien de nouveau, rien d'envoyé", async () => {
    const { run, sent, audit } = digest({ feedback: [] });
    expect(await run()).toEqual({ result: "skipped", count: 0 });
    const handled = digest({
      feedback: [
        { id: "a", created_at: "2026-10-22T08:00:00Z", handled_at: "2026-10-22T09:00:00Z" },
      ],
    });
    expect(await handled.run()).toEqual({ result: "skipped", count: 0 });
    expect([...sent, ...handled.sent, ...audit, ...handled.audit]).toEqual([]);
  });

  it("6.2: des avis non traités : une trace, puis un e-mail par administrateur dans sa langue", async () => {
    const { run, sent, audit } = digest({
      feedback: [
        { id: "a", created_at: "2026-10-22T08:00:00Z", handled_at: null },
        { id: "b", created_at: "2026-10-22T09:00:00Z", handled_at: null },
      ],
    });
    expect(await run()).toEqual({ result: "sent", count: 2 });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "admin.feedback_digest", metadata: { count: 2 } });
    expect(sent.map((email) => email.to)).toEqual(["dao@example.test", "ops@example.test"]);
    expect(sent[0]?.subject).toBe("Nouveaux avis sur Snapalbum");
    expect(sent[1]?.subject).toBe("New feedback on Snapalbum");
    expect(sent[0]?.text).toContain("/admin/feedback");
    expect(sent[0]?.text).toContain("4,5");
    expect(sent[1]?.text).toContain("4.5");
  });

  it("6.2: seuls les avis arrivés depuis le dernier envoi comptent", async () => {
    const { run, sent } = digest({
      feedback: [
        { id: "old", created_at: "2026-10-21T08:00:00Z", handled_at: null },
        { id: "new", created_at: "2026-10-22T08:00:00Z", handled_at: null },
      ],
      audit: [{ action: "admin.feedback_digest", created_at: "2026-10-21T20:00:00Z" }],
    });
    expect(await run()).toEqual({ result: "sent", count: 1 });
    expect(sent).toHaveLength(2);
  });
});
