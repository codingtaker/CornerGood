import { describe, expect, it, vi } from "vitest";
import { capturePosition, geolocationMessage } from "./geolocation";

function fakeGeolocation(
  outcome:
    | { coords: { latitude: number; longitude: number; accuracy: number } }
    | { code: number },
) {
  const getCurrentPosition = vi.fn(
    (
      success: PositionCallback,
      failure?: PositionErrorCallback | null,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _options?: PositionOptions,
    ) => {
      if ("coords" in outcome) {
        success({
          coords: outcome.coords,
          timestamp: Date.UTC(2026, 10, 21, 9, 30),
        } as GeolocationPosition);
      } else {
        failure?.({ code: outcome.code } as GeolocationPositionError);
      }
    },
  );
  return {
    geolocation: { getCurrentPosition } as unknown as Geolocation,
    getCurrentPosition,
  };
}

describe("capturePosition", () => {
  it("asks for a fresh, precise position and rounds the accuracy", async () => {
    const { geolocation, getCurrentPosition } = fakeGeolocation({
      coords: { latitude: 6.1725, longitude: 1.2314, accuracy: 7.6 },
    });
    await expect(capturePosition(geolocation)).resolves.toEqual({
      lat: 6.1725,
      lng: 1.2314,
      accuracyM: 8,
      capturedAt: "2026-11-21T09:30:00.000Z",
    });
    expect(getCurrentPosition.mock.calls[0][2]).toEqual({
      enableHighAccuracy: true,
      timeout: 20_000,
      maximumAge: 0,
    });
  });

  it("explains a refusal in plain French", async () => {
    const { geolocation } = fakeGeolocation({ code: 1 });
    await expect(capturePosition(geolocation)).rejects.toThrow(
      "L'accès à la position est refusé.",
    );
  });

  it("falls back to the list when the browser has no geolocation", async () => {
    await expect(capturePosition(undefined)).rejects.toThrow(
      "Choisissez la commune dans la liste.",
    );
  });
});

describe("geolocationMessage", () => {
  it("tells to go outside after a timeout", () => {
    expect(geolocationMessage(3)).toContain("Placez-vous dehors");
  });
});
