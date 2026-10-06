import { describe, expect, it } from 'vitest';
import { lintContract, redoclyEnv } from '../src/redocly.ts';
import eviaPlugin, {
  AuthzRequired,
  NoPersonalDataParameters,
  normalizeName,
  PublicAllowList,
  type RuleContext,
} from '../src/redocly-plugin.ts';

const fixture = (name: string) => `test/fixtures/${name}.yaml`;

/** A minimal visitor context that records reported messages. */
function context() {
  const messages: string[] = [];
  const location = { child: () => location };
  const ctx: RuleContext = { location, report: ({ message }) => messages.push(message) };
  return { ctx, messages };
}

describe('contract lint (EVM-008 AC2)', () => {
  it('EVM-008 AC2 contract lints clean', () => {
    const result = lintContract('openapi/openapi.yaml');
    expect(result.output).not.toMatch(/error/i);
    expect(result.status).toBe(0);
  });

  it.each([
    ['missing-authz', 'evia/authz-required'],
    ['public-outside-allow-list', 'evia/public-allow-list'],
    ['personal-data-parameters', 'evia/no-personal-data-parameters'],
    ['error-not-problem-json', 'rule/error-responses-are-problem-json'],
  ])('EVM-008 AC2 negative fixture %s fails lint with %s', (name, rule) => {
    const result = lintContract(fixture(name));
    expect(result.status).not.toBe(0);
    expect(result.output).toContain(rule);
  });

  it('EVM-008 AC2 Redocly runs without telemetry', () => {
    expect(redoclyEnv({ PATH: '/bin' })).toEqual({ PATH: '/bin', REDOCLY_TELEMETRY: 'off', REDOCLY_SUPPRESS_UPDATE_NOTICE: 'true' });
  });
});

describe('Redocly plugin rules (EVM-008 AC2, SR-AUTHZ-01, SR-API-04)', () => {
  it('EVM-008 AC2 registers the evia rules for OpenAPI 3', () => {
    const plugin = eviaPlugin();
    expect(plugin.id).toBe('evia');
    expect(Object.keys(plugin.rules.oas3)).toEqual(['authz-required', 'public-allow-list', 'no-personal-data-parameters']);
  });

  it('EVM-008 AC2 authz-required reports an operation without an x-evia-authz object', () => {
    for (const operation of [{}, { 'x-evia-authz': true }, { 'x-evia-authz': ['public'] }]) {
      const { ctx, messages } = context();
      AuthzRequired().Operation(operation, ctx);
      expect(messages, JSON.stringify(operation)).toHaveLength(1);
    }
    const { ctx, messages } = context();
    AuthzRequired().Operation({ 'x-evia-authz': { roles: ['administrator'] } }, ctx);
    expect(messages).toEqual([]);
  });

  it('EVM-008 AC2 public-allow-list accepts public only for allow-listed operations with the value true', () => {
    const check = (operation: Record<string, unknown>) => {
      const { ctx, messages } = context();
      PublicAllowList().Operation(operation, ctx);
      return messages;
    };
    expect(check({ operationId: 'getHealth', 'x-evia-authz': { public: true } })).toEqual([]);
    expect(check({ operationId: 'listWorkOrders', 'x-evia-authz': { roles: ['editor'] } })).toEqual([]);
    expect(check({ operationId: 'listWorkOrders' })).toEqual([]);
    expect(check({ operationId: 'listWorkOrders', 'x-evia-authz': { public: true } })).toHaveLength(1);
    expect(check({ 'x-evia-authz': { public: true } })[0]).toContain('(bez operationId)');
    expect(check({ operationId: 'getHealth', 'x-evia-authz': { public: 'yes' } })).toHaveLength(1);
  });

  it('EVM-008 AC2 no-personal-data-parameters compares normalised names, also as substrings', () => {
    const check = (parameter: Record<string, unknown>) => {
      const { ctx, messages } = context();
      NoPersonalDataParameters().Parameter(parameter, ctx);
      return messages;
    };
    expect(normalizeName('Customer_E-mail.Address')).toBe('customeremailaddress');
    for (const name of ['email', 'customerEmail', 'phone_number', 'Last-Name', 'street', 'PESEL', 'meteringPointId', 'accessToken'])
      for (const place of ['query', 'path']) expect(check({ name, in: place }), `${place} ${name}`).toHaveLength(1);
    expect(check({ name: 'customerEmail', in: 'header' })).toEqual([]);
    expect(check({ name: 'workOrderId', in: 'path' })).toEqual([]);
    expect(check({ name: 'cursor', in: 'query' })).toEqual([]);
    expect(check({ in: 'query' })).toEqual([]);
  });
});
