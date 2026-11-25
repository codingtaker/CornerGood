import { afterEach, describe, expect, it, vi } from "vitest";
import { fitPhoto, preparePhoto, UNREADABLE_PHOTO } from "./photo";

describe("fitPhoto", () => {
  it("brings the longest side to 1280 px, never enlarging", () => {
    expect(fitPhoto(4000, 3000)).toEqual({ width: 1280, height: 960 });
    expect(fitPhoto(3000, 4000)).toEqual({ width: 960, height: 1280 });
    expect(fitPhoto(640, 480)).toEqual({ width: 640, height: 480 });
  });
});

describe("preparePhoto", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function browser(canWriteWebp: boolean) {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue({ width: 4000, height: 3000, close: vi.fn() }),
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    } as never);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (callback, type) =>
        callback(
          new Blob(["pixels"], {
            type: type === "image/webp" && !canWriteWebp ? "image/png" : type,
          }),
        ),
    );
  }

  it("sends WebP", async () => {
    browser(true);
    expect((await preparePhoto(new Blob(["original"]))).type).toBe(
      "image/webp",
    );
  });

  it("sends JPEG where the browser cannot write WebP, not a heavy PNG", async () => {
    browser(false);
    expect((await preparePhoto(new Blob(["original"]))).type).toBe(
      "image/jpeg",
    );
  });

  it("never falls back to the original file, which may carry a position", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockRejectedValue(new Error("decode")),
    );
    await expect(preparePhoto(new Blob(["original"]))).rejects.toThrow(
      UNREADABLE_PHOTO,
    );
  });
});
