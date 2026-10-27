/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any -- this test walks the untyped bundle (dist/openapi.json) by JSON pointers */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AUTHZ_MANIFEST,
  implementedManifest,
  implementedOperations,
  onlyImplemented,
  MOBILE_OPERATIONS,
  operationChannels,
  plannedOperations,
  PUBLIC_OPERATIONS,
} from '../src/authz.ts';
import {
  confirmDeviceWipe,
  getClientConfig,
  getSyncChanges,
  getSyncWorkOrder,
  mobileLogin,
  mobileLoginTotp,
  mobileLogout,
  pushSyncMutations,
  refreshMobileSession,
  type MobileSession,
  type SyncChangesResponse,
} from '../src/index.ts';
import { NoPersonalDataParameters, type RuleContext } from '../src/redocly-plugin.ts';
import {
  zClientConfig,
  zMobileLoginChallenge,
  zMobileLoginRequestWritable,
  zMobileLoginTotpRequest,
  zMobileSession,
  zSyncChange,
  zSyncChangesResponse,
  zSyncMutationsRequest,
  zSyncMutationsResponse,
  zSyncWorkOrderSnapshot,
  zWipeConfirmationRequestWritable,
} from '../src/zod.ts';

type Json = Record<string, any>;

const bundle = JSON.parse(readFileSync('dist/openapi.json', 'utf8')) as Json;
const METHODS = ['get', 'put', 'post', 'delete', 'patch'];

const operations = Object.entries(bundle['paths'] as Json).flatMap(([path, item]) =>
  METHODS.filter((method) => (item as Json)[method] !== undefined).map((method) => ({
    id: (item as Json)[method].operationId as string,
    path,
    method,
    operation: (item as Json)[method] as Json,
  })),
);
const operation = (id: string): Json => {
  const found = operations.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`${id} is not in the contract`);
  return found.operation;
};
const schemas = bundle['components'].schemas as Json;

