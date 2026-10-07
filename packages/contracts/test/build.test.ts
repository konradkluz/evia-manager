import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { build, BUNDLE, generatorConfig, type BuildIo } from '../src/build.ts';
import { bundleContract } from '../src/redocly.ts';

const spec = JSON.stringify({ paths: { '/api/health': { get: { operationId: 'getHealth', 'x-evia-authz': { public: true } } } } });

function io(overrides: Partial<BuildIo> = {}) {
  const calls: string[] = [];
  const files = new Map<string, string>();
  const value: BuildIo = {
    remove: (path) => calls.push(`remove ${path}`),
    bundle: (output) => {
      calls.push(`bundle ${output}`);
      return { status: 0, output: '' };
    },
    generate: vi.fn(async () => {
      await Promise.resolve();
      calls.push('generate');
    }),
    readFile: () => spec,
    writeFile: (path, content) => {
      calls.push(`write ${path}`);
      files.set(path, content);
    },
    compile: () => {
      calls.push('compile');
      return 0;
    },
    ...overrides,
  };
  return { value, calls, files };
}

describe('contract build (EVM-008 AC2)', () => {
  it('EVM-008 AC2 the bundle is built first and is the only generator input; the manifest comes from the same bundle', async () => {
    const { value, calls, files } = io();
    await build(value);
    expect(calls).toEqual(['remove dist', 'remove generated', `bundle ${BUNDLE}`, 'generate', 'write generated/authz.gen.ts', 'compile']);
    expect(value.generate).toHaveBeenCalledWith(generatorConfig());
    expect(files.get('generated/authz.gen.ts')).toContain('"getHealth"');
  });

  it('EVM-008 AC2 the generator reads a local file and emits types, fetch client, SDK and Zod schemas', () => {
    const config = generatorConfig();
    expect(config.input).toBe('./dist/openapi.json');
    expect(config.plugins).toEqual(['@hey-api/typescript', '@hey-api/client-fetch', '@hey-api/sdk', 'zod']);
  });

  it('EVM-008 AC2 a failing bundle or compilation stops the build', async () => {
    const failedBundle = io({ bundle: () => ({ status: 1, output: 'boom' }) });
    await expect(build(failedBundle.value)).rejects.toThrow(/redocly bundle failed:\nboom/);
    expect(failedBundle.calls).not.toContain('generate');
    await expect(build(io({ compile: () => 2 }).value)).rejects.toThrow(/tsc/);
  });

  it('EVM-008 AC2 Redocly bundles the split specification into one JSON document', () => {
    const output = join(mkdtempSync(join(tmpdir(), 'evia-contracts-')), 'openapi.json');
    expect(bundleContract(output).status).toBe(0);
    const bundle = JSON.parse(readFileSync(output, 'utf8')) as { paths: Record<string, unknown>; components: { schemas: object } };
    expect(Object.keys(bundle.paths)).toContain('/api/health');
    expect(Object.keys(bundle.paths)).toHaveLength(22);
    expect(Object.keys(bundle.components.schemas)).toEqual(expect.arrayContaining(['Health', 'Problem', 'Semver']));
  });
});
