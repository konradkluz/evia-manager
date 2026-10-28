import { describe, expect, it } from 'vitest';
import { lintContract, redoclyEnv } from '../src/redocly.ts';
import eviaPlugin, {
  AuthzRequired,
  ChannelsRequired,
  MfaEnrollmentAllowList,
  MobileChannelAllowList,
  MobileNoSetCookie,
  NoPersonalDataParameters,
  normalizeName,
  PlannedMarker,
  PublicAllowList,
  PublicChannels,
  SecuritySchemeChannel,
  StepUpWebOnly,
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
    ['mobile-in-m1', 'evia/mobile-channel-allow-list'],
    ['mobile-with-step-up', 'evia/mobile-channel-allow-list'],
    ['step-up-not-web-only', 'evia/step-up-web-only'],
    ['missing-channels', 'evia/channels-required'],
    ['mfa-enrollment-outside-allow-list', 'evia/mfa-enrollment-allow-list'],
    ['public-two-channels', 'evia/public-channels'],
    ['mobile-bearer-on-web', 'evia/security-scheme-channel'],
    ['web-session-on-mobile', 'evia/security-scheme-channel'],
    ['mobile-without-bearer', 'evia/security-scheme-channel'],
    ['mobile-set-cookie', 'evia/mobile-no-set-cookie'],
    ['planned-not-true', 'evia/planned-marker'],
    ['token-in-header', 'evia/no-personal-data-parameters'],
  ])('EVM-008 AC2 negative fixture %s fails lint with %s (EVM-016 AC8 for the channel rules)', (name, rule) => {
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
    expect(Object.keys(plugin.rules.oas3)).toEqual([
      'authz-required',
      'public-allow-list',
      'no-personal-data-parameters',
      'channels-required',
      'mobile-channel-allow-list',
      'step-up-web-only',
      'mfa-enrollment-allow-list',
      'public-channels',
      'security-scheme-channel',
      'mobile-no-set-cookie',
      'planned-marker',
    ]);
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

describe('Redocly plugin channel and enrollment rules (EVM-016 AC4, AC8; SR-AUTHZ-12)', () => {
  const run = (visitor: { Operation(operation: Record<string, unknown>, ctx: RuleContext): void }, operation: Record<string, unknown>) => {
    const { ctx, messages } = context();
    visitor.Operation(operation, ctx);
    return messages;
  };

  it('EVM-016 AC8 channels-required wants web and/or mobile on every non-public operation', () => {
    const rule = ChannelsRequired();
    expect(run(rule, { 'x-evia-authz': { public: true } })).toEqual([]);
    expect(run(rule, { 'x-evia-authz': { roles: ['editor'], channels: ['web'] } })).toEqual([]);
    for (const channels of [undefined, [], ['desktop'], 'web', ['web', 5]]) {
      expect(run(rule, { 'x-evia-authz': { roles: ['editor'], channels } }), JSON.stringify(channels)).toHaveLength(1);
    }
    expect(run(rule, {})).toEqual([]);
  });

  it('EVM-016 AC8 mobile-channel-allow-list rejects mobile before E9 and mobile with step-up', () => {
    const rule = MobileChannelAllowList();
    expect(run(rule, { operationId: 'listWorkOrders', 'x-evia-authz': { channels: ['web'] } })).toEqual([]);
    expect(run(rule, { 'x-evia-authz': { channels: 'mobile' } })).toEqual([]);
    expect(run(rule, {})).toEqual([]);
    expect(run(rule, { operationId: 'listWorkOrders', 'x-evia-authz': { channels: ['web', 'mobile'] } })).toHaveLength(1);
    expect(run(rule, { 'x-evia-authz': { channels: ['mobile'] } })[0]).toContain('(bez operationId)');
    expect(run(rule, { operationId: 'x', 'x-evia-authz': { channels: ['mobile'], stepUp: true } })).toHaveLength(2);
  });

  it('EVM-029 AC7 step-up-web-only wants channels exactly [web] on an operation with stepUp: true', () => {
    const rule = StepUpWebOnly();
    expect(
      run(rule, { operationId: 'listAuditEvents', 'x-evia-authz': { roles: ['administrator'], channels: ['web'], stepUp: true } }),
    ).toEqual([]);
    expect(run(rule, { operationId: 'x', 'x-evia-authz': { channels: ['web', 'mobile'] } })).toEqual([]);
    expect(run(rule, { 'x-evia-authz': { channels: ['mobile'], stepUp: false } })).toEqual([]);
    expect(run(rule, {})).toEqual([]);
    for (const channels of [undefined, [], ['mobile'], ['web', 'mobile'], 'web']) {
      expect(run(rule, { operationId: 'x', 'x-evia-authz': { channels, stepUp: true } }), JSON.stringify(channels)).toHaveLength(1);
    }
    expect(run(rule, { 'x-evia-authz': { stepUp: true } })[0]).toContain('(bez operationId)');
  });

  it('EVM-016 AC4 mfa-enrollment-allow-list accepts the flag only on the listed operations', () => {
    const rule = MfaEnrollmentAllowList();
    expect(run(rule, { operationId: 'registerPasskey', 'x-evia-authz': { allowDuringMfaEnrollment: true } })).toEqual([]);
    expect(run(rule, { operationId: 'listWorkOrders', 'x-evia-authz': { allowDuringMfaEnrollment: false } })).toEqual([]);
    expect(run(rule, { operationId: 'listWorkOrders', 'x-evia-authz': {} })).toEqual([]);
    expect(run(rule, {})).toEqual([]);
    expect(run(rule, { operationId: 'listWorkOrders', 'x-evia-authz': { allowDuringMfaEnrollment: true } })).toHaveLength(1);
    expect(run(rule, { 'x-evia-authz': { allowDuringMfaEnrollment: true } })[0]).toContain('(bez operationId)');
  });
});

describe('Redocly plugin rules of the mobile channel (EVM-090 AC1; SR-AUTHZ-12, SR-API-04)', () => {
  const run = (visitor: { Operation(operation: Record<string, unknown>, ctx: RuleContext): void }, operation: Record<string, unknown>) => {
    const { ctx, messages } = context();
    visitor.Operation(operation, ctx);
    return messages;
  };

  it('EVM-090 AC1 secrets and tokens are forbidden in query, path, cookie and header parameters (SR-API-04, CWE-598); the idempotency key and the CSRF token are not credentials', () => {
    const check = (parameter: Record<string, unknown>) => {
      const { ctx, messages } = context();
      NoPersonalDataParameters().Parameter(parameter, ctx);
      return messages;
    };
    for (const name of [
      'token',
      'refreshToken',
      'code',
      'challengeToken',
      'installationSecret',
      'deviceSecret',
      'password',
      'apiKey',
      'key',
    ]) {
      for (const place of ['query', 'path', 'cookie', 'header']) expect(check({ name, in: place }), `${place} ${name}`).toHaveLength(1);
    }
    expect(check({ name: 'Idempotency-Key', in: 'header' })).toEqual([]);
    expect(check({ name: 'X-CSRF-Token', in: 'header' })).toEqual([]);
    expect(check({ name: 'Idempotency-Key', in: 'query' })).toHaveLength(1);
    for (const name of ['X-Client-Platform', 'X-Client-Version', 'If-Match', 'Authorization'])
      expect(check({ name, in: 'header' }), name).toEqual([]);
    expect(check({ name: 'pendingItems', in: 'query' })).toEqual([]);
    for (const place of ['query', 'path']) expect(check({ name: 'passkeyId', in: place })).toEqual([]);
    expect(check({ name: 'Recovery-Code', in: 'header' })).toHaveLength(1);
    expect(check({ name: 'customerEmail', in: 'cookie' })).toEqual([]);
  });

  it('EVM-090 AC1 public-channels: a public operation has exactly one channel; with mobile it is on the public and mobile lists', () => {
    const rule = PublicChannels();
    expect(run(rule, { operationId: 'getHealth', 'x-evia-authz': { public: true } })).toEqual([]);
    expect(run(rule, { operationId: 'login', 'x-evia-authz': { public: true, channels: ['web'] } })).toEqual([]);
    expect(run(rule, { operationId: 'mobileLogin', 'x-evia-authz': { public: true, channels: ['mobile'] } })).toEqual([]);
    expect(run(rule, { operationId: 'listWorkOrders', 'x-evia-authz': { roles: ['editor'], channels: ['web', 'mobile'] } })).toEqual([]);
    expect(run(rule, {})).toEqual([]);
    for (const channels of [['web', 'mobile'], [], ['desktop'], 'mobile']) {
      expect(run(rule, { operationId: 'mobileLogin', 'x-evia-authz': { public: true, channels } }), JSON.stringify(channels)).toHaveLength(
        1,
      );
    }
    expect(run(rule, { operationId: 'login', 'x-evia-authz': { public: true, channels: ['mobile'] } })).toHaveLength(1);
    expect(run(rule, { operationId: 'getSyncChanges', 'x-evia-authz': { public: true, channels: ['mobile'] } })).toHaveLength(1);
    expect(run(rule, { 'x-evia-authz': { public: true, channels: ['mobile'] } })[0]).toContain('(bez operationId)');
  });

  it('EVM-090 AC1 security-scheme-channel: mobileBearer only on [mobile], webSession only on [web], a public operation has none, an authenticated mobile one has mobileBearer', () => {
    const rule = SecuritySchemeChannel();
    const bearer = [{ mobileBearer: [] }];
    expect(run(rule, { operationId: 'a', security: bearer, 'x-evia-authz': { roles: ['editor'], channels: ['mobile'] } })).toEqual([]);
    expect(
      run(rule, { operationId: 'a', security: [{ webSession: [] }], 'x-evia-authz': { roles: ['editor'], channels: ['web'] } }),
    ).toEqual([]);
    expect(run(rule, { operationId: 'a', security: [], 'x-evia-authz': { public: true, channels: ['mobile'] } })).toEqual([]);
    expect(run(rule, { operationId: 'a', 'x-evia-authz': { public: true } })).toEqual([]);
    expect(run(rule, { operationId: 'a', 'x-evia-authz': { roles: ['editor'], channels: ['web'] } })).toEqual([]);
    expect(run(rule, {})).toEqual([]);
    expect(run(rule, { operationId: 'a', security: bearer, 'x-evia-authz': { roles: ['editor'], channels: ['web'] } })).toHaveLength(1);
    expect(
      run(rule, { operationId: 'a', security: bearer, 'x-evia-authz': { roles: ['editor'], channels: ['web', 'mobile'] } }),
    ).toHaveLength(1);
    expect(
      run(rule, { operationId: 'a', security: [{ webSession: [] }], 'x-evia-authz': { roles: ['editor'], channels: ['mobile'] } }),
    ).toHaveLength(2);
    expect(run(rule, { operationId: 'a', security: [{ webSession: [] }], 'x-evia-authz': { public: true } })).toHaveLength(1);
    expect(
      run(rule, { operationId: 'a', security: ['x', { mobileBearer: [] }], 'x-evia-authz': { public: true, channels: ['mobile'] } }),
    ).toHaveLength(1);
    expect(run(rule, { operationId: 'a', 'x-evia-authz': { roles: ['editor'], channels: ['mobile'] } })).toHaveLength(1);
  });

  it('EVM-090 AC1 mobile-no-set-cookie: a response of a mobile operation sets no cookie, inline or by reference', () => {
    const rule = MobileNoSetCookie();
    const mobile = { roles: ['editor'], channels: ['mobile'] };
    expect(run(rule, { operationId: 'a', 'x-evia-authz': mobile })).toEqual([]);
    expect(
      run(rule, { operationId: 'a', 'x-evia-authz': mobile, responses: { '200': { headers: { 'Cache-Control': {} } }, '204': null } }),
    ).toEqual([]);
    expect(
      run(rule, {
        operationId: 'a',
        'x-evia-authz': { roles: ['editor'], channels: ['web'] },
        responses: { '200': { headers: { 'Set-Cookie': {} } } },
      }),
    ).toEqual([]);
    expect(run(rule, { operationId: 'a', 'x-evia-authz': mobile, responses: { '200': { headers: { 'set-cookie': {} } } } })).toHaveLength(
      1,
    );
    expect(
      run(rule, {
        operationId: 'a',
        'x-evia-authz': { public: true, channels: ['mobile'] },
        responses: { '200': { headers: { 'Set-Cookie': {} } } },
      }),
    ).toHaveLength(1);
    const { ctx, messages } = context();
    ctx.resolve = () => ({ node: { headers: { 'Set-Cookie': {} } } });
    rule.Operation({ operationId: 'a', 'x-evia-authz': mobile, responses: { '200': { $ref: '#/components/responses/X' } } }, ctx);
    expect(messages).toHaveLength(1);
    const { ctx: bare, messages: none } = context();
    rule.Operation({ operationId: 'a', 'x-evia-authz': mobile, responses: { '200': { $ref: '#/components/responses/X' } } }, bare);
    expect(none).toEqual([]);
  });

  it('EVM-090 AC1 planned-marker: x-evia-planned is true or absent', () => {
    const rule = PlannedMarker();
    expect(run(rule, { operationId: 'a', 'x-evia-planned': true })).toEqual([]);
    expect(run(rule, { operationId: 'a' })).toEqual([]);
    for (const value of [false, 'true', 1, null])
      expect(run(rule, { operationId: 'a', 'x-evia-planned': value }), String(value)).toHaveLength(1);
  });
});
