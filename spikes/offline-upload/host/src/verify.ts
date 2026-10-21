// SHA-256 of the stored object, streamed from S3 (never fully in memory), for integrity verification.
import { createHash } from 'node:crypto';
import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';

export async function objectSha256(s3: S3Client, bucket: string, key: string): Promise<{ sha256: string; size: number }> {
  const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of r.Body as AsyncIterable<Uint8Array>) {
    hash.update(chunk);
    size += chunk.length;
  }
  return { sha256: hash.digest('hex'), size };
}
