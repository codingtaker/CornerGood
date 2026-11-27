import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PasswordResetForm } from "./password-reset-form";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh: vi.fn() }),
}));

describe("PasswordResetForm", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    replace.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    render(<PasswordResetForm />);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("uses a code given by the team, without asking for an SMS", async () => {
    fireEvent.change(screen.getByLabelText("Numéro de téléphone"), {
      target: { value: "97 80 00 01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "J'ai déjà un code" }));
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ user: {} }), { status: 200 }),
    );
    fireEvent.change(screen.getByLabelText(/Code reçu/), {
      target: { value: "042137" },
    });
    fireEvent.change(screen.getByLabelText(/Nouveau mot de passe/), {
      target: { value: "mot de passe tout neuf" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Changer mon mot de passe" }),
    );
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/pro"));
    // One call only: the reset, no SMS requested.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/auth/password-reset");
    expect(JSON.parse(init.body as string)).toEqual({
      phone: "97 80 00 01",
      code: "042137",
      password: "mot de passe tout neuf",
    });
  });

  it("asks for the number first", () => {
    fireEvent.click(screen.getByRole("button", { name: "J'ai déjà un code" }));
    expect(screen.getByRole("alert").textContent).toMatch(/numéro/);
    expect(screen.queryByLabelText(/Code reçu/)).toBeNull();
  });
});
