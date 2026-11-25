import sharp from 'sharp';
import {
  cleanPhoto,
  MAX_PHOTO_SIDE,
  sniffPhoto,
  UnsupportedPhotoError,
} from './photo-processor';

const pixels = (width: number, height: number) =>
  sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 90, b: 10 },
    },
  });

/** A JPEG as a phone camera writes it: GPS position, owner, orientation. */
const phonePhoto = () =>
  pixels(400, 200)
    .jpeg()
    .withExif({
      IFD0: { Make: 'Phone', Artist: 'Secret Owner' },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '6/1 13/1 12/1',
        GPSLongitudeRef: 'E',
        GPSLongitude: '1/1 9/1 30/1',
      },
    })
    .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/">secret place</x:xmpmeta>')
    .withMetadata({ orientation: 6 })
    .toBuffer();

describe('cleanPhoto', () => {
  it('removes every trace of the position', async () => {
    const original = await phonePhoto();
    // The test proves something only if the original does carry them.
    expect((await sharp(original).metadata()).exif).toBeDefined();
    expect(original.toString('latin1')).toContain('Secret Owner');

    const clean = await cleanPhoto(original);
    const metadata = await sharp(clean).metadata();
    expect(metadata.format).toBe('webp');
    expect(metadata.exif).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
    const raw = clean.toString('latin1');
    for (const trace of ['EXIF', 'XMP ', 'ICCP', 'Secret', 'secret place']) {
      expect(raw).not.toContain(trace);
    }
  });

  it('drops bytes hidden after the image', async () => {
    const original = Buffer.concat([
      await phonePhoto(),
      Buffer.from('<script>lat=6.22</script>'),
    ]);
    const clean = await cleanPhoto(original);
    expect(clean.toString('latin1')).not.toContain('script');
  });

  it('keeps the photo upright once its EXIF orientation is gone', async () => {
    const { width, height } = await sharp(
      await cleanPhoto(await phonePhoto()),
    ).metadata();
    expect([width, height]).toEqual([200, 400]);
  });

  it('reduces a large photo, and never enlarges a small one', async () => {
    const large = await sharp(
      await cleanPhoto(await pixels(4000, 3000).jpeg().toBuffer()),
    ).metadata();
    expect([large.width, large.height]).toEqual([MAX_PHOTO_SIDE, 960]);
    const small = await sharp(
      await cleanPhoto(await pixels(300, 200).png().toBuffer()),
    ).metadata();
    expect([small.width, small.height]).toEqual([300, 200]);
  });

  it('refuses an image that decodes to too many pixels', async () => {
    const bomb = await pixels(6000, 6000).png().toBuffer();
    expect(bomb.length).toBeLessThan(5 * 1024 * 1024);
    await expect(cleanPhoto(bomb)).rejects.toThrow(UnsupportedPhotoError);
  });

  it('refuses a broken image', async () => {
    const jpeg = await phonePhoto();
    await expect(cleanPhoto(jpeg.subarray(0, jpeg.length / 2))).rejects.toThrow(
      UnsupportedPhotoError,
    );
  });

  it('refuses another format, whatever it claims to be', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
    const gif = await pixels(10, 10).gif().toBuffer();
    for (const file of [svg, gif, Buffer.from('%PDF-1.7 not a photo')]) {
      await expect(cleanPhoto(file)).rejects.toThrow(UnsupportedPhotoError);
    }
  });
});

describe('sniffPhoto', () => {
  it('reads the type from the content', async () => {
    expect(sniffPhoto(await pixels(9, 9).jpeg().toBuffer())).toBe('jpeg');
    expect(sniffPhoto(await pixels(9, 9).png().toBuffer())).toBe('png');
    expect(sniffPhoto(await pixels(9, 9).webp().toBuffer())).toBe('webp');
    expect(sniffPhoto(Buffer.alloc(0))).toBeNull();
  });
});
