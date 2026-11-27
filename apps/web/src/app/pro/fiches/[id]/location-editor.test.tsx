import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Commune, OwnListing } from "@/lib/listings";
import { LocationEditor } from "./location-editor";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

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

const location: NonNullable<OwnListing["location"]> = {
  type: "FIXED",
  visibility: "PUBLIC",
  commune: { id: "c-an3", name: "Agoè-Nyivé 3" },
  point: { lat: 6.19, lng: 1.19 },
  accuracyM: 8,
  capturedAt: "2026-11-20T09:00:00.000Z",
  source: "DEVICE_GPS",
  addressHint: "Face à la pharmacie",
  servedCommunes: [],
};

describe("LocationEditor", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    refresh.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes("/communes/locate")
          ? new Response(JSON.stringify({ commune: { id: "c-g1" } }))
          : new Response(JSON.stringify({ listing: {} }), { status: 200 }),
      ),
    );
    render(
      <LocationEditor listingId="l1" location={location} communes={communes} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Modifier le lieu" }));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const sentPlace = () => {
    const call = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/location"),
    ) as [string, RequestInit];
    expect(call[0]).toBe("/api/v1/pro/listings/l1/location");
    expect(call[1].method).toBe("PUT");
    return (JSON.parse(call[1].body as string) as { location: object })
      .location;
  };

  it("keeps the saved reading when only the landmark changes", async () => {
    fireEvent.change(screen.getByDisplayValue("Face à la pharmacie"), {
      target: { value: "Derrière le marché" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Enregistrer le lieu" }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(sentPlace()).toEqual({
      type: "FIXED",
      communeId: "c-an3",
      point: { lat: 6.19, lng: 1.19 },
      source: "DEVICE_GPS",
      accuracyM: 8,
      capturedAt: "2026-11-20T09:00:00.000Z",
      addressHint: "Derrière le marché",
      servedCommuneIds: [],
    });
  });

  it("asks to confirm a moved pin, then proposes its commune", async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Placer moi-même sur la carte" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Déplacer l'épingle" }));
    // The commune of the new point is proposed.
    await waitFor(() =>
      expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe(
        "c-g1",
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Enregistrer le lieu" }),
    );
    expect(
      screen.getByText(/Oui, c'est ici/, { selector: "span" }),
    ).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith("/location")),
    ).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Oui, c'est ici" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Enregistrer le lieu" }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(sentPlace()).toMatchObject({
      communeId: "c-g1",
      point: { lat: 6.2001, lng: 1.2002 },
      source: "MANUAL_PIN",
      accuracyM: null,
      capturedAt: null,
    });
  });

  it("turns the place into a mobile activity, without a point", async () => {
    fireEvent.click(screen.getByLabelText(/Activité mobile/));
    fireEvent.click(screen.getByLabelText("Golfe 1"));
    fireEvent.click(
      screen.getByRole("button", { name: "Enregistrer le lieu" }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(sentPlace()).toMatchObject({
      type: "MOBILE",
      point: null,
      source: null,
      addressHint: "",
      servedCommuneIds: ["c-g1"],
    });
  });

  it("shows why the API refused the place, and stays open", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          message: "Vérifiez les champs indiqués.",
          fields: {
            "location.point": "Cette position est hors du Grand Lomé.",
          },
        }),
        { status: 400 },
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Enregistrer le lieu" }),
    );
    expect(await screen.findByText(/hors du Grand Lomé/)).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe(
      "Vérifiez les champs indiqués.",
    );
    expect(refresh).not.toHaveBeenCalled();
  });
});
