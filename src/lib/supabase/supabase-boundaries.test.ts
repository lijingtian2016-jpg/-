import { beforeEach, describe, expect, it, vi } from "vitest";

const createBrowserClient = vi.fn();
const createServerClient = vi.fn();
const cookies = vi.fn();
const next = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createBrowserClient,
  createServerClient,
}));

vi.mock("next/headers", () => ({ cookies }));
vi.mock("next/server", () => ({
  NextResponse: { next },
}));

describe("Supabase client boundaries", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "example-anon-key";
  });

  it("creates a browser client from public environment variables", async () => {
    createBrowserClient.mockReturnValue({ kind: "browser" });

    const { createClient } = await import("./client");

    expect(createClient()).toEqual({ kind: "browser" });
    expect(createBrowserClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "example-anon-key",
    );
  });

  it("adapts the Next cookie store and tolerates writes in Server Components", async () => {
    const cookieStore = {
      getAll: vi.fn().mockReturnValue([{ name: "session", value: "old" }]),
      set: vi.fn(() => {
        throw new Error("Cookies can only be modified in a Server Action");
      }),
    };
    cookies.mockResolvedValue(cookieStore);
    createServerClient.mockReturnValue({ kind: "server" });

    const { createClient } = await import("./server");
    expect(await createClient()).toEqual({ kind: "server" });

    const options = createServerClient.mock.calls[0][2];
    expect(options.cookies.getAll()).toEqual([{ name: "session", value: "old" }]);
    expect(() =>
      options.cookies.setAll([
        { name: "session", value: "new", options: { path: "/" } },
      ]),
    ).not.toThrow();
  });

  it("refreshes auth and propagates middleware cookie writes", async () => {
    const requestCookies = {
      getAll: vi.fn().mockReturnValue([{ name: "session", value: "old" }]),
      set: vi.fn(),
    };
    const request = { cookies: requestCookies };
    const firstResponse = { cookies: { set: vi.fn() } };
    const refreshedResponse = { cookies: { set: vi.fn() } };
    next.mockReturnValueOnce(firstResponse).mockReturnValueOnce(refreshedResponse);
    const getUser = vi.fn().mockResolvedValue({ data: { user: null } });
    createServerClient.mockImplementation((_url, _key, options) => ({
      auth: {
        getUser: async () => {
          options.cookies.setAll([
            { name: "session", value: "new", options: { path: "/" } },
          ]);
          return getUser();
        },
      },
    }));

    const { updateSession } = await import("./middleware");
    const result = await updateSession(request as never);
    expect(requestCookies.set).toHaveBeenCalledWith("session", "new");
    expect(next).toHaveBeenLastCalledWith({ request });
    expect(refreshedResponse.cookies.set).toHaveBeenCalledWith(
      "session",
      "new",
      { path: "/" },
    );
    expect(getUser).toHaveBeenCalledOnce();
    expect(result).toBe(refreshedResponse);
  });
});
