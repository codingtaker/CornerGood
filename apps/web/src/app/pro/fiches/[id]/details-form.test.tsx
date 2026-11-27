import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnListing } from "@/lib/listings";
import { DetailsForm } from "./details-form";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const listing: OwnListing = {
  id: "l1",
  name: "Atelier Afi",
  slug: "atelier-afi-4f9k2a",
  status: "DRAFT",
  entityType: "BUSINESS",
  category: { id: "cat", name: "Réparation" },
  description: null,
  phone: null,
  whatsapp: null,
  email: null,
  openingHours: null,
  services: [],
  rejection: null,
  location: null,
};

describe("DetailsForm", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    refresh.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    render(
      <DetailsForm
        listing={listing}
        categories={[
          {
            id: "cat",
            slug: "reparation",
            name: "Réparation",
            applicableTo: "BUSINESS",
          },
        ]}
      />,
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const answer = (status: number, body: unknown = {}) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));
  const click = (name: string) =>
    fireEvent.click(screen.getByRole("button", { name }));

  it("saves what is on the screen, then sends it", async () => {
    fetchMock.mockImplementation(() => answer(200));
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Réparation de téléphones" },
    });
    click("Envoyer pour validation");
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const calls = fetchMock.mock.calls as [string, RequestInit][];
    expect(calls.map(([url, init]) => [url, init.method])).toEqual([
      ["/api/v1/pro/listings/l1", "PATCH"],
      ["/api/v1/pro/listings/l1/submit", "POST"],
    ]);
    expect(JSON.parse(calls[0][1].body as string)).toMatchObject({
      name: "Atelier Afi",
      categoryId: "cat",
      description: "Réparation de téléphones",
    });
  });

  it("saves the email and the opening hours with the rest", async () => {
    fetchMock.mockImplementation(() => answer(200));
    fireEvent.change(screen.getByLabelText("E-mail (facultatif)"), {
      target: { value: "atelier@exemple.tg" },
    });
    fireEvent.change(screen.getByLabelText("Samedi : ouverture"), {
      target: { value: "closed" },
    });
    click("Enregistrer");
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      email: "atelier@exemple.tg",
      openingHours: { sat: [] },
    });
  });

  it("shows what is missing next to each field", async () => {
    fetchMock.mockReturnValueOnce(answer(200)).mockReturnValueOnce(
      answer(422, {
        message: "Complétez la fiche avant de l'envoyer.",
        fields: { description: "Décrivez…", phone: "Indiquez un numéro…" },
      }),
    );
    click("Envoyer pour validation");
    expect(await screen.findByText("Décrivez…")).toBeTruthy();
    expect(screen.getByText("Indiquez un numéro…")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Complétez");
  });

  it("does not send a listing that could not be saved", async () => {
    fetchMock.mockReturnValue(answer(400, { message: "Vérifiez" }));
    click("Envoyer pour validation");
    await screen.findByRole("alert");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("saves without sending", async () => {
    fetchMock.mockImplementation(() => answer(200));
    click("Enregistrer");
    expect((await screen.findByRole("status")).textContent).toBe(
      "Modifications enregistrées.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
