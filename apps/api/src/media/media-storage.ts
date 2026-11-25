import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/*
 * Where photos are kept, behind one interface (ADR-029): the local disk in
 * the prototype, an S3-compatible service later. The database only knows the
 * key.
 */
export interface MediaStorage {
  put(key: string, content: Buffer): Promise<void>;
  /** Null when there is no such file. */
  get(key: string): Promise<Buffer | null>;
  /** Succeeds when the file is already gone. */
  delete(key: string): Promise<void>;
}

export const MEDIA_STORAGE = Symbol('MEDIA_STORAGE');

const UUID = '[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}';
/** Keys are made by the server; anything else could leave the folder. */
const KEY = new RegExp(`^${UUID}/${UUID}\\.webp$`);

export function newMediaKey(listingId: string): string {
  return `${listingId}/${randomUUID()}.webp`;
}

export class LocalDiskStorage implements MediaStorage {
  private readonly root: string;

  constructor(directory: string) {
    this.root = resolve(directory);
  }

  async put(key: string, content: Buffer): Promise<void> {
    const path = this.path(key);
    await mkdir(dirname(path), { recursive: true });
    // Renamed once complete: a crash never leaves half a photo under its key.
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, content, { mode: 0o600 });
      await rename(temporary, path);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.path(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }

  private path(key: string): string {
    if (!KEY.test(key)) throw new Error('Invalid media key');
    return join(this.root, key);
  }
}
