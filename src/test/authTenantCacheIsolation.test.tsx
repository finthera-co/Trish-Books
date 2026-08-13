import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Cached server state belongs to whoever was signed in when it was fetched.
 *
 * Most query keys in this app are not tenant-scoped, so if the cache outlives a
 * change of user, the next person is served the previous tenant's rows. That is
 * not theoretical: tenant B's petty cash screen offered tenant A's
 * "6420 Vehicle Repair" — both tenants have that exact code and name, so the
 * suggestion looked entirely plausible and only the database's own tenant check
 * refused the write.
 */

type AuthCallback = (event: string, session: unknown) => void;

let authCallback: AuthCallback | null = null;
const mockGetSession = vi.fn();
const mockSignOut = vi.fn().mockResolvedValue({ error: null });

function session(userId: string) {
  return { user: { id: userId, email: `${userId}@example.com` }, access_token: "t" };
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: AuthCallback) => {
        authCallback = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
      getSession: () => mockGetSession(),
      signOut: () => mockSignOut(),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: {
                id: "u1",
                auth_user_id: "user-a",
                tenant_id: "tenant-a",
                email: "a@example.com",
                first_name: "A",
                last_name: "A",
                roles: { role_name: "Company Admin" },
                is_primary: false,
              },
              error: null,
            }),
        }),
      }),
    }),
  },
}));

vi.mock("@/hooks/useDraftPersistence", () => ({ clearAllFintheraDrafts: vi.fn() }));
vi.mock("@/hooks/useIdleLogout", () => ({ useIdleLogout: vi.fn() }));
vi.mock("@/lib/browserSession", () => ({ setSignOutReason: vi.fn() }));

const { AuthProvider } = await import("@/contexts/AuthContext");

describe("auth / query cache tenant isolation", () => {
  let qc: QueryClient;
  let clearSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    authCallback = null;
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    clearSpy = vi.spyOn(qc, "clear");
    mockGetSession.mockResolvedValue({ data: { session: null } });

    render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <div>app</div>
        </AuthProvider>
      </QueryClientProvider>,
    );
  });

  it("drops the cache when a different user signs in to the same tab", async () => {
    await waitFor(() => expect(authCallback).toBeTruthy());

    authCallback!("SIGNED_IN", session("user-a"));
    await waitFor(() => expect(clearSpy).not.toHaveBeenCalled());

    // Same user again — a token refresh must NOT wipe the cache, or every
    // background refresh would blow away the whole app's loaded state.
    authCallback!("TOKEN_REFRESHED", session("user-a"));
    await new Promise((r) => setTimeout(r, 20));
    expect(clearSpy).not.toHaveBeenCalled();

    // A genuinely different person: the previous tenant's rows must go.
    authCallback!("SIGNED_IN", session("user-b"));
    await waitFor(() => expect(clearSpy).toHaveBeenCalled());
  });
});
