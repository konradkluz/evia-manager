import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { filesOnDisk, indexedFiles, readVector, runScenario, type ResumeFile } from '../conformance/upload.ts';
import {
  backoffDelayMs,
  declaredFileName,
  isDeclarable,
  MAX_DECLARED_BYTES,
  normalizeUploadType,
  UPLOAD_TYPE_EXTENSIONS,
  type FileDeclaration,
  isTrustedPartUrl,
  mapFailure,
  planParts,
  UPLOAD_LIMITS,
  type MappingInput,
  type Outcome,
} from '../src/upload/index.ts';

// The same vectors are read by the Kotlin engine (apps/mobile/modules/evia-upload/engine, VectorsTest): a divergence of any vector
// turns a test red on either side (EVM-109 AC4).

interface PlanningFile {
  cases: { id: string; input: { size: number; partSize: number; partCount: number }; expected: Record<string, unknown> }[];
}

describe('EVM-109 AC4 conformance vectors: index', () => {
  it('EVM-109 AC4: every vector file is listed in index.json and every listed file exists', () => {
    expect([...indexedFiles()].sort()).toEqual(filesOnDisk());
  });
});

describe('EVM-109 AC4 conformance vectors: planning (AC1)', () => {
  for (const item of readVector<PlanningFile>('planning.json').cases) {
    it(`EVM-109 AC4: ${item.id}`, () => {
      const { size, partSize, partCount } = item.input;
      if ('error' in item.expected) {
        expect(() => planParts(size, partSize, partCount)).toThrow('plan_mismatch');
        return;
      }
      const parts = planParts(size, partSize, partCount);
      const summary = {
        count: parts.length,
        total: parts.reduce((sum, part) => sum + part.length, 0),
        first: parts[0],
        last: parts.at(-1),
      };
      expect(summary).toMatchObject(Object.fromEntries(Object.entries(item.expected).filter(([key]) => key !== 'parts')));
      if ('parts' in item.expected) expect(parts).toEqual(item.expected.parts);
    });
  }
});

describe('EVM-109 AC4 conformance vectors: backoff (AC2)', () => {
  const file = readVector<{ constants: Record<string, number>; cases: { attempt: number; rng: number; expected: number }[] }>(
    'backoff.json',
  );
  it('EVM-109 AC4: the constants of the model equal the constants in the vector', () => {
    expect(file.constants).toEqual({
      maxAttempts: UPLOAD_LIMITS.maxAttempts,
      maxRenewals: UPLOAD_LIMITS.maxRenewals,
      baseMs: UPLOAD_LIMITS.baseDelayMs,
      capMs: UPLOAD_LIMITS.capDelayMs,
      maxParts: UPLOAD_LIMITS.maxParts,
    });
  });
  for (const item of file.cases) {
    it(`EVM-109 AC4: attempt ${item.attempt} rng ${item.rng} -> ${item.expected} ms`, () => {
      expect(backoffDelayMs(item.attempt, item.rng)).toBe(item.expected);
    });
  }
});

describe('EVM-109 AC2 conformance vectors: mapping', () => {
  for (const item of readVector<{ cases: { id: string; input: MappingInput; expected: Outcome }[] }>('mapping.json').cases) {
    it(`EVM-109 AC2: ${item.id}`, () => {
      expect(mapFailure(item.input)).toEqual(item.expected);
    });
  }
});

describe('EVM-131 AC1 conformance vectors: the declaration of the file', () => {
  const file = readVector<{
    types: { id: string; input: string; normalized: string | null; fileName?: string }[];
    declarations: { id: string; file: FileDeclaration; declarable: boolean }[];
  }>('declaration.json');
  const asset = '0193a000-0000-7000-8000-00000000000a';
  for (const item of file.types) {
    it(`EVM-131 AC1: ${item.id}`, () => {
      expect(normalizeUploadType(item.input) ?? null).toBe(item.normalized);
      if (item.fileName !== undefined && item.normalized !== null) expect(declaredFileName(asset, item.normalized)).toBe(item.fileName);
    });
  }
  for (const item of file.declarations) {
    it(`EVM-131 AC1: ${item.id}`, () => {
      expect(isDeclarable(item.file)).toBe(item.declarable);
    });
  }
  it('EVM-131 AC1: a type outside the list gets the extension bin, and the table has the six types of the contract', () => {
    expect(declaredFileName(asset, 'image/svg+xml')).toBe(`${asset}.bin`);
    expect(Object.keys(UPLOAD_TYPE_EXTENSIONS)).toHaveLength(6);
    expect(isDeclarable({ fileName: `${asset}.jpg`, declaredSize: 1.5, contentType: 'image/jpeg', sha256: 'a'.repeat(64) })).toBe(false);
    expect(MAX_DECLARED_BYTES).toBe(4_294_967_296);
  });
});

describe('EVM-109 AC3 conformance vectors: part address trust', () => {
  const file = readVector<{
    allowedHosts: string[];
    cases: { id: string; url?: string; urlRepeat?: { prefix: string; filler: string; times: number }; trusted: boolean }[];
  }>('urlcheck.json');
  for (const item of file.cases) {
    it(`EVM-109 AC3: ${item.id}`, () => {
      const url = item.url ?? `${item.urlRepeat?.prefix ?? ''}${(item.urlRepeat?.filler ?? '').repeat(item.urlRepeat?.times ?? 0)}`;
      expect(isTrustedPartUrl(url, file.allowedHosts)).toBe(item.trusted);
    });
  }
});

describe('EVM-109 AC1 conformance vectors: resume loop', () => {
  const file = readVector<ResumeFile>('resume.json');
  for (const scenario of file.scenarios) {
    it(`EVM-109 ${scenario.ac}: ${scenario.id}`, async () => {
      expect(await runScenario(scenario, file.defaults)).toEqual([]);
    });
  }
});

describe('EVM-109 AC4: Turborepo cache', () => {
  it('EVM-109 AC4: test and test:coverage declare the vectors as inputs, so a changed vector invalidates the cache', () => {
    const turbo = JSON.parse(readFileSync(new URL('../turbo.json', import.meta.url), 'utf8')) as {
      tasks: Record<string, { inputs: string[] }>;
    };
    for (const task of ['test', 'test:coverage']) {
      expect(turbo.tasks[task]?.inputs).toContain('conformance/upload/**');
    }
  });
});
