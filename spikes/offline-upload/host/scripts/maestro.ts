// Usage: node scripts/maestro.ts <flow.yaml>   (Maestro 2.11.0 on the single emulator; telemetry off; artifacts in .scratch only)
// Same invocation as tools/mobile-e2e: `java -classpath <maestro>/lib/* maestro.cli.AppKt ...` (no shell, no .bat launcher).
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { RESULTS_DIR } from '../src/local.ts';

const flow = resolve(process.argv[2] ?? '');
const maestroHome = process.env.EVIA_MAESTRO_HOME ?? join(homedir(), '.evia', 'tools', 'maestro-2.11.0');
const java = process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', 'java.exe') : 'java';
const out = join(RESULTS_DIR, 'maestro');
mkdirSync(out, { recursive: true });
const result = spawnSync(
  java,
  [
    '--enable-native-access=ALL-UNNAMED',
    '-classpath',
    join(maestroHome, 'maestro', 'lib', '*'),
    'maestro.cli.AppKt',
    '--device',
    'emulator-5554',
    'test',
    flow,
    '--format',
    'JUNIT',
    '--output',
    join(out, 'junit.xml'),
    '--test-output-dir',
    out,
  ],
  { stdio: 'inherit', env: { ...process.env, MAESTRO_CLI_NO_ANALYTICS: '1', MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true' } },
);
process.exit(result.status ?? 1);
