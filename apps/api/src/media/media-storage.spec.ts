import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { LocalDiskStorage, newMediaKey } from './media-storage';

describe('LocalDiskStorage', () => {
  let directory: string;
  let storage: LocalDiskStorage;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'cornergood-media-'));
    storage = new LocalDiskStorage(directory);
  });
  afterAll(() => rm(directory, { recursive: true }));

  it('keeps, gives back and deletes a photo', async () => {
    const listing = randomUUID();
    const key = newMediaKey(listing);
    await storage.put(key, Buffer.from('photo'));
    expect((await storage.get(key))?.toString()).toBe('photo');
    // No temporary file is left behind.
    expect(await readdir(join(directory, listing))).toHaveLength(1);

    await storage.delete(key);
    await storage.delete(key);
    expect(await storage.get(key)).toBeNull();
  });

  it.each(['../../.env', '/etc/passwd', 'a/b.webp', '', 'C:\\x.webp'])(
    'refuses the key "%s", which could leave its folder',
    async (key) => {
      await expect(storage.get(key)).rejects.toThrow('Invalid media key');
      await expect(storage.put(key, Buffer.from('x'))).rejects.toThrow();
      await expect(storage.delete(key)).rejects.toThrow();
    },
  );
});
