// Usage: node scripts/make-synthetic.ts <out> <MiB> [seed]  -> prints the SHA-256 (synthetic pseudo-random bytes, NOT from a camera).
import { makeSyntheticFile } from '../src/synthetic.ts';

const [out, mib, seed = 'default'] = process.argv.slice(2);
if (!out || !mib) throw new Error('usage: make-synthetic.ts <out> <MiB> [seed]');
console.log(
  JSON.stringify({ file: out, bytes: Number(mib) * 1024 * 1024, sha256: await makeSyntheticFile(out, Number(mib) * 1024 * 1024, seed) }),
);
