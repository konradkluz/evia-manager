// Job stores: in-memory (unit tests) and a JSON file written atomically (stands in for the SQLCipher outbox in Node tests).
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { JobStore, UploadJob } from './types.ts';

export class MemoryStore implements JobStore {
  private readonly jobs = new Map<string, UploadJob>();
  async load(assetId: string) {
    const j = this.jobs.get(assetId);
    return j ? structuredClone(j) : undefined;
  }
  async save(job: UploadJob) {
    this.jobs.set(job.assetId, structuredClone(job));
  }
}

export class FileStore implements JobStore {
  private readonly path: string;
  constructor(path: string) {
    this.path = path;
  }
  private async readAll(): Promise<Record<string, UploadJob>> {
    try {
      return JSON.parse(await readFile(this.path, 'utf8')) as Record<string, UploadJob>;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw e;
    }
  }
  async load(assetId: string) {
    return (await this.readAll())[assetId];
  }
  async save(job: UploadJob) {
    const all = await this.readAll();
    all[job.assetId] = job;
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(all));
    await rename(tmp, this.path);
  }
}
