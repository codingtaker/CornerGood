import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServicesEditor } from "./services-editor";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const catalogue = [
  {
    id: "s-ecran",
    slug: "reparation-ecran-telephone",
    name: "Écran de téléphone",
  },
  { id: "s-moto", slug: "reparation-moto", name: "Mécanique moto" },
];

describe("ServicesEditor", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    refresh.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("sends the ticked services with their details", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    render(
      <ServicesEditor
        listingId="l1"
        catalogue={catalogue}
        initial={[{ id: "s-ecran", name: "Écran de téléphone", details: null }]}
      />,
    );
    fireEvent.click(screen.getByLabelText("Mécanique moto"));
    fireEvent.change(screen.getByLabelText("Mécanique moto : précision"), {
      target: { value: "Motos Haojue" },
    });
    fireEvent.click(screen.getByLabelText("Écran de téléphone"));
    fireEvent.click(
      screen.getByRole("button", { name: "Enregistrer les services" }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/pro/listings/l1/services");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({
      services: [{ serviceId: "s-moto", details: "Motos Haojue" }],
    });
  });

  it("says when the category has no services yet", () => {
    render(<ServicesEditor listingId="l1" catalogue={[]} initial={[]} />);
    expect(screen.getByText(/Pas encore de services/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
