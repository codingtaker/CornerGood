import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ListingDecision } from "./listing-decision";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

describe("ListingDecision", () => {
  const fetchMock = vi.fn();
  const confirm = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    refresh.mockReset();
    confirm.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", confirm);
    render(<ListingDecision listingId="l1" />);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const sent = () => {
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return { url, body: JSON.parse(init.body as string) as unknown };
  };

  it("publishes once confirmed", async () => {
    confirm.mockReturnValue(true);
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    fireEvent.click(screen.getByRole("button", { name: "Publier" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(sent()).toEqual({
      url: "/api/v1/admin/listings/l1/approve",
      body: {},
    });
  });

  it("publishes nothing when the confirmation is declined", () => {
    confirm.mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Publier" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks for the reason before rejecting", () => {
    fireEvent.click(screen.getByRole("button", { name: "Rejeter avec motif" }));
    expect(screen.getByRole("alert").textContent).toMatch(/motif/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects with the reason, and shows a refusal of the API", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ message: "Une décision a déjà été prise." }),
        { status: 409 },
      ),
    );
    fireEvent.change(screen.getByLabelText("Motif du refus"), {
      target: { value: "Ajoutez une description." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Rejeter avec motif" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Une décision a déjà été prise.",
    );
    expect(sent()).toEqual({
      url: "/api/v1/admin/listings/l1/reject",
      body: { reason: "Ajoutez une description." },
    });
    // Someone else decided: the page shows the new status.
    expect(refresh).toHaveBeenCalled();
  });
});
