import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { preparePhoto } from "@/lib/photo";
import type { OwnPhoto } from "@/lib/listings";
import { PhotoSection } from "./photo-section";

vi.mock("@/lib/photo", () => ({ preparePhoto: vi.fn() }));

const photo = (id: string, isCover = false): OwnPhoto => ({
  id,
  status: "PENDING",
  isCover,
  rejectionReason: null,
});

describe("PhotoSection", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.mocked(preparePhoto).mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const show = (photos: OwnPhoto[] = [], editable = true) =>
    render(
      <PhotoSection
        listingId="l1"
        initialPhotos={photos}
        editable={editable}
        locationType="HOME_BASED"
      />,
    );
  const choose = () =>
    fireEvent.change(screen.getByLabelText("Ajouter une photo"), {
      target: { files: [new File(["original"], "chez-moi.jpg")] },
    });

  it("sends the prepared photo, not the original nor its name", async () => {
    const prepared = new Blob(["clean"], { type: "image/webp" });
    vi.mocked(preparePhoto).mockResolvedValue(prepared);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ photo: photo("p1", true) }), {
        status: 201,
      }),
    );
    show();
    choose();
    expect(await screen.findByText(/En attente.*couverture/)).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/pro/listings/l1/media");
    const sent = (init.body as FormData).get("file") as File;
    expect(sent.name).toBe("photo");
    expect(sent.size).toBe(prepared.size);
  });

  it("sends nothing when the photo cannot be prepared", async () => {
    vi.mocked(preparePhoto).mockRejectedValue(new Error("illisible"));
    show();
    choose();
    expect((await screen.findByRole("alert")).textContent).toBe("illisible");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("deletes a photo; the next one becomes the cover", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    show([photo("p1", true), photo("p2")]);
    fireEvent.click(
      screen.getByRole("button", { name: "Supprimer la photo 1" }),
    );
    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(1));
    expect(screen.getByText(/couverture/)).toBeTruthy();
  });

  it("offers no change under review, nor a seventh photo", () => {
    show([photo("p1", true)], false);
    expect(screen.queryByLabelText("Ajouter une photo")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    cleanup();
    show(["1", "2", "3", "4", "5", "6"].map((id) => photo(id)));
    expect(screen.queryByLabelText("Ajouter une photo")).toBeNull();
  });

  it("shows why a photo was refused", () => {
    show([
      { ...photo("p1", true), status: "REJECTED", rejectionReason: "Floue." },
    ]);
    expect(screen.getByText("Floue.")).toBeTruthy();
    expect(screen.getByText(/Refusée/)).toBeTruthy();
  });

  it("warns a home-based activity about what the photo shows", () => {
    show();
    expect(screen.getByText(/Ne montrez ni votre façade/)).toBeTruthy();
  });
});