/** A local `$ref` of the bundle resolved. */
const resolve = (node: any): any => {
  if (node !== null && typeof node === 'object' && typeof node['$ref'] === 'string') {
    return resolve(
      node['$ref']
        .replace(/^#\//, '')
        .split('/')
        .reduce((target: any, key) => target?.[key], bundle),
    );
  }
  return node;
};

/** Every schema reachable from `root` (references followed once), with the pointer of each. */
function walk(root: unknown, visit: (schema: Json, pointer: string) => void): void {
  const seen = new Set<unknown>();
  const go = (node: unknown, pointer: string): void => {
    const schema = resolve(node);
    if (schema === null || typeof schema !== 'object' || seen.has(schema)) return;
    seen.add(schema);
    visit(schema as Json, pointer);
    for (const [name, property] of Object.entries((schema as Json)['properties'] ?? {})) go(property, `${pointer}/${name}`);
    for (const key of ['items', 'additionalProperties']) go((schema as Json)[key], `${pointer}/${key}`);
    for (const key of ['oneOf', 'anyOf', 'allOf'])
      ((schema as Json)[key] ?? []).forEach((branch: unknown, index: number) => {
        go(branch, `${pointer}/${key}${index}`);
      });
  };
  go(root, '');
}

const requestSchemas = (id: string): unknown[] => [
  ...((operation(id)['parameters'] as unknown[] | undefined) ?? []).map((parameter): unknown => resolve(parameter)['schema']),
  operation(id)['requestBody']?.content?.['application/json']?.schema,
];

const NEW_OPERATIONS = [
  'mobileLogin',
  'mobileLoginTotp',
  'refreshMobileSession',
  'mobileLogout',
  'confirmDeviceWipe',
  'getClientConfig',
  'getSyncChanges',
  'getSyncWorkOrder',
  'pushSyncMutations',
] as const;
const PUBLIC_MOBILE = ['mobileLogin', 'mobileLoginTotp', 'refreshMobileSession', 'confirmDeviceWipe'] as const;

describe('EVM-090 AC1 the mobile family in the contract (SR-AUTHZ-12, SR-AUTHZ-01)', () => {
  it('EVM-090 AC1 the paths are the ones of the story and the four public operations are public on the mobile channel only', () => {
    const paths = Object.fromEntries(NEW_OPERATIONS.map((id) => [id, `${AUTHZ_MANIFEST[id]?.method} ${AUTHZ_MANIFEST[id]?.path}`]));
    expect(paths).toEqual({
      mobileLogin: 'post /api/v1/auth/mobile/login',
      mobileLoginTotp: 'post /api/v1/auth/mobile/login/totp',
      refreshMobileSession: 'post /api/v1/auth/mobile/token',
      mobileLogout: 'post /api/v1/auth/mobile/logout',
      confirmDeviceWipe: 'post /api/v1/devices/current/wipe-confirmation',
      getClientConfig: 'get /api/v1/meta/client-config',
      getSyncChanges: 'get /api/v1/sync/changes',
      getSyncWorkOrder: 'get /api/v1/sync/work-orders/{workOrderId}',
      pushSyncMutations: 'post /api/v1/sync/mutations',
    });
    for (const id of PUBLIC_MOBILE) {
      expect(AUTHZ_MANIFEST[id]?.authz, id).toEqual({ public: true, channels: ['mobile'] });
      expect(PUBLIC_OPERATIONS, id).toContain(id);
      expect(MOBILE_OPERATIONS, id).toContain(id);
    }
  });

  it('EVM-090 AC1 a public operation without channels belongs to the panel (default [web]); the channels of the others are as declared', () => {
    expect(operationChannels({ public: true })).toEqual(['web']);
    expect(operationChannels({ public: true, channels: ['mobile'] })).toEqual(['mobile']);
    expect(operationChannels({ roles: ['editor'], channels: ['web', 'mobile'] })).toEqual(['web', 'mobile']);
    expect(operationChannels(AUTHZ_MANIFEST['login']?.authz ?? {})).toEqual(['web']);
  });

  it('EVM-090 AC1 the four authenticated mobile operations are for the Administrator and the Editor on the mobile channel — never read_only, never web', () => {
    for (const id of ['mobileLogout', 'getClientConfig', 'getSyncChanges', 'getSyncWorkOrder', 'pushSyncMutations']) {
      expect(AUTHZ_MANIFEST[id]?.authz.roles, id).toEqual(['administrator', 'editor']);
      expect(AUTHZ_MANIFEST[id]?.authz.channels, id).toEqual(['mobile']);
      expect(AUTHZ_MANIFEST[id]?.authz.stepUp, id).toBeUndefined();
    }
  });

  it('EVM-090 AC1 exactly two security schemes exist; mobileBearer only on the mobile operations, none on a web operation and none on a public one', () => {
    expect(Object.keys(bundle['components'].securitySchemes).sort()).toEqual(['mobileBearer', 'webSession']);
    expect(bundle['components'].securitySchemes.mobileBearer).toMatchObject({ type: 'http', scheme: 'bearer' });
    expect(bundle['components'].securitySchemes.webSession).toMatchObject({ type: 'apiKey', in: 'cookie', name: '__Host-evia_session' });
    expect(bundle['security']).toEqual([]);
    for (const { id, operation: item } of operations) {
      const channels = operationChannels(AUTHZ_MANIFEST[id]?.authz ?? {});
      const isPublic = AUTHZ_MANIFEST[id]?.authz.public === true;
      const names = ((item['security'] as Json[] | undefined) ?? []).flatMap((entry) => Object.keys(entry));
      if (channels.length === 1 && channels[0] === 'mobile' && !isPublic) expect(names, id).toEqual(['mobileBearer']);
      else expect(names, id).toEqual([]);
      if (!MOBILE_OPERATIONS.includes(id)) expect(item['security'], `${id} stays as it was`).toBeUndefined();
    }
  });

  it('EVM-090 AC1 no response of a mobile operation sets a cookie, and no operation takes a token, a secret or a code in a URL, a cookie or a header other than Authorization', () => {
    const found: string[] = [];
    const ctx: RuleContext = { location: { child: () => ctx.location }, report: ({ message }) => found.push(message) };
    for (const { id, operation: item } of operations) {
      for (const parameter of (item['parameters'] ?? []) as unknown[]) NoPersonalDataParameters().Parameter(resolve(parameter), ctx);
      if (MOBILE_OPERATIONS.includes(id)) {
        for (const response of Object.values(item['responses'] as Json)) {
          const headers = Object.keys(resolve(response)['headers'] ?? {}).map((name) => name.toLowerCase());
          expect(headers, id).not.toContain('set-cookie');
        }
      }
    }
    expect(found).toEqual([]);
    for (const id of NEW_OPERATIONS) {
      const parameters = ((operation(id)['parameters'] ?? []) as unknown[]).map((parameter) => resolve(parameter));
      for (const parameter of parameters) {
        expect(['query', 'path', 'header'], id).toContain(parameter['in']);
        expect(String(parameter['name']), id).not.toMatch(/token|secret|password|code|challenge|refresh/i);
      }
    }
  });

  it("EVM-090 AC1 the story's own endpoints are in the manifest, tokens never in the URL: `deviceId` is not in any path", () => {
    for (const { path } of operations) expect(path.toLowerCase()).not.toMatch(/deviceid|\{token|\{secret/);
    expect(AUTHZ_MANIFEST['confirmDeviceWipe']?.path).toBe('/api/v1/devices/current/wipe-confirmation');
  });
});

describe('EVM-090 planned operations (x-evia-planned; deny-by-default, SR-AUTHZ)', () => {
  const marked = operations.filter(({ operation: item }) => item['x-evia-planned'] === true).map(({ id }) => id);

  it('EVM-090 AC1 planned = the operations marked in the contract (the marker is the only source), and implemented ∪ planned = every operation', () => {
    expect(plannedOperations().sort()).toEqual(marked.sort());
    expect(marked.sort()).toEqual([...NEW_OPERATIONS].sort());
    expect([...implementedOperations(), ...plannedOperations()].sort()).toEqual(Object.keys(AUTHZ_MANIFEST).sort());
    expect(implementedOperations().filter((id) => plannedOperations().includes(id))).toEqual([]);
    expect(Object.keys(implementedManifest()).sort()).toEqual(implementedOperations().sort());
    expect(Object.keys(implementedManifest()).length).toBe(Object.keys(AUTHZ_MANIFEST).length - NEW_OPERATIONS.length);
  });

  it('EVM-090 AC1 onlyImplemented drops the planned ids of a list such as PUBLIC_OPERATIONS and keeps the others in order', () => {
    expect(onlyImplemented(['login', 'mobileLogin', 'getHealth', 'confirmDeviceWipe', 'unknownId'])).toEqual([
      'login',
      'getHealth',
      'unknownId',
    ]);
    expect(onlyImplemented(PUBLIC_OPERATIONS).sort()).toEqual(
      PUBLIC_OPERATIONS.filter((id) => !PUBLIC_MOBILE.includes(id as never)).sort(),
    );
  });

  it('EVM-090 AC1 a planned operation already carries its full policy, so removing the marker switches the role matrix on (roles, channels, mobile list)', () => {
    for (const id of plannedOperations()) {
      const authz = AUTHZ_MANIFEST[id]?.authz;
      expect(MOBILE_OPERATIONS, id).toContain(id);
      expect(authz?.channels, id).toEqual(['mobile']);
      if (authz?.public === true) expect(PUBLIC_OPERATIONS, id).toContain(id);
      else expect(authz?.roles?.length ?? 0, id).toBeGreaterThan(0);
    }
    expect(AUTHZ_MANIFEST['getSyncWorkOrder']?.authz).toMatchObject({ policy: 'sync.deviceScope', anchor: 'path.workOrderId' });
    expect(AUTHZ_MANIFEST['getSyncWorkOrder']?.planned).toBe(true);
    expect(AUTHZ_MANIFEST['getHealth']?.planned).toBeUndefined();
  });
});

describe('EVM-090 AC2 registration of the device and the wipe confirmation', () => {
  const login = schemas['MobileLoginRequest'];
  const device = schemas['MobileDeviceInfo'];

  it('EVM-090 AC2 the first sign-in carries no deviceId (the server assigns it); a repeated one adds the pair deviceId + installation secret, both optional', () => {
    expect(login.required.sort()).toEqual(['device', 'email', 'password']);
    expect(Object.keys(login.properties).sort()).toEqual([
      'device',
      'deviceId',
      'devicePublicKey',
      'email',
      'installationSecret',
      'password',
    ]);
    expect(login.additionalProperties).toBe(false);
    expect(login.description).toMatch(/deviceId.*nadaje serwer/);
    expect(
      zMobileLoginRequestWritable.safeParse({
        email: 'a@example.test',
        password: 'x',
        device: { model: 'Pixel 8', osVersion: '14', securityPatch: '2026-09-05' },
      }).success,
    ).toBe(true);
  });

  it('EVM-090 AC2 the device is exactly {model, osVersion, securityPatch}, bounded, with no identifier of the hardware or of the advertising profile (MASVS-PRIVACY-1)', () => {
    expect(device.required.sort()).toEqual(['model', 'osVersion', 'securityPatch']);
    expect(Object.keys(device.properties).sort()).toEqual(['model', 'osVersion', 'securityPatch']);
    expect(device.additionalProperties).toBe(false);
    for (const property of Object.values<Json>(device.properties)) {
      expect(property['maxLength']).toBeGreaterThan(0);
      expect(property['pattern']).toBeDefined();
    }
    const serialised = JSON.stringify(login).toLowerCase();
    for (const forbidden of ['imei', 'serialnumber', 'android_id', 'androidid', 'advertising']) expect(serialised).not.toContain(forbidden);
    const base = { email: 'a@example.test', password: 'x' };
    const parse = (value: unknown) => zMobileLoginRequestWritable.safeParse({ ...base, device: value }).success;
    expect(parse({ model: 'Pixel 8', osVersion: '14', securityPatch: '2026-09-05' })).toBe(true);
    for (const bad of [
      { model: 'Pixel 8', osVersion: '14' },
      { model: 'Pixel 8', osVersion: '14', securityPatch: '5 Sep', imei: '1' },
      { model: '<x>', osVersion: '14', securityPatch: '2026-09-05' },
    ]) {
      expect(parse(bad), JSON.stringify(bad)).toBe(false);
    }
  });

  it('EVM-090 AC2 devicePublicKey is optional, has a format and a bound; the pair deviceId + installationSecret is a UUID and a 256-bit secret, the secret is write-only', () => {
    expect(login.required).not.toContain('devicePublicKey');
    expect(schemas['MobileLoginRequest'].properties.devicePublicKey).toMatchObject({ pattern: '^[A-Za-z0-9_-]{16,512}$', maxLength: 512 });
    expect(schemas['DeviceId']).toMatchObject({ format: 'uuid', maxLength: 36 });
    expect(schemas['InstallationSecret']).toMatchObject({ writeOnly: true, minLength: 43, maxLength: 43 });
    expect(schemas['MobileLoginRequest'].properties.password).toMatchObject({ writeOnly: true, maxLength: 256 });
    expect(schemas['MobileLoginRequest'].properties.email.maxLength).toBe(254);
  });

  it('EVM-090 AC2 the intermediate step is a one-time challenge token of at least 256 bits that lives at most 5 minutes; the code step is strictly {challengeToken, code}', () => {
    expect(schemas['MobileLoginChallenge'].required.sort()).toEqual(['challengeExpiresAt', 'challengeToken']);
    expect(schemas['MobileLoginChallenge'].properties.challengeToken).toMatchObject({ pattern: '^[A-Za-z0-9_-]{43}$' });
    expect(schemas['MobileLoginChallenge'].properties.challengeToken.description).toMatch(/jednorazowy.*5 minut/);
    expect(operation('mobileLogin')['description']).toContain('najwyżej 5 minut');
    const totp = schemas['MobileLoginTotpRequest'];
    expect(totp.additionalProperties).toBe(false);
    expect(Object.keys(totp.properties).sort()).toEqual(['challengeToken', 'code']);
    expect(totp.properties.code).toMatchObject({ pattern: '^[0-9]{6}$', writeOnly: true });
    expect(zMobileLoginTotpRequest.safeParse({ challengeToken: 'A'.repeat(43), code: '012345' }).success).toBe(true);
    for (const code of ['12345', '1234567', '12345a', ' 12345', 123456])
      expect(zMobileLoginTotpRequest.safeParse({ challengeToken: 'A'.repeat(43), code }).success, String(code)).toBe(false);
  });

  it('EVM-090 AC2 the answer carries deviceId, the tokens with both expiry times and the server time; the installation secret only for a new device, read-only', () => {
    const session = schemas['MobileSession'];
    expect(session.required.sort()).toEqual([
      'accessToken',
      'accessTokenExpiresAt',
      'deviceId',
      'refreshToken',
      'refreshTokenExpiresAt',
      'serverTime',
      'user',
    ]);
    expect(session.required).not.toContain('installationSecret');
    expect(session.properties.installationSecret).toMatchObject({ readOnly: true });
    expect(session.properties.installationSecret.description).toMatch(/KAŻDYM udanym logowaniu.*rotacja/s);
    expect(String(operation('mobileLoginTotp')['description'])).toMatch(/KAŻDE udane logowanie.*NOWY `installationSecret`/s);
    expect(Object.keys(schemas['MobileUser'].properties).sort()).toEqual(['displayName', 'id', 'role']);
  });

  it('EVM-090 AC2 the wipe confirmation takes the pair in the body (no deviceId in the path, no header, no security scheme), answers 204 idempotently and 401 with one message', () => {
    const wipe = operation('confirmDeviceWipe');
    expect(wipe['security']).toEqual([]);
    expect(wipe['parameters'].map((parameter: Json) => resolve(parameter).name)).toEqual(['X-Client-Platform', 'X-Client-Version']);
    expect(schemas['WipeConfirmationRequest']).toMatchObject({ additionalProperties: false, required: ['deviceId', 'installationSecret'] });
    expect(Object.keys(wipe['responses']).sort()).toEqual(['204', '400', '401', '413', '415', '429']);
    expect(wipe['description']).toMatch(/idempotentnie/);
    expect(wipe['description']).toMatch(/usuń dane, wyślij potwierdzenie, na końcu usuń sekret instalacji/);
    expect(
      zWipeConfirmationRequestWritable.safeParse({ deviceId: '0193a000-0000-7000-8000-0000000000d1', installationSecret: 'A'.repeat(43) })
        .success,
    ).toBe(true);
    expect(zWipeConfirmationRequestWritable.safeParse({ deviceId: 'nope', installationSecret: 'A'.repeat(43) }).success).toBe(false);
  });

  it('EVM-090 AC2 pendingItems is an optional integer 0..1000000 in the query of the pull and in the body of the push', () => {
    const query = (operation('getSyncChanges')['parameters'] as unknown[])
      .map((parameter) => resolve(parameter))
      .find((parameter) => parameter['name'] === 'pendingItems');
    expect(query).toMatchObject({ in: 'query', required: false });
    const field = resolve(query['schema']);
    expect(field).toMatchObject({ type: 'integer', minimum: 0, maximum: 1000000 });
    expect(schemas['SyncMutationsRequest'].properties.pendingItems).toBeDefined();
    expect(schemas['SyncMutationsRequest'].required).toEqual(['mutations']);
  });
});

describe('EVM-090 AC3 pulling changes and the snapshot of an order', () => {
  it('EVM-090 AC3 limit is 1..500 with the default 200 and the cursor is an opaque bounded base64url string', () => {
    const parameters = (operation('getSyncChanges')['parameters'] as unknown[]).map((parameter) => resolve(parameter));
    const limit = parameters.find((parameter) => parameter['name'] === 'limit');
    expect(limit['schema']).toMatchObject({ type: 'integer', minimum: 1, maximum: 500, default: 200 });
    const cursor = resolve(parameters.find((parameter) => parameter['name'] === 'cursor')['schema']);
    expect(cursor).toMatchObject({ pattern: '^[A-Za-z0-9_-]{16,1024}$', maxLength: 1024 });
    expect(cursor.description).toMatch(/resync_required/);
    expect(cursor.description).toMatch(/invalid_cursor/);
    expect(operation('getSyncChanges')['description']).toMatch(/1 MB/);
  });

  it('EVM-090 AC3 the answer is a page of changes or resync_required (oneOf with a discriminator), the reasons are an extensible vocabulary that includes periodic', () => {
    const response = schemas['SyncChangesResponse'];
    expect(response.oneOf).toHaveLength(2);
    expect(response.discriminator.propertyName).toBe('result');
    expect(Object.keys(response.discriminator.mapping).sort()).toEqual(['changes', 'resync_required']);
    const reason = schemas['SyncResyncRequired'].properties.reason;
    expect(reason.enum).toBeUndefined();
    expect(reason['x-extensible-enum']).toEqual(['periodic', 'cursor_invalid', 'cursor_expired', 'scope_changed', 'access_changed']);
    expect(schemas['SyncChangesPage'].required.sort()).toEqual(['changes', 'cursor', 'hasMore', 'phase', 'result', 'serverTime']);
    expect(schemas['SyncChangesPage'].properties.changes.maxItems).toBe(500);
    expect(schemas['SyncChange'].discriminator.propertyName).toBe('op');
  });

  it('EVM-090 AC3 an upsert carries the version of the object; a delete is exactly {op, type, id} and nothing else', () => {
    expect(schemas['SyncDelete']).toMatchObject({ additionalProperties: false, required: ['op', 'type', 'id'] });
    expect(Object.keys(schemas['SyncDelete'].properties).sort()).toEqual(['id', 'op', 'type']);
    expect(schemas['SyncUpsert'].required.sort()).toEqual(['entity', 'op']);
    const projections = ['WorkOrder', 'Customer', 'Site', 'Party', 'ScopeItem', 'ProcedureStage', 'TimelineEntry', 'MediaAsset', 'User'];
    for (const name of projections) {
      const entity = schemas[`Sync${name}`];
      expect(entity.required, name).toContain('version');
      expect(entity.properties.version, name).toMatchObject({ type: 'integer', minimum: 1 });
    }
    expect(schemas['SyncEntity'].required).toEqual(['type', 'id', 'version']);
  });

  it('EVM-090 AC3 the entity is an open envelope, not a closed union: an unknown type does not fail the page (forward compatibility, ADR-0004)', () => {
    const entity = schemas['SyncEntity'];
    expect(entity.oneOf).toBeUndefined();
    expect(entity.discriminator).toBeUndefined();
    expect(entity.additionalProperties).not.toBe(false);
    expect(entity.properties.type.$ref).toBe('#/components/schemas/SyncEntityType');
    expect(resolve(entity.properties.type)['x-extensible-enum']).toContain('work_order');
    expect(entity.description).toMatch(/POMIJA, zlicza w telemetrii i nie odrzuca strony/);
    expect(entity.description).toMatch(/podbija `scopeRuleVersion`/);
    const future = {
      op: 'upsert',
      entity: { type: 'assignment_from_the_future', id: '0193a000-0000-7000-8000-0000000000f1', version: 1, extra: true },
    };
    expect(zSyncChange.safeParse(future).success).toBe(true);
    expect(
      zSyncChange.safeParse({ op: 'delete', type: 'assignment_from_the_future', id: '0193a000-0000-7000-8000-0000000000f1' }).success,
    ).toBe(true);
  });

  it('EVM-090 AC3 every projection lists exactly the fields of the table "Projekcja pól na telefonie" and none of the excluded ones', () => {
    const fields = (name: string): string[] => Object.keys(schemas[name].properties).sort();
    expect(fields('SyncCustomer')).toEqual(['displayName', 'id', 'kind', 'phone', 'type', 'version']);
    expect(fields('SyncParty')).toEqual(['contactPersonName', 'displayName', 'id', 'kind', 'phone', 'type', 'version']);
    expect(fields('SyncUser')).toEqual(['displayName', 'id', 'type', 'version']);
    expect(fields('SyncSite')).toEqual(
      [
        'apartmentNumber',
        'buildingNumber',
        'city',
        'connectionPowerKw',
        'distributionSystemOperatorPartyId',
        'garageLevel',
        'id',
        'managerPartyId',
        'notes',
        'parkingSpotNumber',
        'postalCode',
        'siteType',
        'street',
        'type',
        'version',
      ].sort(),
    );
    const forbidden = [
      'email',
      'nip',
      'taxid',
      'legalform',
      'meteringpointid',
      'objectkey',
      'sha256',
      'originalfilename',
      'quarantinereason',
      'quarantine',
      'role',
      'lastloginat',
      'lastseenat',
      'payment',
      'auditevent',
      'postaladdress',
      'userid',
      'deviceid',
    ];
    const syncEntities = Object.keys(schemas).filter((name) =>
      /^Sync(WorkOrder|Customer|Site|Party|ScopeItem|ProcedureStage|TimelineEntry|MediaAsset|User)$/.test(name),
    );
    expect(syncEntities).toHaveLength(9);
    for (const name of syncEntities) {
      for (const property of Object.keys(schemas[name].properties))
        expect(forbidden, `${name}.${property}`).not.toContain(property.toLowerCase());
    }
    // notes of a customer and of a party are excluded; the notes of a site and of a scope item are fields of the projection
    expect(schemas['SyncCustomer'].properties.notes).toBeUndefined();
    expect(schemas['SyncParty'].properties.notes).toBeUndefined();
    expect(fields('SyncMediaAsset')).toEqual(
      expect.arrayContaining(['fileState', 'fileStateReasonCode', 'sizeBytes', 'durationSeconds', 'widthPx', 'heightPx']),
    );
  });

  it('EVM-090 AC3 every object of the sync and device schemas is closed and every string, array and object is bounded (SR-API-02, V2.2.1)', () => {
    const roots = [
      ...[
        'getSyncChanges',
        'getSyncWorkOrder',
        'pushSyncMutations',
        'getClientConfig',
        'mobileLogin',
        'mobileLoginTotp',
        'refreshMobileSession',
        'confirmDeviceWipe',
      ].flatMap((id) => [
        ...requestSchemas(id),
        ...Object.values(operation(id)['responses'] as Json).map((response) => resolve(response)['content']?.['application/json']?.schema),
      ]),
      // The projections are no longer reachable from SyncEntity (an open envelope), so they are checked as roots.
      ...['WorkOrder', 'Customer', 'Site', 'Party', 'ScopeItem', 'ProcedureStage', 'TimelineEntry', 'MediaAsset', 'User'].map(
        (name) => schemas[`Sync${name}`],
      ),
    ].filter((root) => root !== undefined);
    const problems: string[] = [];
    for (const root of roots) {
      walk(root, (schema, pointer) => {
        const types = ([] as string[]).concat(schema['type'] ?? []);
        // The only deliberately open object: the envelope tolerates entity types an older app does not know (ADR-0004).
        const forwardCompatibleEnvelope = schema === schemas['SyncEntity'];
        if (
          types.includes('object') &&
          schema['properties'] !== undefined &&
          schema['additionalProperties'] !== false &&
          !forwardCompatibleEnvelope
        )
          problems.push(`${pointer}: object is open`);
        if (
          types.includes('string') &&
          schema['maxLength'] === undefined &&
          schema['enum'] === undefined &&
          schema['const'] === undefined &&
          schema['format'] !== 'date-time'
        ) {
          problems.push(`${pointer}: string without maxLength`);
        }
        if (types.includes('array') && schema['maxItems'] === undefined) problems.push(`${pointer}: array without maxItems`);
      });
    }
    expect([...new Set(problems)]).toEqual([]);
  });

  it('EVM-090 AC3 no request schema or parameter of sync, devices or the sign-in names a user or a device as the subject (the session decides, SR-SYNC-01)', () => {
    for (const id of ['getSyncChanges', 'getSyncWorkOrder', 'pushSyncMutations', 'mobileLogout', 'getClientConfig']) {
      for (const root of requestSchemas(id)) {
        walk(root, (schema, pointer) => {
          for (const name of Object.keys(schema['properties'] ?? {}))
            expect(['userid', 'deviceid'], `${id}${pointer}/${name}`).not.toContain(name.toLowerCase());
        });
      }
      for (const parameter of ((operation(id)['parameters'] ?? []) as unknown[]).map((entry) => resolve(entry))) {
        expect(['userid', 'deviceid'], id).not.toContain(String(parameter['name']).toLowerCase());
      }
    }
  });

  it('EVM-090 AC3 the snapshot is a mobile operation on a path parameter with an object policy, answering 404 for what the device may not see, never 403', () => {
    const snapshot = operation('getSyncWorkOrder');
    expect(Object.keys(snapshot['responses']).sort()).toEqual(['200', '401', '403', '404', '426', '429']);
    expect(snapshot['description']).toMatch(/404 not_found/);
    expect(snapshot['description']).toMatch(/IDOR/);
    expect(snapshot['description']).toMatch(/licznikowi masowego odczytu/);
    expect(schemas['SyncWorkOrderSnapshot'].properties.entities.items.$ref).toBe('#/components/schemas/SyncEntity');
  });
});

describe('EVM-090 AC4 sending mutations', () => {
  const mutations = schemas['SyncMutationsRequest'].properties.mutations;

  it('EVM-090 AC4 a batch has 1 to 50 mutations; each one is {mutationId, type, commandVersion, payload} for CreateNote, CreateComment or CreateQuickWorkOrder', () => {
    expect(mutations).toMatchObject({ minItems: 1, maxItems: 50 });
    const union = schemas['SyncMutation'];
    expect(union.discriminator.propertyName).toBe('type');
    expect(Object.keys(union.discriminator.mapping).sort()).toEqual(['CreateComment', 'CreateNote', 'CreateQuickWorkOrder']);
    for (const name of ['CreateNoteMutation', 'CreateCommentMutation', 'CreateQuickWorkOrderMutation']) {
      expect(schemas[name]).toMatchObject({ additionalProperties: false, required: ['mutationId', 'type', 'commandVersion', 'payload'] });
      expect(resolve(schemas[name].properties.mutationId)).toMatchObject({ format: 'uuid' });
    }
    expect(schemas['CommandVersion']).toMatchObject({ type: 'integer', minimum: 1 });
    expect(union.description).toMatch(/64 KB/);
    expect(union.description).toMatch(/validation_failed/);
  });

  it('EVM-090 AC4 the result of a mutation is applied / duplicate / conflict / rejected with a code of the catalogue; warnings come from a closed catalogue', () => {
    const result = schemas['SyncMutationResult'];
    expect(result.additionalProperties).toBe(false);
    expect(result.properties.outcome['x-extensible-enum']).toEqual(['applied', 'duplicate', 'conflict', 'rejected']);
    expect(result.properties.code['x-extensible-enum']).toEqual([
      'id_conflict',
      'forbidden',
      'target_unavailable',
      'validation_failed',
      'idempotency_mismatch',
      'idempotency_in_progress',
      'template_unavailable',
    ]);
    expect(result.properties.warnings.items['x-extensible-enum']).toEqual(['captured_at_out_of_range', 'idempotency_expired']);
    expect(result.properties.outcome.enum).toBeUndefined();
  });

  it('EVM-090 AC4 newCustomer carries only the kind, the name and the phone (and the id the phone gave it)', () => {
    expect(schemas['SyncNewCustomer'].required.sort()).toEqual(['displayName', 'id', 'kind', 'phone']);
    expect(Object.keys(schemas['SyncNewCustomer'].properties).sort()).toEqual(['displayName', 'id', 'kind', 'phone']);
    expect(schemas['SyncNewCustomer'].properties.phone).toMatchObject({ pattern: '^[0-9+() -]{7,32}$', maxLength: 32 });
    expect(schemas['CreateQuickWorkOrderPayload'].properties.newCustomer.$ref).toBe('#/components/schemas/SyncNewCustomer');
  });

  it('EVM-090 AC4 the largest possible mutation fits in 64 KB (UTF-8): the bounds of the schema add up', () => {
    // 20000 UTF-16 units of text are at most 60000 bytes in UTF-8; the envelope and the other fields stay well below the rest.
    const bodyBytes = schemas['CreateNotePayload'].properties.body.maxLength * 3;
    expect(bodyBytes + 1000).toBeLessThan(64 * 1024);
    const quick = schemas['CreateQuickWorkOrderPayload'];
    const textBytes = (name: string): number =>
      Object.values(schemas[name].properties as Json).reduce<number>(
        (total, property) => total + Number((property as Json)['maxLength'] ?? 0) * 3,
        0,
      );
    const quickBytes =
      (Number(quick.properties.title.maxLength) + Number(quick.properties.note.maxLength)) * 3 +
      textBytes('SyncNewSite') +
      textBytes('SyncNewCustomer');
    expect(quickBytes + 1000).toBeLessThan(64 * 1024);
  });

  it('EVM-090 AC4 the schemas of the batch are closed and bounded (checked on the whole request and the whole answer)', () => {
    const problems: string[] = [];
    for (const root of [schemas['SyncMutationsRequest'], schemas['SyncMutationsResponse']]) {
      walk(root, (schema, pointer) => {
        const types = ([] as string[]).concat(schema['type'] ?? []);
        if (types.includes('object') && schema['properties'] !== undefined && schema['additionalProperties'] !== false)
          problems.push(pointer);
        if (
          types.includes('string') &&
          schema['maxLength'] === undefined &&
          schema['enum'] === undefined &&
          schema['const'] === undefined &&
          schema['format'] !== 'date-time'
        ) {
          problems.push(`${pointer} string`);
        }
      });
    }
    expect(problems).toEqual([]);
  });
});

describe('EVM-090 AC5 the catalogue of errors and the headers (SR-API-01, SR-API-03, SR-AUTH-05)', () => {
  /** Codes shown by the examples of a response of an operation: `${id} ${status} → [codes]`. */
  const codesOf = (id: string, status: string): string[] => {
    const content = resolve(operation(id)['responses'][status])?.['content']?.['application/problem+json'] ?? {};
    const examples: Json[] = [
      content['example'],
      ...Object.values((content['examples'] ?? {}) as Json).map((entry) => (entry as Json)['value']),
    ].filter(Boolean);
    return examples.map((example) => example['code'] as string).sort();
  };

  it('EVM-090 AC5 the sign-in answers device_wipe_required for a matching pair before the password, mfa_enrollment_required and totp_not_configured (only after the password), channel_not_allowed and device_limit_reached (only after the code)', () => {
    expect(codesOf('mobileLogin', '401')).toEqual(['device_wipe_required', 'invalid_credentials']);
    expect(codesOf('mobileLogin', '403')).toEqual(['mfa_enrollment_required', 'totp_not_configured']);
    expect(codesOf('mobileLoginTotp', '401')).toEqual(['device_wipe_required', 'invalid_credentials']);
    expect(codesOf('mobileLoginTotp', '403')).toEqual(['channel_not_allowed', 'device_limit_reached']);
    expect(codesOf('confirmDeviceWipe', '401')).toEqual(['invalid_credentials']);
    const login = String(operation('mobileLogin')['description']);
    expect(login).toMatch(/JEDYNA odpowiedź na każdą porażkę/);
    expect(login).toMatch(/401 device_wipe_required`\s+PRZED sprawdzeniem hasła/);
    expect(login).toMatch(/IGNOROWANA/);
    expect(login).toMatch(/dopiero po\s+poprawnym haśle/);
    expect(String(operation('mobileLoginTotp')['description'])).toMatch(/channel_not_allowed.*gdzie indziej zły kanał to `403 forbidden`/s);
  });

  it('EVM-090 AC5 session_revoked and device_wipe_required are answered by the refresh, the pull and the push (and by every authenticated mobile operation)', () => {
    for (const id of [
      'refreshMobileSession',
      'mobileLogout',
      'getClientConfig',
      'getSyncChanges',
      'getSyncWorkOrder',
      'pushSyncMutations',
    ]) {
      expect(codesOf(id, '401'), id).toEqual(['device_wipe_required', 'session_revoked', 'unauthenticated']);
    }
  });

  it('EVM-090 AC5 device_wipe_required takes precedence over session_revoked and unauthenticated on refresh and sync (unknown tokens keep session_revoked)', () => {
    const precedence = /ZAWSZE daje\s+`401 device_wipe_required`, które ma pierwszeństwo przed `session_revoked`/;
    expect(String(operation('refreshMobileSession')['description'])).toMatch(precedence);
    expect(String(operation('refreshMobileSession')['description'])).toMatch(
      /nieznany zostaje przy\s+jedynej odpowiedzi `session_revoked`/,
    );
    expect(String(resolve(operation('getSyncChanges')['responses']['401'])['description'])).toMatch(
      /ZAWSZE daje `device_wipe_required`, przed `session_revoked`/,
    );
    expect(String(operation('getSyncChanges')['description'])).toMatch(/pierwszeństwo przed `session_revoked`/);
    expect(String(operation('pushSyncMutations')['description'])).toMatch(/wyczyszczenie ma pierwszeństwo/);
  });

  it('EVM-090 AC5 426 client_version_unsupported carries minSupportedVersion on every mobile operation but the client config and the wipe confirmation', () => {
    const exempt = ['getClientConfig', 'confirmDeviceWipe'];
    for (const id of NEW_OPERATIONS) {
      const has426 = operation(id)['responses']['426'] !== undefined;
      expect(has426, id).toBe(!exempt.includes(id));
      if (has426) expect(codesOf(id, '426'), id).toEqual(['client_version_unsupported']);
    }
    const example = resolve(operation('getSyncChanges')['responses']['426']).content['application/problem+json'].example;
    expect(example.minSupportedVersion).toEqual({ android: '1.1.0', ios: '1.1.0' });
    expect(schemas['Problem'].properties.minSupportedVersion).toBeDefined();
  });

  it('EVM-090 AC5 invalid_cursor is a 400 of the pull; completed_object_mismatch is in the catalogue as a 409 with an example', () => {
    expect(codesOf('getSyncChanges', '400')).toEqual(['invalid_cursor', 'validation_failed']);
    const mismatch = bundle['components'].responses['CompletedObjectMismatch'];
    expect(mismatch.content['application/problem+json'].example).toMatchObject({ status: 409, code: 'completed_object_mismatch' });
    expect(mismatch.headers['Cache-Control']).toBeDefined();
  });

  it('EVM-090 AC5 every new operation answers 429 with Retry-After, and every response of it — success and error — is no-store problem+json', () => {
    for (const id of NEW_OPERATIONS) {
      const responses = operation(id)['responses'] as Json;
      const limited = resolve(responses['429']);
      expect(limited.headers['Retry-After'], id).toBeDefined();
      for (const [status, entry] of Object.entries(responses)) {
        const response = resolve(entry);
        expect(resolve(response.headers?.['Cache-Control'])?.schema?.enum, `${id} ${status}`).toEqual(['no-store']);
        if (Number(status) >= 400) {
          expect(Object.keys(response.content ?? {}), `${id} ${status}`).toEqual(['application/problem+json']);
        }
      }
    }
  });

  it('EVM-090 AC5 the new operations name the audit events for EVM-094 and the shared counters of the web sign-in (V6.3.1)', () => {
    const text = (id: string) => String(operation(id)['description']);
    expect(text('mobileLogin')).toMatch(/WSPÓLNE z logowaniem w panelu \(20 prób na minutę z jednego adresu IP, blokada po 10/);
    expect(text('mobileLoginTotp')).toMatch(/wspólne z logowaniem w panelu/);
    expect(text('mobileLogin')).toMatch(/rejestracja urządzenia, logowanie udane i nieudane/);
    expect(text('refreshMobileSession')).toMatch(/ponowne użycie tokenu odświeżania \(alert\)/);
    expect(text('mobileLogout')).toMatch(/wylogowanie urządzenia/);
    expect(text('confirmDeviceWipe')).toMatch(/potwierdzenie wyczyszczenia urządzenia/);
    for (const id of ['mobileLogin', 'mobileLoginTotp', 'refreshMobileSession', 'confirmDeviceWipe']) expect(text(id), id).toMatch(/8 KB/);
  });
});

describe('EVM-090 AC6 the configuration of the client', () => {
  it('EVM-090 AC6 GET /api/v1/meta/client-config is an authenticated mobile operation with the window, N days, the periodic resync, the scope rule and the versions', () => {
    expect(AUTHZ_MANIFEST['getClientConfig']).toMatchObject({ method: 'get', path: '/api/v1/meta/client-config', planned: true });
    const config = schemas['ClientConfig'];
    expect(config.required.sort()).toEqual([
      'closedWorkOrdersInScopeDays',
      'minSupportedVersion',
      'offlineContactWindowDays',
      'periodicResyncDays',
      'recommendedVersion',
      'scopeRuleVersion',
    ]);
    expect(config.additionalProperties).toBe(false);
    const example = resolve(operation('getClientConfig')['responses']['200']).content['application/json'].example;
    expect(example).toMatchObject({ offlineContactWindowDays: 7, closedWorkOrdersInScopeDays: 30, periodicResyncDays: 7 });
    expect(zClientConfig.safeParse(example).success).toBe(true);
    expect(schemas['ClientVersions'].required.sort()).toEqual(['android', 'ios']);
    expect(String(operation('getClientConfig')['description'])).toMatch(/publiczne\s+`GET \/api\/health`/);
  });
});

describe('EVM-090 AC7 examples, generated types and the client', () => {
  it('EVM-090 AC7 every response of every new operation has an example (also every error of AC5), and the request bodies have one too', () => {
    for (const id of NEW_OPERATIONS) {
      for (const [status, entry] of Object.entries(operation(id)['responses'] as Json)) {
        const response = resolve(entry);
        for (const [type, media] of Object.entries((response.content ?? {}) as Json)) {
          const hasExample = (media as Json)['example'] !== undefined || Object.keys((media as Json)['examples'] ?? {}).length > 0;
          expect(hasExample, `${id} ${status} ${type}`).toBe(true);
        }
      }
      const body = operation(id)['requestBody']?.content?.['application/json'];
      if (body !== undefined) expect(body.example, id).toBeDefined();
    }
  });

  it('EVM-090 AC7 the examples satisfy the generated Zod schemas (they are valid fixtures for the client and the mock)', () => {
    const example = (id: string, status: string, name?: string): unknown => {
      const media = resolve(operation(id)['responses'][status]).content['application/json'];
      return name === undefined ? media.example : media.examples[name].value;
    };
    expect(zMobileLoginChallenge.safeParse(example('mobileLogin', '200')).success).toBe(true);
    expect(zMobileSession.safeParse(example('mobileLoginTotp', '200')).success).toBe(true);
    expect(zMobileSession.safeParse(example('refreshMobileSession', '200')).success).toBe(true);
    expect(zSyncChangesResponse.safeParse(example('getSyncChanges', '200', 'changes')).success).toBe(true);
    expect(zSyncChangesResponse.safeParse(example('getSyncChanges', '200', 'resync_required')).success).toBe(true);
    expect(zSyncWorkOrderSnapshot.safeParse(example('getSyncWorkOrder', '200')).success).toBe(true);
    expect(zSyncMutationsResponse.safeParse(example('pushSyncMutations', '200')).success).toBe(true);
    const body = operation('pushSyncMutations')['requestBody'].content['application/json'].example;
    expect(zSyncMutationsRequest.safeParse(body).success).toBe(true);
    expect(zSyncMutationsRequest.safeParse({ mutations: [] }).success).toBe(false);
    expect(zSyncMutationsRequest.safeParse({ mutations: Array.from({ length: 51 }, () => body.mutations[0]) }).success).toBe(false);
    expect(zSyncMutationsRequest.safeParse({ mutations: [{ ...body.mutations[0], type: 'DeleteEverything' }] }).success).toBe(false);
  });

  it('EVM-090 AC7 the generator produced the typed client for the mobile app: one function per new operation and the types of the answers', () => {
    for (const fn of [
      mobileLogin,
      mobileLoginTotp,
      refreshMobileSession,
      mobileLogout,
      confirmDeviceWipe,
      getClientConfig,
      getSyncChanges,
      getSyncWorkOrder,
      pushSyncMutations,
    ]) {
      expect(typeof fn).toBe('function');
    }
    const session: Pick<MobileSession, 'deviceId' | 'serverTime'> = { deviceId: 'x', serverTime: 'y' };
    const page: SyncChangesResponse = { result: 'resync_required', reason: 'periodic', serverTime: 'z' };
    expect(session.deviceId).toBe('x');
    expect(page.result).toBe('resync_required');
  });
});
