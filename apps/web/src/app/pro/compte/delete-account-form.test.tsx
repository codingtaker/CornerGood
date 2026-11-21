import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeleteAccountForm } from "./delete-account-form";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh: vi.fn() }),
}));

describe("DeleteAccountForm", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    replace.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const typePassword = () =>
    fireEvent.change(screen.getByLabelText("Votre mot de passe"), {
      target: { value: "mon mot de passe" },
    });
  const submit = () =>
    fireEvent.click(
      screen.getByRole("button", {
        name: "Supprimer définitivement mon compte",
      }),
    );

  it("deletes nothing until the box is ticked", async () => {
    render(<DeleteAccountForm />);
    typePassword();
    submit();

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Cochez la case pour confirmer la suppression.",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends DELETE with the password, then shows the confirmation page", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    render(<DeleteAccountForm />);
    typePassword();
    fireEvent.click(screen.getByRole("checkbox"));
    submit();

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/compte-supprime"),
    );
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/auth/me");
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(init.body as string)).toEqual({
      password: "mon mot de passe",
    });
  });
});
