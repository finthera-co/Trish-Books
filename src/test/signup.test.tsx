import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Signup from "@/pages/Signup";

// ── Mocks ──

const mockNavigate = vi.fn();

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockToastError = vi.fn();
const mockToastSuccess = vi.fn();

vi.mock("sonner", () => ({
  toast: { error: (msg: string) => mockToastError(msg), success: (msg: string) => mockToastSuccess(msg) },
}));

// Build a chainable supabase mock
const mockSingle = vi.fn();
const mockSelect = vi.fn(() => ({ eq: vi.fn(() => ({ single: mockSingle })) }));
const mockFromInsert = vi.fn(() => ({ select: vi.fn(() => ({ single: mockSingle })) }));
const mockFrom = vi.fn((table: string) =>
  table === "tenants" ? { insert: mockFromInsert } : { select: mockSelect, insert: mockFromInsert }
);
const mockSignUp = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { signUp: (...args: any[]) => mockSignUp(...args) },
    from: (...args: any[]) => mockFrom(...args),
  },
}));

// AuthContext — Signup page only uses signUp from context (not used in the component directly)
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ signUp: vi.fn() }),
}));

// ── Helpers ──

function renderSignup() {
  return render(
    <MemoryRouter>
      <Signup />
    </MemoryRouter>
  );
}

function fillForm({
  firstName = "Jane",
  lastName = "Doe",
  company = "Acme Inc",
  email = "jane@acme.com",
  password = "password123",
} = {}) {
  fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: firstName } });
  fireEvent.change(screen.getAllByRole("textbox")[1], { target: { value: lastName } });
  fireEvent.change(screen.getAllByRole("textbox")[2], { target: { value: company } });
  fireEvent.change(screen.getAllByRole("textbox")[3], { target: { value: email } });
  // password input is type="password", not a textbox role
  fireEvent.change(screen.getByPlaceholderText("••••••••"), { target: { value: password } });
}

// ── Tests ──

describe("Signup page", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default happy-path supabase responses
    mockSignUp.mockResolvedValue({ data: { user: { id: "user-123" } }, error: null });
    mockSingle
      .mockResolvedValueOnce({ data: { id: "plan-456" }, error: null })   // subscription_plans
      .mockResolvedValueOnce({ data: { id: "tenant-789" }, error: null }) // tenants insert
      .mockResolvedValueOnce({ data: { id: "role-101" }, error: null });  // roles
    mockFromInsert.mockReturnValue({ select: vi.fn(() => ({ single: mockSingle })) });
    mockFrom.mockImplementation((table: string) => {
      if (table === "tenants") return { insert: mockFromInsert };
      if (table === "users") return { insert: vi.fn().mockResolvedValue({ error: null }) };
      return { select: mockSelect };
    });
  });

  describe("Rendering", () => {
    it("shows all required form fields", () => {
      renderSignup();
      expect(screen.getByText("First Name")).toBeInTheDocument();
      expect(screen.getByText("Last Name")).toBeInTheDocument();
      expect(screen.getByText("Company Name")).toBeInTheDocument();
      expect(screen.getByText("Email")).toBeInTheDocument();
      expect(screen.getByText("Password")).toBeInTheDocument();
    });

    it("shows the create account button", () => {
      renderSignup();
      expect(screen.getByRole("button", { name: /create account/i })).toBeInTheDocument();
    });

    it("shows a link back to login", () => {
      renderSignup();
      expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute("href", "/login");
    });
  });

  describe("Successful signup", () => {
    it("calls supabase.auth.signUp with the entered credentials", async () => {
      renderSignup();
      fillForm({ email: "jane@acme.com", password: "password123" });
      fireEvent.submit(screen.getByRole("button", { name: /create account/i }));

      await waitFor(() => {
        expect(mockSignUp).toHaveBeenCalledWith(
          expect.objectContaining({ email: "jane@acme.com", password: "password123" })
        );
      });
    });

    it("shows a success toast and navigates to /login", async () => {
      renderSignup();
      fillForm();
      fireEvent.submit(screen.getByRole("button", { name: /create account/i }));

      await waitFor(() => {
        expect(mockToastSuccess).toHaveBeenCalledWith(
          "Account created! Please check your email to verify."
        );
        expect(mockNavigate).toHaveBeenCalledWith("/login");
      });
    });
  });

  describe("Failed signup — auth error", () => {
    it("shows an error toast when supabase.auth.signUp fails", async () => {
      mockSignUp.mockResolvedValueOnce({
        data: { user: null },
        error: { message: "Email already registered" },
      });
      renderSignup();
      fillForm({ email: "existing@acme.com" });
      fireEvent.submit(screen.getByRole("button", { name: /create account/i }));

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith("Email already registered");
        expect(mockNavigate).not.toHaveBeenCalled();
      });
    });

    it("shows an error toast when no user is returned from signUp", async () => {
      mockSignUp.mockResolvedValueOnce({ data: { user: null }, error: null });
      renderSignup();
      fillForm();
      fireEvent.submit(screen.getByRole("button", { name: /create account/i }));

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith("Signup failed");
      });
    });
  });

  describe("Failed signup — database error", () => {
    it("shows an error toast when tenant creation fails", async () => {
      mockSignUp.mockResolvedValueOnce({ data: { user: { id: "user-123" } }, error: null });

      // plan fetch succeeds, tenant insert fails
      mockFrom.mockImplementation((table: string) => {
        if (table === "subscription_plans") {
          return { select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: { id: "plan-1" }, error: null }) })) })) };
        }
        if (table === "tenants") {
          return {
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({ data: null, error: { message: "DB error creating tenant" } }),
              })),
            })),
          };
        }
        return { select: mockSelect, insert: mockFromInsert };
      });

      renderSignup();
      fillForm();
      fireEvent.submit(screen.getByRole("button", { name: /create account/i }));

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith("DB error creating tenant");
        expect(mockNavigate).not.toHaveBeenCalled();
      });
    });
  });

  describe("Loading state", () => {
    it("disables the button and shows loading text while submitting", async () => {
      let resolveSignUp!: (v: any) => void;
      mockSignUp.mockReturnValueOnce(new Promise((r) => (resolveSignUp = r)));

      renderSignup();
      fillForm();
      fireEvent.submit(screen.getByRole("button", { name: /create account/i }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /creating account/i })).toBeDisabled();
      });

      resolveSignUp({ data: { user: null }, error: { message: "cancelled" } });
    });
  });
});
