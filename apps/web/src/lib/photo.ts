/** Longest side sent, the same as the one stored by the API. */
export const MAX_PHOTO_SIDE = 1280;
const QUALITY = 0.8;

export const UNREADABLE_PHOTO =
  "Cette photo est illisible. Choisissez une image JPEG, PNG ou WebP.";

/** The size of a photo once its longest side fits, never enlarged. */
export function fitPhoto(
  width: number,
  height: number,
): { width: number; height: number } {
  const ratio = Math.min(1, MAX_PHOTO_SIDE / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

function encode(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY));
}

/**
 * Draws the photo again at 1280 px and encodes it in WebP (about 200 KB). Only
 * pixels are drawn, so the EXIF, GPS position included, never leaves the
 * phone (ADR-041); the API removes it a second time.
 */
export async function preparePhoto(file: Blob): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(UNREADABLE_PHOTO);
  }
  try {
    const { width, height } = fitPhoto(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error(UNREADABLE_PHOTO);
    // JPEG, the fallback, has no transparency: white rather than black.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(bitmap, 0, 0, width, height);

    // A browser that cannot write WebP (Safari) silently gives a heavy PNG.
    let blob = await encode(canvas, "image/webp");
    if (blob?.type !== "image/webp") blob = await encode(canvas, "image/jpeg");
    if (!blob) throw new Error(UNREADABLE_PHOTO);
    return blob;
  } finally {
    bitmap.close();
  }
}
