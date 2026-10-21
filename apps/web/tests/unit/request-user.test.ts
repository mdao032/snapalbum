// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieGetUser = vi.fn();
vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: cookieGetUser } }),
}));

const tokenGetUser = vi.fn();
const createClient = vi.fn((..._args: unknown[]) => ({ auth: { getUser: tokenGetUser } }));
vi.mock("@supabase/supabase-js", () => ({ createClient }));

const { clearTokenCache, getRequestUser, TOKEN_CACHE_MAX_ENTRIES, TOKEN_CACHE_TTL_MS } =
  await import("@/server/request-user");

const request = (headers: Record<string, string> = {}) =>
  new Request("https://app.example.test/api/uploads/reserve", { method: "POST", headers });

beforeEach(() => {
  vi.clearAllMocks();
  clearTokenCache();
  vi.useRealTimers();
});

describe("F-035: qui appelle l'API", () => {
  it("F-035: le site web s'identifie par son cookie de session, vérifié auprès du serveur d'authentification", async () => {
    cookieGetUser.mockResolvedValue({
      data: { user: { id: "u1", is_anonymous: true } },
      error: null,
    });
    expect(await getRequestUser(request())).toEqual({ id: "u1", isAnonymous: true });
    expect(tokenGetUser).not.toHaveBeenCalled();
  });

  it("F-035: les applis envoient un jeton Bearer, vérifié lui aussi (jamais seulement décodé)", async () => {
    tokenGetUser.mockResolvedValue({
      data: { user: { id: "u2", is_anonymous: false } },
      error: null,
    });
    expect(await getRequestUser(request({ Authorization: "Bearer abc.def.ghi" }))).toEqual({
      id: "u2",
      isAnonymous: false,
    });
    expect(tokenGetUser).toHaveBeenCalledWith("abc.def.ghi");
    expect(cookieGetUser).not.toHaveBeenCalled();
    // The token client keeps nothing: no session cookie is ever written for an app.
    expect(createClient.mock.calls[0]?.[2]).toMatchObject({ auth: { persistSession: false } });
  });

  it("S-001: un jeton refusé, une session absente ou un utilisateur introuvable donnent null", async () => {
    tokenGetUser.mockResolvedValue({ data: { user: null }, error: { message: "invalid JWT" } });
    expect(await getRequestUser(request({ Authorization: "Bearer forged" }))).toBeNull();
    cookieGetUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await getRequestUser(request())).toBeNull();
    cookieGetUser.mockResolvedValue({ data: { user: null }, error: { message: "expired" } });
    expect(await getRequestUser(request())).toBeNull();
  });

  it("NF-011: une panne ou une surcharge du serveur d'authentification n'est pas un « non autorisé » (le client réessaiera)", async () => {
    for (const error of [
      { message: "overloaded", status: 429 },
      { message: "down", status: 503 },
      { message: "fetch failed", name: "AuthRetryableFetchError", status: 0 },
    ]) {
      tokenGetUser.mockResolvedValue({ data: { user: null }, error });
      await expect(getRequestUser(request({ Authorization: "Bearer abc" }))).rejects.toThrow(
        /Auth server unavailable/,
      );
    }
    // A refused token stays a plain "not signed in".
    tokenGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: "bad", status: 401 },
    });
    expect(await getRequestUser(request({ Authorization: "Bearer abc" }))).toBeNull();
  });

  it("S-001: un en-tête Authorization qui n'est pas Bearer est ignoré", async () => {
    cookieGetUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await getRequestUser(request({ Authorization: "Basic dXNlcjpwYXNz" }))).toBeNull();
    expect(tokenGetUser).not.toHaveBeenCalled();
  });

  it("un utilisateur sans l'indicateur anonyme n'est pas anonyme", async () => {
    cookieGetUser.mockResolvedValue({ data: { user: { id: "u3" } }, error: null });
    expect(await getRequestUser(request())).toEqual({ id: "u3", isAnonymous: false });
  });
});

/** A token shaped like a real one: its `exp` claim bounds the cache entry. */
const jwt = (exp: number, salt = "") =>
  `h.${Buffer.from(JSON.stringify({ exp, salt })).toString("base64url")}.s`;
