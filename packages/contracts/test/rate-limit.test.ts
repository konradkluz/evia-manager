import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type Json = Record<string, unknown>;
const bundled = JSON.parse(readFileSync('dist/openapi.json', 'utf8')) as {
  paths: Record<string, Record<string, Json>>;
  components: { responses: Record<string, Json> };
};

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

/** Every operation of the contract, found by walking the paths — no list of operations to keep up to date. */
const operations = Object.entries(bundled.paths).flatMap(([path, item]) =>
  METHODS.filter((method) => item[method] !== undefined).map((method) => ({ path, method, operation: item[method] as Json })),
);
const needsSession = operations.filter(({ operation }) => (operation['x-evia-authz'] as { public?: boolean } | undefined)?.public !== true);

const resolve = (response: Json | undefined): Json | undefined => {
  const ref = response?.['$ref'];
  return typeof ref === 'string' ? bundled.components.responses[ref.split('/').pop() ?? ''] : response;
};

describe('per-user limit in the contract (EVM-082 AC4; SR-API-02)', () => {
  it('EVM-082 AC4 the walk finds the operations of the contract, both with and without a session', () => {
    expect(needsSession.length).toBeGreaterThan(20);
    expect(operations.length).toBeGreaterThan(needsSession.length);
  });

  it('EVM-082 AC4 every operation that needs a session answers 429 RateLimited with Retry-After (the limit covers all of them)', () => {
    const missing = needsSession
      .filter(({ operation }) => {
        const response = (operation['responses'] as Record<string, Json>)['429'];
        const resolved = resolve(response);
        const headers = resolved?.['headers'] as Json | undefined;
        const content = resolved?.['content'] as Json | undefined;
        return (
          !['#/components/responses/RateLimited', '#/components/responses/MobileRateLimited'].includes(String(response?.['$ref'])) ||
          headers?.['Retry-After'] === undefined ||
          content?.['application/problem+json'] === undefined
        );
      })
      .map(({ method, path, operation }) => `${method.toUpperCase()} ${path} (${String(operation['operationId'])})`);
    expect(missing).toEqual([]);
  });
});
