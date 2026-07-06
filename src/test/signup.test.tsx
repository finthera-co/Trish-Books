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

// Signup now provisions the tenant + user via a single server-side RPC
// (signup_provision) instead of client-side inserts, so we only mock rpc().
const mockSignUp = vi.fn();
const mockRpc = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { signUp: (...args: any[]) => mockSignUp(...args) },
    rpc: (...args: any[]) => mockRpc(...args),
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
    mockRpc.mockResolvedValue({ data: "tenant-789", error: null });
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

  describe("Provisioning", () => {
    it("calls signup_provision with the company and name, not client-side inserts", async () => {
      renderSignup();
      fillForm({ firstName: "Jane", lastName: "Doe", company: "Acme Inc" });
      fireEvent.submit(screen.getByRole("button", { name: /create account/i }));

      await waitFor(() => {
        expect(mockRpc).toHaveBeenCalledWith(
          "signup_provision",
          expect.objectContaining({
            p_company_name: "Acme Inc",
            p_first_name: "Jane",
            p_last_name: "Doe",
          })
        );
      });
    });

    it("shows an error toast and does not navigate when provisioning fails", async () => {
      mockSignUp.mockResolvedValueOnce({ data: { user: { id: "user-123" } }, error: null });
      mockRpc.mockResolvedValueOnce({ data: null, error: { message: "User already provisioned" } });

      renderSignup();
      fillForm();
      fireEvent.submit(screen.getByRole("button", { name: /create account/i }));

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith("User already provisioned");
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
