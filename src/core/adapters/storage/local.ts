import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StoragePort } from "@/core/ports/storage";

export class LocalStorageAdapter implements StoragePort {
  readonly driver = "local" as const;

  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    // Keys are generated server-side, but reject traversal anyway.
    if (!/^[A-Za-z0-9/_.-]+$/.test(key) || key.includes("..")) throw new Error(`Invalid storage key: ${key}`);
    return path.join(this.root, key);
  }

  async put(key: string, data: Uint8Array, _contentType: string): Promise<void> {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
  }

  async get(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.resolve(key)));
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }
}
