import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createBrowserClient = vi.fn(() => ({ kind: "browser" }));
const createServerClient = vi.fn((..._args: unknown[]) => ({ kind: "server" }));
const createClient = vi.fn((..._args: unknown[]) => ({ kind: "admin" }));

vi.mock("@supabase/ssr", () => ({ createBrowserClient, createServerClient }));
vi.mock("@supabase/supabase-js", () => ({ createClient }));

const cookieStore = {
  getAll: vi.fn(() => [{ name: "sb-token", value: "abc" }]),
  set: vi.fn(),
};
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("S-011: clients Supabase", () => {
  it("le client navigateur n'utilise que l'URL et la clé publique", async () => {
    const { createSupabaseBrowserClient } = await import("@/lib/supabase/client");
    createSupabaseBrowserClient();
    expect(createBrowserClient).toHaveBeenCalledWith("http://127.0.0.1:54321", "test-anon-key");
  });

  it("le client serveur lit et écrit la session dans les cookies", async () => {
    const { createSupabaseServerClient } = await import("@/server/supabase/server");
    await createSupabaseServerClient();

    const options = createServerClient.mock.calls[0]?.[2] as {
      cookies: {
        getAll: () => unknown;
        setAll: (c: { name: string; value: string; options?: object }[]) => void;
      };
    };
    expect(options.cookies.getAll()).toEqual([{ name: "sb-token", value: "abc" }]);

    options.cookies.setAll([{ name: "sb-token", value: "def", options: { path: "/" } }]);
    expect(cookieStore.set).toHaveBeenCalledWith("sb-token", "def", { path: "/" });
  });

  it("le client serveur ignore l'écriture de cookies depuis un Server Component", async () => {
    cookieStore.set.mockImplementationOnce(() => {
      throw new Error("Cookies can only be modified in a Server Action or Route Handler");
    });
    const { createSupabaseServerClient } = await import("@/server/supabase/server");
    await createSupabaseServerClient();
    const options = createServerClient.mock.calls[0]?.[2] as {
      cookies: { setAll: (c: { name: string; value: string }[]) => void };
    };
    expect(() => options.cookies.setAll([{ name: "a", value: "b" }])).not.toThrow();
  });

  it("le client administrateur utilise la clé de service sans conserver de session", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    const { createSupabaseAdminClient } = await import("@/server/supabase/admin");
    createSupabaseAdminClient();
    expect(createClient).toHaveBeenCalledWith("http://127.0.0.1:54321", "service-key", {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  });

  it("le client administrateur refuse de démarrer sans clé de service", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const { createSupabaseAdminClient } = await import("@/server/supabase/admin");
    expect(() => createSupabaseAdminClient()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});
