// Usage: node scripts/verify-integrity.ts <export.json>
// export.json = JSON exported by the app: [{ assetId, size, sha256 }]. For each asset the object media/*/*/<assetId>/original is
// streamed from S3 and its SHA-256 and size are compared with the values recorded on the device. Exit code 1 on any mismatch.
import { readFileSync } from 'node:fs';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { loadLocal, s3Client } from '../src/local.ts';
import { objectSha256 } from '../src/verify.ts';

const cfg = loadLocal();
const s3 = s3Client(cfg);
const assets = JSON.parse(readFileSync(process.argv[2] ?? '', 'utf8')) as { assetId: string; size: number; sha256: string }[];
const keys: string[] = [];
let token: string | undefined;
do {
  const r = await s3.send(new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: 'media/', ContinuationToken: token }));
  for (const o of r.Contents ?? []) keys.push(o.Key!);
  token = r.IsTruncated ? r.NextContinuationToken : undefined;
} while (token);
let bad = 0;
const results = [];
for (const a of assets) {
  const key = keys.find((k) => k.includes(`/${a.assetId}/original`));
  if (!key) {
    results.push({ assetId: a.assetId, ok: false, reason: 'missing_object' });
    bad++;
    continue;
  }
  const stored = await objectSha256(s3, cfg.bucket, key);
  const ok = stored.sha256 === a.sha256 && stored.size === a.size;
  if (!ok) bad++;
  results.push({ assetId: a.assetId, ok, size: stored.size, sha256: stored.sha256, expectedSha256: a.sha256 });
}
console.log(JSON.stringify(results, null, 2));
process.exit(bad === 0 ? 0 : 1);
