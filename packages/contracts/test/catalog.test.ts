import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AUTHZ_MANIFEST } from '../src/authz.ts';

interface BundledOperation {
  readonly parameters?: ReadonlyArray<{ readonly name: string; readonly in: string }>;
  readonly requestBody?: unknown;
}
const bundled = JSON.parse(readFileSync('dist/openapi.json', 'utf8')) as {
  paths: Record<string, Record<string, BundledOperation>>;
};

const catalogPaths = Object.entries(bundled.paths).filter(([path]) => path.startsWith('/api/v1/catalog/'));
const catalogOperations = Object.entries(AUTHZ_MANIFEST).filter(([, operation]) => operation.path.startsWith('/api/v1/catalog/'));

describe('catalog contract (EVM-019 AC6, AC7; SR-AUTHZ-01, SR-AUTHZ-12)', () => {
  it('EVM-019 AC6 the catalog paths have only GET operations: configuration cannot be changed through the API in M1', () => {
    expect(catalogPaths.map(([path]) => path).sort()).toEqual([
      '/api/v1/catalog/document-kinds',
      '/api/v1/catalog/procedure-templates',
      '/api/v1/catalog/service-items',
      '/api/v1/catalog/work-order-templates',
      '/api/v1/catalog/work-order-templates/{templateId}',
    ]);
    for (const [path, item] of catalogPaths) {
      expect(Object.keys(item), path).toEqual(['get']);
      expect(item['get']?.requestBody, path).toBeUndefined();
    }
  });

  it('EVM-019 AC7 every catalog operation is for the three roles on the web channel, with no public, MFA-enrolment, step-up or audit exception', () => {
    expect(catalogOperations.map(([id]) => id).sort()).toEqual([
      'getWorkOrderTemplate',
      'listDocumentKinds',
      'listProcedureTemplates',
      'listServiceItems',
      'listWorkOrderTemplates',
    ]);
    for (const [id, operation] of catalogOperations) {
      expect(operation.method, id).toBe('get');
      expect(operation.authz, id).toEqual({ roles: ['administrator', 'editor', 'read_only'], channels: ['web'] });
    }
  });

  it('EVM-019 AC4 the only query parameter is the siteTypeHint filter, the path parameter is a UUID', () => {
    expect(Object.fromEntries(catalogOperations.map(([id, operation]) => [id, operation.query]))).toEqual({
      listWorkOrderTemplates: ['siteTypeHint'],
      getWorkOrderTemplate: [],
      listServiceItems: [],
      listProcedureTemplates: [],
      listDocumentKinds: [],
    });
    const parameters = bundled.paths['/api/v1/catalog/work-order-templates/{templateId}']?.['get']?.parameters ?? [];
    expect(parameters).toEqual([expect.objectContaining({ name: 'templateId', in: 'path', schema: { type: 'string', format: 'uuid' } })]);
  });
});
