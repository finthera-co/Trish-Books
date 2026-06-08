import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Login from "@/pages/Login";

// ── Mocks ──

const mockSignIn = vi.fn();
const mockNavigate = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ signIn: mockSignIn }),
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockToastError = vi.fn();
const mockToastSuccess = vi.fn();

vi.mock("sonner", () => ({
  toast: { error: (msg: string) => mockToastError(msg), success: (msg: string) => mockToastSuccess(msg) },
}));

// ── Helpers ──

function renderLogin() {
  return render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>
  );
}

// ── Tests ──

describe("Login page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Rendering", () => {
    it("shows the email and password inputs", () => {
      renderLogin();
      expect(screen.getByPlaceholderText("Enter Your Email Address")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("Your Password")).toBeInTheDocument();
    });

    it("shows the submit button", () => {
      renderLogin();
      expect(screen.getByRole("button", { name: /log in with email/i })).toBeInTheDocument();
    });

    it("shows a link to the signup page", () => {
      renderLogin();
      expect(screen.getByRole("link", { name: /sign up/i })).toHaveAttribute("href", "/signup");
    });
  });

  describe("Password visibility toggle", () => {
    it("starts with password hidden", () => {
      renderLogin();
      expect(screen.getByPlaceholderText("Your Password")).toHaveAttribute("type", "password");
    });

    it("reveals password when the toggle is clicked", () => {
      renderLogin();
      const toggle = screen.getByRole("button", { name: "" }); // eye icon button has no text
      fireEvent.click(toggle);
      expect(screen.getByPlaceholderText("Your Password")).toHaveAttribute("type", "text");
    });

    it("hides password again on second click", () => {
      renderLogin();
      const toggle = screen.getByRole("button", { name: "" });
      fireEvent.click(toggle);
      fireEvent.click(toggle);
      expect(screen.getByPlaceholderText("Your Password")).toHaveAttribute("type", "password");
    });
  });

  describe("Successful login", () => {
    it("calls signIn with the entered credentials", async () => {
      mockSignIn.mockResolvedValueOnce({ error: null });
      renderLogin();

      fireEvent.change(screen.getByPlaceholderText("Enter Your Email Address"), {
        target: { value: "user@example.com" },
      });
      fireEvent.change(screen.getByPlaceholderText("Your Password"), {
        target: { value: "secret123" },
      });
      fireEvent.submit(screen.getByRole("button", { name: /log in with email/i }));

      await waitFor(() => {
        expect(mockSignIn).toHaveBeenCalledWith("user@example.com", "secret123");
      });
    });

    it("shows a success toast and navigates to /", async () => {
      mockSignIn.mockResolvedValueOnce({ error: null });
      renderLogin();

      fireEvent.change(screen.getByPlaceholderText("Enter Your Email Address"), {
        target: { value: "user@example.com" },
      });
      fireEvent.change(screen.getByPlaceholderText("Your Password"), {
        target: { value: "secret123" },
      });
      fireEvent.submit(screen.getByRole("button", { name: /log in with email/i }));

      await waitFor(() => {
        expect(mockToastSuccess).toHaveBeenCalledWith("Welcome back!");
        expect(mockNavigate).toHaveBeenCalledWith("/");
      });
    });
  });

  describe("Failed login", () => {
    it("shows an error toast when signIn returns an error", async () => {
      mockSignIn.mockResolvedValueOnce({ error: new Error("Invalid credentials") });
      renderLogin();

      fireEvent.change(screen.getByPlaceholderText("Enter Your Email Address"), {
        target: { value: "wrong@example.com" },
      });
      fireEvent.change(screen.getByPlaceholderText("Your Password"), {
        target: { value: "wrongpassword" },
      });
      fireEvent.submit(screen.getByRole("button", { name: /log in with email/i }));

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledWith("Invalid credentials");
        expect(mockNavigate).not.toHaveBeenCalled();
      });
    });
  });

  describe("Loading state", () => {
    it("disables the submit button while signing in", async () => {
      // Keep the promise pending so loading stays true
      let resolve!: (v: { error: null }) => void;
      mockSignIn.mockReturnValueOnce(new Promise((r) => (resolve = r)));
      renderLogin();

      fireEvent.change(screen.getByPlaceholderText("Enter Your Email Address"), {
        target: { value: "user@example.com" },
      });
      fireEvent.change(screen.getByPlaceholderText("Your Password"), {
        target: { value: "secret123" },
      });
      fireEvent.submit(screen.getByRole("button", { name: /log in with email/i }));

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /signing in/i })).toBeDisabled();
      });

      resolve({ error: null });
    });
  });
});
