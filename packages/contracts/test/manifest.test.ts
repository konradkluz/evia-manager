import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AUTHZ_MANIFEST } from '../src/authz.ts';
import { buildAuthzManifest, renderAuthzModule } from '../src/manifest.ts';

const bundled: unknown = JSON.parse(readFileSync('dist/openapi.json', 'utf8'));

describe('authorization manifest (EVM-008 AC2, AC4; SR-AUTHZ-01)', () => {
  it('EVM-008 AC2 the manifest lists every operation of the bundled contract with method, path and x-evia-authz', () => {
    expect(buildAuthzManifest(bundled)).toEqual({ getHealth: { method: 'get', path: '/api/health', authz: { public: true } } });
    expect(AUTHZ_MANIFEST).toEqual(buildAuthzManifest(bundled));
  });

  it('EVM-008 AC4 an operation without operationId or x-evia-authz fails generation (no silent gaps)', () => {
    const spec = (operation: Record<string, unknown>) => ({ paths: { '/api/v1/x': { get: operation } } });
    expect(() => buildAuthzManifest(spec({ 'x-evia-authz': { public: true } }))).toThrow(/operationId/);
    expect(() => buildAuthzManifest(spec({ operationId: 'getX' }))).toThrow(/x-evia-authz/);
    expect(() =>
      buildAuthzManifest({
        paths: { '/a': { get: { operationId: 'same', 'x-evia-authz': {} } }, '/b': { post: { operationId: 'same', 'x-evia-authz': {} } } },
      }),
    ).toThrow(/same/);
  });

  it('EVM-008 AC2 non-operation keys of a path item are ignored and a contract without paths has no operations', () => {
    expect(
      buildAuthzManifest({ paths: { '/a': { summary: 'x', parameters: [], get: { operationId: 'getA', 'x-evia-authz': {} } } } }),
    ).toEqual({ getA: { method: 'get', path: '/a', authz: {} } });
    expect(buildAuthzManifest({ paths: { '/a': { get: null }, '/b': null } })).toEqual({});
    expect(buildAuthzManifest({})).toEqual({});
    expect(buildAuthzManifest(null)).toEqual({});
  });

  it('EVM-008 AC2 the rendered module is a frozen constant generated from the contract', () => {
    const source = renderAuthzModule({ getHealth: { method: 'get', path: '/api/health', authz: { public: true } } });
    expect(source).toContain('generated from dist/openapi.json');
    expect(source).toContain('export const AUTHZ_MANIFEST');
    expect(source).toContain('"getHealth"');
    expect(source).toContain('Object.freeze');
  });
});
