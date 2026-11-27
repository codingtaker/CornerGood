import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReportForm } from "./report-form";

describe("ReportForm", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    render(<ReportForm slug="atelier-afi-4f9k2a" />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Signaler une erreur sur cette fiche",
      }),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("sends the reason, the message and the optional contact", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: "r1" }), { status: 201 }),
    );
    fireEvent.click(screen.getByLabelText("L'activité a fermé"));
    fireEvent.change(screen.getByLabelText("Expliquez en quelques mots"), {
      target: { value: "Fermé depuis un mois." },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Envoyer le signalement" }),
    );
    expect(await screen.findByText(/Merci/)).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/listings/atelier-afi-4f9k2a/reports");
    expect(JSON.parse(init.body as string)).toEqual({
      reason: "CLOSED",
      description: "Fermé depuis un mois.",
      reporterContact: "",
    });
  });

  it("shows why the API refused the report", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          message: "Vérifiez les champs indiqués.",
          fields: { reason: "Choisissez ce qui ne va pas." },
        }),
        { status: 400 },
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Envoyer le signalement" }),
    );
    expect(
      await screen.findByText("Choisissez ce qui ne va pas."),
    ).toBeTruthy();
    expect(screen.queryByText(/Merci/)).toBeNull();
  });
});
