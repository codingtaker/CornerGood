import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResetCodeForm } from "./reset-code-form";

describe("ResetCodeForm", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    render(<ResetCodeForm />);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const ask = (phone: string) => {
    fireEvent.change(screen.getByLabelText("Numéro du professionnel"), {
      target: { value: phone },
    });
    fireEvent.click(screen.getByRole("button", { name: "Créer un code" }));
  };

  it("shows the code once, with the name to check", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "042137",
          expiresAt: "2026-11-27T10:00:00.000Z",
          fullName: "Kossi Oublieux",
        }),
        { status: 201 },
      ),
    );
    ask("97 80 00 01");
    expect(await screen.findByText("042137")).toBeTruthy();
    expect(screen.getByText(/Kossi Oublieux/)).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/admin/password-reset-codes");
    expect(JSON.parse(init.body as string)).toEqual({ phone: "97 80 00 01" });
  });

  it("says when no professional has this number", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          message: "Aucun compte professionnel actif ne porte ce numéro.",
        }),
        { status: 404 },
      ),
    );
    ask("97 80 00 99");
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /Aucun compte/,
    );
    expect(screen.queryByRole("status")).toBeNull();
  });
});
