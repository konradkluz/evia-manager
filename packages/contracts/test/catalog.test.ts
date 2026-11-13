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
      // EVM-127 AC3: the list of templates is the one operation of the catalog that is also open to the phone; the roles stay (the phone refuses read_only itself)
      const channels = id === 'listWorkOrderTemplates' ? ['web', 'mobile'] : ['web'];
      expect(operation.authz, id).toEqual({ roles: ['administrator', 'editor', 'read_only'], channels });
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

describe('EVM-127 the list of work order templates for the phone (SR-AUTHZ-12, SR-DATA-03; ASVS V8.2.3, V15.3.1)', () => {
  const operation = bundled.paths['/api/v1/catalog/work-order-templates']?.['get'] as Record<string, unknown> | undefined;
  type Node = Record<string, unknown>;
  const components = (JSON.parse(readFileSync('dist/openapi.json', 'utf8')) as { components: { schemas: Record<string, Node> } }).components
    .schemas;

  /** Every property name reachable from the schema, following `$ref`s — the fields the phone can ever receive. */
  const fieldsOf = (node: unknown, seen = new Set<string>()): Set<string> => {
    const fields = new Set<string>();
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      if (typeof value !== 'object' || value === null) return;
      const object = value as Node;
      const ref = object['$ref'];
      if (typeof ref === 'string') {
        const name = ref.replace('#/components/schemas/', '');
        if (seen.has(name)) return;
        seen.add(name);
        visit(components[name]);
        return;
      }
      for (const name of Object.keys((object['properties'] as Node | undefined) ?? {})) fields.add(name);
      Object.values(object).forEach(visit);
    };
    visit(node);
    return fields;
  };

  it('EVM-127 AC3 the operation is for the web and the mobile channel, declares no security scheme and no step-up, and sets no cookie', () => {
    expect(AUTHZ_MANIFEST['listWorkOrderTemplates']?.authz).toEqual({
      roles: ['administrator', 'editor', 'read_only'],
      channels: ['web', 'mobile'],
    });
    expect(operation?.['security']).toBeUndefined();
    const headers = JSON.stringify(operation?.['responses']).toLowerCase();
    expect(headers).not.toContain('set-cookie');
  });

  it('EVM-127 AC3 the response has exactly the catalog fields: no customer, user, amount or order data (allow-list of every reachable property)', () => {
    const schema = (operation?.['responses'] as Record<string, Node>)['200'];
    expect([...fieldsOf(schema)].sort()).toEqual(
      [
        'code',
        'defaultParameters',
        'defaultQuantity',
        'id',
        'invoiceHint',
        'isActive',
        'items',
        'name',
        'nextCursor',
        'parameterSetCode',
        'paymentMilestones',
        'paymentTermDays',
        'position',
        'procedures',
        'sharePercent',
        'siteTypeHint',
        'stageCount',
      ].sort(),
    );
  });
});
