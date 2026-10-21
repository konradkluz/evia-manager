// Streaming SHA-256 of a file (Node reference; on the device the native module does this, 500 MB never goes through JS).
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path, { highWaterMark: 1024 * 1024 })) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export function sha256Bytes(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}