const inOneHour = () => Math.floor(Date.now() / 1000) + 3600;
const bearer = (token: string) => request({ Authorization: `Bearer ${token}` });
const accept = (id = "u1") =>
  tokenGetUser.mockResolvedValue({ data: { user: { id, is_anonymous: true } }, error: null });
const refuse = (status: number) =>
  tokenGetUser.mockResolvedValue({ data: { user: null }, error: { message: "no", status } });

describe("S-001, NF-003: cache de courte durée des jetons Bearer déjà vérifiés", () => {
  it("S-001: un jeton vérifié n'est pas revérifié pendant la durée du cache, puis l'est", async () => {
    vi.useFakeTimers();
    accept();
    const token = jwt(inOneHour());
    expect(await getRequestUser(bearer(token))).toEqual({ id: "u1", isAnonymous: true });
    expect(await getRequestUser(bearer(token))).toEqual({ id: "u1", isAnonymous: true });
    expect(tokenGetUser).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(TOKEN_CACHE_TTL_MS + 1);
    await getRequestUser(bearer(token));
    expect(tokenGetUser).toHaveBeenCalledTimes(2);
  });

  it("S-001: un jeton refusé n'est jamais mis en cache : le suivant est revérifié", async () => {
    refuse(401);
    const token = jwt(inOneHour());
    expect(await getRequestUser(bearer(token))).toBeNull();
    accept();
    expect(await getRequestUser(bearer(token))).toEqual({ id: "u1", isAnonymous: true });
    expect(tokenGetUser).toHaveBeenCalledTimes(2);
  });

  it("S-001: une panne de l'Auth n'est pas mise en cache non plus", async () => {
    refuse(503);
    const token = jwt(inOneHour());
    await expect(getRequestUser(bearer(token))).rejects.toThrow();
    accept();
    expect(await getRequestUser(bearer(token))).toEqual({ id: "u1", isAnonymous: true });
  });

  it("S-001: un jeton forgé ne profite pas de l'entrée d'un jeton valide", async () => {
    accept("alice");
    const real = jwt(inOneHour(), "alice");
    await getRequestUser(bearer(real));
    refuse(401);
    // Same shape, one character more: it goes to the Auth server and is refused.
    expect(await getRequestUser(bearer(`${real}x`))).toBeNull();
    expect(tokenGetUser).toHaveBeenCalledTimes(2);
  });

  it("S-001: l'entrée ne dépasse pas l'expiration du jeton lui-même", async () => {
    vi.useFakeTimers();
    accept();
    const token = jwt(Math.floor(Date.now() / 1000) + 10);
    await getRequestUser(bearer(token));
    vi.advanceTimersByTime(11_000);
    await getRequestUser(bearer(token));
    expect(tokenGetUser).toHaveBeenCalledTimes(2);
  });

  it("S-001: un jeton déjà expiré n'est pas gardé", async () => {
    accept();
    const token = jwt(Math.floor(Date.now() / 1000) - 5);
    await getRequestUser(bearer(token));
    await getRequestUser(bearer(token));
    expect(tokenGetUser).toHaveBeenCalledTimes(2);
  });

  it("S-001: le cache est borné : le plus ancien jeton sort quand il est plein", async () => {
    accept();
    const first = jwt(inOneHour(), "first");
    await getRequestUser(bearer(first));
    for (let n = 0; n < TOKEN_CACHE_MAX_ENTRIES; n += 1) {
      await getRequestUser(bearer(jwt(inOneHour(), `n${n}`)));
    }
    tokenGetUser.mockClear();
    await getRequestUser(bearer(first));
    expect(tokenGetUser).toHaveBeenCalledTimes(1);
  });

  it("S-001: la session par cookie du site web n'est jamais mise en cache", async () => {
    cookieGetUser.mockResolvedValue({ data: { user: { id: "u9" } }, error: null });
    await getRequestUser(request());
    await getRequestUser(request());
    expect(cookieGetUser).toHaveBeenCalledTimes(2);
  });
});
