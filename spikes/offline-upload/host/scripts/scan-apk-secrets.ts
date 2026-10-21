// Usage: node scripts/scan-apk-secrets.ts <unzipped-apk-dir>
// Checks that none of the local synthetic secrets (S3 access key, secret key, test token) is present in the unpacked APK/JS bundle (SR-MOB-11, CWE-798).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadLocal } from '../src/local.ts';

const root = process.argv[2] ?? '';
const cfg = loadLocal();
const needles = { accessKey: cfg.accessKey, secretKey: cfg.secretKey, token: cfg.token };
const hits: string[] = [];
let files = 0;
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else {
      files++;
      const buf = readFileSync(p);
      for (const [label, value] of Object.entries(needles)) if (buf.includes(value)) hits.push(`${label} in ${p}`);
    }
  }
};
walk(root);
console.log(JSON.stringify({ filesScanned: files, hits }));
process.exit(hits.length === 0 ? 0 : 1);
