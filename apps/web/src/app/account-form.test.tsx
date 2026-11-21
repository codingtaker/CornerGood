import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountForm } from "./account-form";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh: vi.fn() }),
}));

function answer(status: number, body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("AccountForm, sign-in", () => {
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

  const fill = () => {
    fireEvent.change(screen.getByPlaceholderText("90 12 34 56"), {
      target: { value: "90 12 34 56" },
    });
    fireEvent.change(screen.getByLabelText("Mot de passe"), {
      target: { value: "mon mot de passe" },
    });
  };

  it("posts JSON to the API and opens the next page", async () => {
    fetchMock.mockReturnValue(answer(200, { user: {} }));
    render(<AccountForm mode="login" next="/pro" />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Se connecter" }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/pro"));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/auth/login");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({
      phone: "90 12 34 56",
      password: "mon mot de passe",
    });
  });

  it("offers a code by SMS when the number is blocked, then sends it with the sign-in", async () => {
    fetchMock
      .mockReturnValueOnce(
        answer(429, {
          message: "Trop de tentatives. Réessayez dans 4 minutes.",
          unlockBySms: true,
        }),
      )
      .mockReturnValueOnce(
        answer(202, { message: "Si ce numéro a un compte, un code vient…" }),
      )
      .mockReturnValueOnce(answer(200, { user: {} }));
    render(<AccountForm mode="login" next="/pro" />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Se connecter" }));

    const offer = await screen.findByRole("button", {
      name: "Recevoir un code par SMS pour me connecter",
    });
    expect(screen.getByRole("alert").textContent).toContain(
      "Trop de tentatives",
    );
    fireEvent.click(offer);

    const code = await screen.findByLabelText("Code reçu par SMS");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/v1/auth/otp");
    expect(
      JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string),
    ).toEqual({ phone: "90 12 34 56", purpose: "LOGIN_UNLOCK" });

    fireEvent.change(code, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Se connecter" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/pro"));
    expect(
      JSON.parse((fetchMock.mock.calls[2][1] as RequestInit).body as string),
    ).toMatchObject({ code: "123456" });
  });

  it("shows the API's message, without the SMS offer, for a wrong password", async () => {
    fetchMock.mockReturnValue(
      answer(401, { message: "Numéro ou mot de passe incorrect." }),
    );
    render(<AccountForm mode="login" next="/pro" />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Se connecter" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Numéro ou mot de passe incorrect.",
    );
    expect(
      screen.queryByRole("button", { name: /Recevoir un code/ }),
    ).toBeNull();
  });
});
