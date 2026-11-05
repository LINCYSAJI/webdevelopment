import { createReadStream } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { config } from '../config';

/**
 * Private file storage. Files are never reachable by a public link: the API checks
 * permissions and then streams them. Only metadata and the storage key live in MongoDB.
 * Stored files are never overwritten, and deleted only when an applicant's personal data is
 * erased at their request (DPDP Act s.12, see data-request.service.ts), so earlier versions
 * otherwise always stay available.
 */
export interface StorageProvider {
  put(key: string, data: Buffer): Promise<void>;
  open(key: string): Promise<{ stream: Readable; size: number }>;
  /** Reads a whole file into memory (for files that are processed, e.g. merged into a PDF). */
  read(key: string): Promise<Buffer>;
  /** Permanently deletes a file. Used ONLY by the DPDP erasure of an applicant's data. */
  remove(key: string): Promise<void>;
}

class LocalStorage implements StorageProvider {
  private root = path.resolve(config.LOCAL_STORAGE_DIR);

  private resolve(key: string) {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error('Invalid storage key');
    return full;
  }

  async put(key: string, data: Buffer) {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data, { flag: 'wx' }); // 'wx' refuses to overwrite an existing file
  }

  async read(key: string) {
    return readFile(this.resolve(key));
  }

  async remove(key: string) {
    await rm(this.resolve(key), { force: true });
  }

  async open(key: string) {
    const full = this.resolve(key);
    const { size } = await stat(full);
    return { stream: createReadStream(full), size };
  }
}

export const storage: StorageProvider = new LocalStorage();
