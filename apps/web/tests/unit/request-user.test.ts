// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieGetUser = vi.fn();
vi.mock("@/server/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: cookieGetUser } }),
}));

const tokenGetUser = vi.fn();
const createClient = vi.fn((..._args: unknown[]) => ({ auth: { getUser: tokenGetUser } }));
vi.mock("@supabase/supabase-js", () => ({ createClient }));

const { getRequestUser } = await import("@/server/request-user");

const request = (headers: Record<string, string> = {}) =>
  new Request("https://app.example.test/api/uploads/reserve", { method: "POST", headers });

beforeEach(() => {
  vi.clearAllMocks();
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
