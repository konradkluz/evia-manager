// EVM-011 spike: generates SYNTHETIC local credentials (S3 identity + test token) into .scratch/EVM-011/secrets (git-ignored).
// Nothing is written into the repository tracked tree and nothing is printed. Safe to re-run (it never overwrites).
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(here, '../../../.scratch/EVM-011/secrets');
mkdirSync(dir, { recursive: true });

const s3File = resolve(dir, 's3.json');
const envFile = resolve(dir, 'local.json');
if (!existsSync(s3File) && !existsSync(envFile)) {
  const accessKey = `SPIKE${randomBytes(8).toString('hex').toUpperCase()}`;
  const secretKey = randomBytes(24).toString('base64url');
  const token = randomBytes(32).toString('base64url');
  writeFileSync(
    s3File,
    JSON.stringify({
      identities: [
        {
          name: 'evm011-spike',
          credentials: [{ accessKey, secretKey }],
          actions: ['Admin', 'Read', 'Write', 'List', 'Tagging'],
        },
      ],
    }),
    { mode: 0o600 },
  );
  writeFileSync(envFile, JSON.stringify({ accessKey, secretKey, token, bucket: 'evm011-spike' }), { mode: 0o600 });
}
console.log(`secrets directory (not tracked by git): ${dir}`);
