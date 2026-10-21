// Usage: node scripts/summarize.ts [scenario-prefix]  -> compact view of the latest result file of a scenario (for the report).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RESULTS_DIR } from '../src/local.ts';

const prefix = process.argv[2] ?? '';
const file = readdirSync(RESULTS_DIR)
  .filter((f) => f.startsWith(`${prefix}-2`) || f.startsWith(prefix))
  .sort()
  .at(-1);
if (!file) throw new Error('no result file');
const r = JSON.parse(readFileSync(join(RESULTS_DIR, file), 'utf8')) as Record<string, any>;
console.log(
  file,
  '| emulator',
  JSON.stringify(r.emulator),
  '| duplicates',
  JSON.stringify({ ...r.duplicates, objectsWithoutAsset: r.duplicates.objectsWithoutAsset.length }),
  '| createSession calls',
  r.createSessionCalls,
);
const runs: any[] = r.runs ?? (r.run ? [r.run] : []);
for (const x of runs) {
  console.log('-', JSON.stringify({ ...x, files: undefined, samples: x.samples?.length }));
  for (const f of x.files ?? [])
    console.log(
      '   ',
      JSON.stringify({
        ok: f.ok,
        mib: f.size / 1048576,
        uploadMs: f.uploadMs,
        retries: f.retries,
        renewals: f.renewals,
        partPuts: f.partPuts,
        skipped: f.skippedParts,
        retxBytes: f.retransmittedBytes,
        stops: f.stops,
        runs: f.runs,
      }),
    );
}
if (r.checks) console.log(JSON.stringify(r.checks, null, 1));
for (const s of r.steps ?? [])
  console.log(`  [${(s.tMs / 1000).toFixed(1)}s] ${s.step} ${s.data === undefined ? '' : JSON.stringify(s.data)}`);
