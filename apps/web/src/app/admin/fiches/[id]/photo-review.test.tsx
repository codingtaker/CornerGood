import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnPhoto } from "@/lib/listings";
import { PhotoReview } from "./photo-review";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const photo = (id: string, status = "PENDING"): OwnPhoto => ({
  id,
  status,
  isCover: false,
  rejectionReason: status === "REJECTED" ? "Floue." : null,
});

describe("PhotoReview", () => {
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

  it("offers a decision only on a photo awaiting one", () => {
    render(
      <PhotoReview
        photos={[photo("p1"), photo("p2", "APPROVED"), photo("p3", "REJECTED")]}
        decidable
      />,
    );
    expect(screen.getAllByRole("button", { name: /Valider/ })).toHaveLength(1);
    expect(screen.getByText("Floue.")).toBeTruthy();
  });

  it("offers none while the listing is not sent for validation", () => {
    render(<PhotoReview photos={[photo("p1")]} decidable={false} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("validates a photo", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    render(<PhotoReview photos={[photo("p1")]} decidable />);
    fireEvent.click(screen.getByRole("button", { name: "Valider la photo 1" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/admin/media/p1/approve");
  });

  it("refuses a photo with its reason, never without", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    render(<PhotoReview photos={[photo("p1")]} decidable />);
    const refuse = screen.getByRole("button", { name: "Refuser la photo 1" });
    fireEvent.click(refuse);
    expect(screen.getByRole("alert").textContent).toMatch(/pourquoi/);
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Motif du refus de la photo 1"), {
      target: { value: "On lit le numéro de la maison." },
    });
    fireEvent.click(refuse);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/admin/media/p1/reject");
    expect(JSON.parse(init.body as string)).toEqual({
      reason: "On lit le numéro de la maison.",
    });
  });
});
