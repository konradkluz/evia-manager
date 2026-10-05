/**
 * Build of @evia/contracts (EVM-008 AC2): the source specification is bundled by Redocly into dist/openapi.json, the
 * only input of the generator (@hey-api/openapi-ts: types, fetch client, Zod schemas); the authorization manifest is
 * generated from the same bundle; tsc emits JavaScript with declarations to dist/.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient, type UserConfig } from '@hey-api/openapi-ts';
import { buildAuthzManifest, renderAuthzModule } from './manifest.ts';
import { bundleContract, type RedoclyResult } from './redocly.ts';

export const BUNDLE = 'dist/openapi.json';
export const GENERATED = 'generated';

/** Generator configuration: a local file only (a bare `org/project` input would be fetched from the Hey API registry). */
export function generatorConfig(): UserConfig {
  return {
    input: `./${BUNDLE}`,
    output: { path: GENERATED, module: { extension: '.ts' } },
    plugins: ['@hey-api/typescript', '@hey-api/client-fetch', '@hey-api/sdk', 'zod'],
    logs: { level: 'silent' },
  };
}

export interface BuildIo {
  readonly remove: (path: string) => void;
  readonly bundle: (output: string) => RedoclyResult;
  readonly generate: (config: UserConfig) => Promise<unknown>;
  readonly readFile: (path: string) => string;
  readonly writeFile: (path: string, content: string) => void;
  /** @returns exit status of `tsc -p tsconfig.build.json` */
  readonly compile: () => number;
}

export async function build(io: BuildIo): Promise<void> {
  io.remove('dist');
  io.remove(GENERATED);
  const bundle = io.bundle(BUNDLE);
  if (bundle.status !== 0) throw new Error(`redocly bundle failed:\n${bundle.output}`);
  await io.generate(generatorConfig());
  const manifest = buildAuthzManifest(JSON.parse(io.readFile(BUNDLE)));
  io.writeFile(`${GENERATED}/authz.gen.ts`, renderAuthzModule(manifest));
  if (io.compile() !== 0) throw new Error('tsc -p tsconfig.build.json failed');
}

/* v8 ignore start -- process wiring of the build entry point; build() is covered by tests */
if (import.meta.main) {
  const tsc = fileURLToPath(import.meta.resolve('typescript/bin/tsc'));
  await build({
    remove: (path) => {
      rmSync(path, { recursive: true, force: true });
    },
    bundle: bundleContract,
    generate: createClient,
    readFile: (path) => readFileSync(path, 'utf8'),
    writeFile: writeFileSync,
    compile: () => spawnSync(process.execPath, [tsc, '-p', 'tsconfig.build.json'], { stdio: 'inherit' }).status ?? 1,
  });
}
/* v8 ignore stop */
