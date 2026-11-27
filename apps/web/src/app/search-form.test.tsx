import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchForm } from "./search-form";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const categories = [
  { id: "c1", slug: "reparation", name: "Réparation", applicableTo: null },
];
const communes = [
  { id: "k1", slug: "golfe-1", name: "Golfe 1", prefecture: "Golfe" },
];

describe("SearchForm", () => {
  beforeEach(() => push.mockReset());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("goes to the results with what and where", () => {
    render(<SearchForm categories={categories} communes={communes} />);
    fireEvent.change(screen.getByLabelText("Que cherchez-vous ?"), {
      target: { value: " écran " },
    });
    fireEvent.change(screen.getByLabelText("Commune"), {
      target: { value: "golfe-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Rechercher" }));
    expect(push).toHaveBeenCalledWith(
      "/recherche?q=%C3%A9cran&commune=golfe-1",
    );
  });

  it("asks for something to look for instead of an empty search", () => {
    render(<SearchForm categories={categories} communes={communes} />);
    fireEvent.click(screen.getByRole("button", { name: "Rechercher" }));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("2 lettres");
  });

  it("searches around the visitor, with a rounded position", async () => {
    vi.stubGlobal("navigator", {
      geolocation: {
        getCurrentPosition: (success: PositionCallback) =>
          success({
            coords: { latitude: 6.131234, longitude: 1.222876, accuracy: 12 },
            timestamp: Date.now(),
          } as GeolocationPosition),
      },
    });
    render(
      <SearchForm
        categories={categories}
        communes={communes}
        initial={{ category: "reparation" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Autour de moi" }));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        "/recherche?category=reparation&lat=6.131&lng=1.223",
      ),
    );
  });

  it("says why the position is missing", async () => {
    vi.stubGlobal("navigator", {
      geolocation: {
        getCurrentPosition: (
          _success: PositionCallback,
          failure: PositionErrorCallback,
        ) => failure({ code: 1 } as GeolocationPositionError),
      },
    });
    render(<SearchForm categories={categories} communes={communes} />);
    fireEvent.click(screen.getByRole("button", { name: "Autour de moi" }));
    expect((await screen.findByRole("alert")).textContent).toContain("refusé");
    expect(push).not.toHaveBeenCalled();
  });

  it("can drop the position of the current search", () => {
    render(
      <SearchForm
        categories={categories}
        communes={communes}
        initial={{ q: "couture", lat: 6.131, lng: 1.223 }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Retirer" }));
    fireEvent.click(screen.getByRole("button", { name: "Rechercher" }));
    expect(push).toHaveBeenCalledWith("/recherche?q=couture");
  });
});
