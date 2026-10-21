// Usage: node scripts/count-duplicates.ts   -> JSON: objects, duplicate assetIds, objects without an assetId, orphaned multipart uploads.
// Exit code 1 when anything is wrong (duplicates or orphans).
import { countDuplicates, loadLocal, s3Client } from '../src/local.ts';

const cfg = loadLocal();
const report = await countDuplicates(s3Client(cfg), cfg.bucket);
console.log(JSON.stringify(report, null, 2));
process.exit(report.duplicateAssetIds.length + report.objectsWithoutAsset.length + report.orphanedMultipart.length === 0 ? 0 : 1);
