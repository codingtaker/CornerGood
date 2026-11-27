import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchResult } from "@/lib/search";
import { SearchResults } from "./search-results";

function result(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    slug: "atelier-kossi",
    name: "Atelier Kossi",
    entityType: "BUSINESS",
    category: { slug: "reparation", name: "Réparation" },
    matchedServices: ["Remplacement d'écran de téléphone"],
    commune: { slug: "golfe-1", name: "Golfe 1" },
    locationType: "FIXED",
    position: { lat: 6.13, lng: 1.22 },
    distanceMeters: 644,
    coverPhotoUrl: "/api/v1/listings/atelier-kossi/photos/p1",
    verificationStatus: "VERIFIED",
    ...overrides,
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });

describe("SearchResults", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("asks the API from the browser and lists what it found", async () => {
    fetchMock.mockResolvedValue(
      json({
        data: [
          result(),
          result({
            slug: "plombier-ama",
            name: "Plombier Ama",
            matchedServices: [],
            locationType: "MOBILE",
            position: null,
            distanceMeters: null,
            coverPhotoUrl: null,
            verificationStatus: "UNVERIFIED",
          }),
        ],
        meta: { page: 1, limit: 20, total: 2 },
      }),
    );
    render(<SearchResults criteria={{ q: "ecran" }} query="q=ecran" />);

    expect(await screen.findByText("2 résultats")).toBeTruthy();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/search?q=ecran");
    const kossi = screen.getByRole("link", { name: /Atelier Kossi/ });
    expect(kossi.getAttribute("href")).toBe("/fiches/atelier-kossi");
    expect(kossi.textContent).toContain("Golfe 1 · à 640 m");
    expect(kossi.textContent).toContain("Remplacement d'écran de téléphone");
    expect(kossi.textContent).toContain("Vérifiée par l'équipe");
    const ama = screen.getByRole("link", { name: /Plombier Ama/ });
    expect(ama.textContent).toContain("Golfe 1 · Se déplace");
    expect(ama.textContent).not.toContain("Vérifiée");
  });

  it("links to the other pages of the same search", async () => {
    fetchMock.mockResolvedValue(
      json({ data: [result()], meta: { page: 2, limit: 20, total: 45 } }),
    );
    render(
      <SearchResults
        criteria={{ category: "reparation", page: 2 }}
        query="category=reparation&page=2"
      />,
    );
    expect(await screen.findByText("Page 2 sur 3")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Page précédente" })
        .getAttribute("href"),
    ).toBe("/recherche?category=reparation");
    expect(
      screen.getByRole("link", { name: "Page suivante" }).getAttribute("href"),
    ).toBe("/recherche?category=reparation&page=3");
  });

  it("says when nothing matches", async () => {
    fetchMock.mockResolvedValue(
      json({ data: [], meta: { page: 1, limit: 20, total: 0 } }),
    );
    render(<SearchResults criteria={{ q: "zzz" }} query="q=zzz" />);
    expect(await screen.findByText("Aucune activité trouvée.")).toBeTruthy();
  });

  it("shows the API's message, or says the network is down", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ message: "Trop de tentatives. Réessayez dans 1 minute." }, 429),
    );
    render(<SearchResults criteria={{ q: "ecran" }} query="q=ecran" />);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Trop de tentatives. Réessayez dans 1 minute.",
    );
    cleanup();

    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<SearchResults criteria={{ q: "ecran" }} query="q=ecran" />);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Pas de connexion",
    );
  });
});
