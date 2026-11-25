import sharp from 'sharp';

/*
 * Every photo is decoded and encoded again before it is stored (ADR-019,
 * ADR-041). Nothing of the uploaded file is kept but its pixels, so a
 * published photo can never carry the position of a home: no EXIF, XMP, IPTC,
 * comment, colour profile, embedded thumbnail, nor bytes hidden after the
 * image. sharp writes no metadata unless asked to: never call withMetadata(),
 * keepMetadata() or keepExif() here.
 */

/** Largest file accepted (ADR-040). */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
/** Longest side of a stored photo, the same as the phone's own resizing. */
export const MAX_PHOTO_SIDE = 1280;
/** A small file can decode to a huge image: refused before it is decoded. */
const MAX_PIXELS = 25_000_000;
const PROCESSING_SECONDS = 20;

export type PhotoFormat = 'jpeg' | 'png' | 'webp';

export class UnsupportedPhotoError extends Error {}

/** The real type of a file, from its first bytes; its name proves nothing. */
export function sniffPhoto(bytes: Buffer): PhotoFormat | null {
  if (bytes.length < 12) return null;
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    return 'jpeg';
  }
  if (
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'png';
  }
  if (
    bytes.toString('latin1', 0, 4) === 'RIFF' &&
    bytes.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

/** A clean WebP of the photo, or UnsupportedPhotoError. */
export async function cleanPhoto(bytes: Buffer): Promise<Buffer> {
  if (!sniffPhoto(bytes)) throw new UnsupportedPhotoError();
  let clean: Buffer;
  try {
    clean = await sharp(bytes, {
      limitInputPixels: MAX_PIXELS,
      failOn: 'error',
    })
      // Applies the EXIF orientation to the pixels, since the EXIF goes.
      .rotate()
      .resize({
        width: MAX_PHOTO_SIDE,
        height: MAX_PHOTO_SIDE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: 80 })
      .timeout({ seconds: PROCESSING_SECONDS })
      .toBuffer();
  } catch {
    throw new UnsupportedPhotoError();
  }

  // Checked on the result itself, so a mistake above stores nothing.
  const { exif, xmp, iptc } = await sharp(clean).metadata();
  if (exif || xmp || iptc) {
    throw new Error('A processed photo still carries metadata');
  }
  return clean;
}
