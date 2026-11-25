import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Category, Commune } from "@/lib/listings";
import { ListingForm } from "./listing-form";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh: vi.fn() }),
}));

// jsdom has no WebGL: the map is replaced by a button that moves the pin.
vi.mock("next/dynamic", () => ({
  default: () =>
    function FakeMap({
      onMoved,
    }: {
      onMoved: (point: { lat: number; lng: number }) => void;
    }) {
      return (
        <button
          type="button"
          onClick={() => onMoved({ lat: 6.2001, lng: 1.2002 })}
        >
          Déplacer l&apos;épingle
        </button>
      );
    },
}));

const communes: Commune[] = [
  {
    id: "c-an3",
    slug: "agoe-nyive-3",
    name: "Agoè-Nyivé 3",
    prefecture: "Agoè-Nyivé",
  },
  { id: "c-g1", slug: "golfe-1", name: "Golfe 1", prefecture: "Golfe" },
];
const categories: Category[] = [
  {
    id: "cat-rep",
    slug: "reparation",
    name: "Réparation",
    applicableTo: "BUSINESS",
  },
  {
    id: "cat-ecole",
    slug: "etablissement-scolaire",
    name: "École",
    applicableTo: "COMMUNITY",
  },
];

function json(status: number, body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("ListingForm", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    replace.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("navigator", {
      geolocation: {
        getCurrentPosition: (success: PositionCallback) =>
          success({
            coords: { latitude: 6.1725, longitude: 1.2314, accuracy: 9 },
            timestamp: Date.UTC(2026, 10, 21, 9, 30),
          } as GeolocationPosition),
      },
    });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("creates a draft on the spot: position, proposed commune, details (sprint criterion)", async () => {
    fetchMock
      .mockReturnValueOnce(
        json(200, { commune: { id: "c-an3" }, method: "inside" }),
      )
      .mockReturnValueOnce(json(201, { listing: { id: "listing-1" } }));
    render(<ListingForm communes={communes} categories={categories} />);

    fireEvent.click(screen.getByText("Je suis devant mon activité"));
    fireEvent.click(
      screen.getByRole("button", { name: "Relever ma position ici" }),
    );

    expect((await screen.findByRole("status")).textContent).toContain(
      "Commune proposée : Agoè-Nyivé 3",
    );
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/v1/communes/locate?lat=6.1725&lng=1.2314",
    );
    // Proposed, and still editable in the list (ADR-044).
    expect((screen.getByLabelText("Commune") as HTMLSelectElement).value).toBe(
      "c-an3",
    );

    // Nothing is sent until the pin is confirmed on the map (ADR-041).
    fireEvent.click(
      screen.getByRole("button", { name: "Enregistrer le brouillon" }),
    );
    expect(screen.getByText(/Vérifiez l'épingle sur la carte/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Oui, c'est ici" }));

    fireEvent.change(screen.getByLabelText("Catégorie"), {
      target: { value: "cat-rep" },
    });
    fireEvent.change(screen.getByLabelText("Nom"), {
      target: { value: "Réparation Kossi" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Enregistrer le brouillon" }),
    );

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/pro/fiches/listing-1"),
    );
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/api/v1/pro/listings");
    expect(JSON.parse(init.body as string)).toMatchObject({
      entityType: "BUSINESS",
      categoryId: "cat-rep",
      name: "Réparation Kossi",
      location: {
        type: "FIXED",
        communeId: "c-an3",
        point: { lat: 6.1725, lng: 1.2314 },
        source: "DEVICE_GPS",
        accuracyM: 9,
        servedCommuneIds: [],
      },
    });
  });

  it("places the pin by hand, without any GPS position", async () => {
    fetchMock
      .mockReturnValueOnce(json(200, { commune: { id: "c-g1" } }))
      .mockReturnValueOnce(json(201, { listing: { id: "listing-3" } }));
    render(<ListingForm communes={communes} categories={categories} />);
    fireEvent.click(screen.getByText("Je suis devant mon activité"));
    fireEvent.click(
      screen.getByRole("button", { name: "Placer moi-même sur la carte" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Déplacer l'épingle" }));
    await screen.findByText(/Commune proposée : Golfe 1/);
    // A choice in the list survives the confirmation of the pin.
    fireEvent.change(screen.getByLabelText("Commune"), {
      target: { value: "c-an3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Oui, c'est ici" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Enregistrer le brouillon" }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(
      JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)
        .location,
    ).toMatchObject({
      communeId: "c-an3",
      point: { lat: 6.2001, lng: 1.2002 },
      source: "MANUAL_PIN",
      accuracyM: null,
      capturedAt: null,
    });
  });

  it("calls a GPS position moved by hand a manual pin, to confirm again", async () => {
    fetchMock.mockImplementation(() => json(200, { commune: { id: "c-an3" } }));
    render(<ListingForm communes={communes} categories={categories} />);
    fireEvent.click(screen.getByText("Je suis devant mon activité"));
    fireEvent.click(
      screen.getByRole("button", { name: "Relever ma position ici" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Oui, c'est ici" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Déplacer l'épingle" }));
    expect(await screen.findByText("Épingle placée à la main.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Oui, c'est ici" })).toBeTruthy();
  });

  it("never shows a map for a home: its area is not sent to the tile server", async () => {
    fetchMock.mockImplementation(() => json(200, { commune: { id: "c-an3" } }));
    render(<ListingForm communes={communes} categories={categories} />);
    fireEvent.click(screen.getByText("Je travaille à domicile"));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Relever la position de mon domicile",
      }),
    );
    await screen.findByRole("status");
    expect(screen.queryByText("Déplacer l'épingle")).toBeNull();
    expect(screen.queryByText(/carte/)).toBeNull();
  });

  it("asks for the communes served by a mobile activity, without a position", async () => {
    fetchMock.mockReturnValueOnce(json(201, { listing: { id: "listing-2" } }));
    render(<ListingForm communes={communes} categories={categories} />);

    fireEvent.click(screen.getByText("Je me déplace chez mes clients"));
    expect(screen.queryByRole("button", { name: /Relever/ })).toBeNull();
    fireEvent.change(screen.getByLabelText("Commune où vous êtes basé"), {
      target: { value: "c-g1" },
    });
    fireEvent.click(screen.getAllByRole("checkbox")[1]);
    fireEvent.click(
      screen.getByRole("button", { name: "Enregistrer le brouillon" }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(
      JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
        .location,
    ).toMatchObject({
      type: "MOBILE",
      point: null,
      servedCommuneIds: ["c-g1"],
    });
  });

  it("shows the API's message next to the field it concerns", async () => {
    fetchMock.mockReturnValueOnce(
      json(400, {
        message: "Vérifiez les champs indiqués.",
        fields: { name: "Indiquez le nom (2 à 120 caractères)." },
      }),
    );
    render(<ListingForm communes={communes} categories={categories} />);
    fireEvent.click(screen.getByText("Je travaille à domicile"));
    fireEvent.click(
      screen.getByRole("button", { name: "Enregistrer le brouillon" }),
    );

    expect(
      await screen.findByText("Indiquez le nom (2 à 120 caractères)."),
    ).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it("offers only the categories of the chosen kind of listing", () => {
    render(<ListingForm communes={communes} categories={categories} />);
    fireEvent.click(screen.getByText("Je travaille à domicile"));
    const options = () =>
      Array.from(
        (screen.getByLabelText("Catégorie") as HTMLSelectElement).options,
      ).map((option) => option.text);
    expect(options()).toEqual(["Choisissez…", "Réparation"]);
    fireEvent.click(screen.getByLabelText(/Lieu communautaire/));
    expect(options()).toEqual(["Choisissez…", "École"]);
  });
});
