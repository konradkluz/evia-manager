// Starts the url-issuer for manual scenarios. Usage:
//   node scripts/issuer-cli.ts --sign-endpoint http://10.0.2.2:8333 [--port 8787] [--ttl 3600]
// Emulator: sign-endpoint http://10.0.2.2:8333; physical phone with `adb reverse`: http://127.0.0.1:8333.
// Listens on 127.0.0.1 ONLY. The test token is read from the git-ignored secrets directory and is not printed.
import { resolve } from 'node:path';
import { createIssuer } from '../src/issuer.ts';
import { RESULTS_DIR, S3_ENDPOINT, ensureBucket, loadLocal, s3Client } from '../src/local.ts';

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};
const cfg = loadLocal();
await ensureBucket(s3Client(cfg), cfg.bucket);
const issuer = createIssuer({
  s3Endpoint: S3_ENDPOINT,
  signEndpoint: arg('sign-endpoint', 'http://10.0.2.2:8333'),
  bucket: cfg.bucket,
  accessKey: cfg.accessKey,
  secretKey: cfg.secretKey,
  token: cfg.token,
  ttlSeconds: Number(arg('ttl', '3600')),
  defaultPartSize: Number(arg('part-mib', '16')) * 1024 * 1024,
  statePath: resolve(RESULTS_DIR, '../issuer-state.json'),
  port: Number(arg('port', '8787')),
});
const port = await issuer.listen();
console.log(`url-issuer listening on 127.0.0.1:${port} (sign endpoint ${arg('sign-endpoint', 'http://10.0.2.2:8333')})`);
