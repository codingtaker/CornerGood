import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReportActions } from "./report-actions";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

describe("ReportActions", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    refresh.mockReset();
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const sent = () =>
    fetchMock.mock.calls.map(([url, init]) => [
      url as string,
      JSON.parse((init as RequestInit).body as string) as unknown,
    ]);

  it("takes an open report in hand", async () => {
    render(<ReportActions reportId="r1" status="OPEN" />);
    fireEvent.click(screen.getByRole("button", { name: "Prendre en charge" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(sent()).toEqual([["/api/v1/admin/reports/r1/take", {}]]);
  });

  it("closes with a note, never without", async () => {
    render(<ReportActions reportId="r1" status="IN_REVIEW" />);
    expect(
      screen.queryByRole("button", { name: "Prendre en charge" }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Classé" }));
    expect(screen.getByRole("alert").textContent).toMatch(/Notez/);
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Note de traitement"), {
      target: { value: "Appelé : rouvert lundi." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Résolu" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(sent()).toEqual([
      ["/api/v1/admin/reports/r1/resolve", { note: "Appelé : rouvert lundi." }],
    ]);
  });
});
