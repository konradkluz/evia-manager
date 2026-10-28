/**
 * Local Redocly plugin `evia` (ADR-0004, api-guidelines.md → Autoryzacja, Dokumentowanie operacji; EVM-008 AC2):
 * - `evia/authz-required` — every operation declares `x-evia-authz` (SR-AUTHZ-01);
 * - `evia/public-allow-list` — `x-evia-authz: { public: true }` only for operations on PUBLIC_OPERATIONS;
 * - `evia/no-personal-data-parameters` — no query or path parameter named after personal data or secrets, and no header or cookie
 *   parameter named after a secret (tokens travel only in the body or in `Authorization`; SR-API-04, CWE-598);
 * - `evia/public-channels` — a public operation lists at most one channel; with `mobile` it is on PUBLIC_OPERATIONS and MOBILE_OPERATIONS
 *   (EVM-090 AC1; otherwise the guard cannot tell which CSRF checks apply to it);
 * - `evia/security-scheme-channel` — `mobileBearer` only on `[mobile]`, `webSession` only on `[web]`, an authenticated mobile operation
 *   declares `mobileBearer`, a public one declares no scheme (EVM-090 AC1);
 * - `evia/mobile-no-set-cookie` — a response of a mobile operation never sets a cookie (EVM-090 AC1);
 * - `evia/planned-marker` — `x-evia-planned` has the value `true` and nothing else (EVM-090);
 * - `evia/channels-required` — every non-public operation lists its channels (`web`, `mobile`) (SR-AUTHZ-12);
 * - `evia/mobile-channel-allow-list` — `mobile` only for MOBILE_OPERATIONS (the mobile channel starts with E9) and never together
 *   with `stepUp: true`;
 * - `evia/step-up-web-only` — an operation with `stepUp: true` lists exactly `[web]` (EVM-029 AC7; SR-AUTHZ-12);
 * - `evia/mfa-enrollment-allow-list` — `allowDuringMfaEnrollment: true` only for MFA_ENROLLMENT_OPERATIONS (AC4).
 * Loaded by redocly.yaml; the rule functions are plain visitors, unit-tested without the CLI.
 */
import { CHANNELS } from './manifest.ts';
import { MFA_ENROLLMENT_OPERATIONS, MOBILE_OPERATIONS, PUBLIC_OPERATIONS } from './public-operations.ts';

interface Location {
  child(key: string): Location;
}

export interface RuleContext {
  report(problem: { message: string; location?: Location }): void;
  location: Location;
  /** Follows a `$ref` of the document (the Redocly context); absent in unit tests that pass only inline nodes. */
  resolve?(node: { $ref: string }): { node?: unknown };
}

interface OperationNode {
  operationId?: unknown;
  'x-evia-authz'?: unknown;
  'x-evia-planned'?: unknown;
  security?: unknown;
  responses?: unknown;
}

interface ParameterNode {
  name?: unknown;
  in?: unknown;
}

/** Normalised fragments of parameter names that point to personal data or secrets (compared as substrings). */
export const PERSONAL_DATA_FRAGMENTS = Object.freeze([
  'name',
  'email',
  'mail',
  'phone',
  'mobile',
  'address',
  'street',
  'postcode',
  'postalcode',
  'zipcode',
  'pesel',
  'nip',
  'regon',
  'iban',
  'accountnumber',
  'birth',
  'meteringpoint',
  'ppe',
  'password',
  'secret',
  'token',
  'apikey',
]);

/** Fragments of names that point to a secret or a one-time value: forbidden in EVERY place but the body and `Authorization` (SR-API-04). */
export const SECRET_FRAGMENTS = Object.freeze(['password', 'secret', 'token', 'apikey', 'challenge', 'refresh']);

/** Short secret names matched only as a whole word (`passkeyId` is no key, `code`/`key` are): the name is split at case changes and separators. */
export const SECRET_WORDS = Object.freeze(['code', 'key']);

/** Headers that carry no credential although their names contain a secret fragment: the idempotency key and the CSRF token of the web session. */
export const HEADER_EXCEPTIONS = Object.freeze(['idempotency-key', 'x-csrf-token']);

/** @returns the name in lower case without `_`, `-` and `.` (customer_E-mail → customeremail) */
export const normalizeName = (name: string): string => name.toLowerCase().replace(/[_.-]/g, '');

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export function AuthzRequired() {
  return {
    Operation(operation: OperationNode, ctx: RuleContext) {
      if (!isRecord(operation['x-evia-authz'])) {
        ctx.report({ message: 'Każda operacja musi mieć obiekt x-evia-authz (deny-by-default, SR-AUTHZ-01).', location: ctx.location });
      }
    },
  };
}

export function PublicAllowList() {
  return {
    Operation(operation: OperationNode, ctx: RuleContext) {
      const authz = operation['x-evia-authz'];
      if (!isRecord(authz) || !('public' in authz)) return;
      const location = ctx.location.child('x-evia-authz').child('public');
      if (authz['public'] !== true) {
        ctx.report({ message: 'x-evia-authz.public może mieć wyłącznie wartość true.', location });
        return;
      }
      const id = typeof operation.operationId === 'string' ? operation.operationId : '';
      if (!PUBLIC_OPERATIONS.includes(id)) {
        ctx.report({
          message: `Operacja ${id || '(bez operationId)'} nie jest na liście operacji publicznych (PUBLIC_OPERATIONS).`,
          location,
        });
      }
    },
  };
}

export function ChannelsRequired() {
  return {
    Operation(operation: OperationNode, ctx: RuleContext) {
      const authz = operation['x-evia-authz'];
      if (!isRecord(authz) || authz['public'] === true) return;
      const channels = authz['channels'];
      const valid =
        Array.isArray(channels) && channels.length > 0 && channels.every((channel) => (CHANNELS as readonly unknown[]).includes(channel));
      if (!valid) {
        ctx.report({
          message: 'Operacja niepubliczna musi mieć niepustą listę channels z wartości web | mobile (SR-AUTHZ-12).',
          location: ctx.location.child('x-evia-authz'),
        });
      }
    },
  };
}

export function MobileChannelAllowList() {
  return {
    Operation(operation: OperationNode, ctx: RuleContext) {
      const authz = operation['x-evia-authz'];
      if (!isRecord(authz) || !Array.isArray(authz['channels']) || !authz['channels'].includes('mobile')) return;
      const location = ctx.location.child('x-evia-authz').child('channels');
      const id = typeof operation.operationId === 'string' ? operation.operationId : '';
      if (!MOBILE_OPERATIONS.includes(id)) {
        ctx.report({
          message: `Operacja ${id || '(bez operationId)'} nie może mieć kanału mobile — nie jest na liście MOBILE_OPERATIONS (wymaga przeglądu security-engineer).`,
          location,
        });
      }
      if (authz['stepUp'] === true) {
        ctx.report({ message: 'Operacja z stepUp: true nie może mieć kanału mobile (SR-AUTHZ-12).', location });
      }
    },
  };
}

export function StepUpWebOnly() {
  return {
    Operation(operation: OperationNode, ctx: RuleContext) {
      const authz = operation['x-evia-authz'];
      if (!isRecord(authz) || authz['stepUp'] !== true) return;
      const channels = authz['channels'];
      if (!Array.isArray(channels) || channels.length !== 1 || channels[0] !== 'web') {
        const id = typeof operation.operationId === 'string' ? operation.operationId : '';
        ctx.report({
          message: `Operacja ${id || '(bez operationId)'} z stepUp: true musi mieć dokładnie channels: [web] (SR-AUTHZ-12).`,
          location: ctx.location.child('x-evia-authz').child('channels'),
        });
      }
    },
  };
}

export function MfaEnrollmentAllowList() {
  return {
    Operation(operation: OperationNode, ctx: RuleContext) {
      const authz = operation['x-evia-authz'];
      if (!isRecord(authz) || !('allowDuringMfaEnrollment' in authz)) return;
      const location = ctx.location.child('x-evia-authz').child('allowDuringMfaEnrollment');
      const id = typeof operation.operationId === 'string' ? operation.operationId : '';
      if (authz['allowDuringMfaEnrollment'] === true && !MFA_ENROLLMENT_OPERATIONS.includes(id)) {
        ctx.report({
          message: `Operacja ${id || '(bez operationId)'} nie jest na liście MFA_ENROLLMENT_OPERATIONS — w stanie mfa_enrollment dozwolone są tylko operacje z listy.`,
          location,
        });
      }
    },
  };
}

export function NoPersonalDataParameters() {
  return {
    Parameter(parameter: ParameterNode, ctx: RuleContext) {
      const place = typeof parameter.in === 'string' ? parameter.in : '';
      if (!['query', 'path', 'header', 'cookie'].includes(place)) return;
      const name = typeof parameter.name === 'string' ? parameter.name : '';
      if (place === 'header' && HEADER_EXCEPTIONS.includes(name.toLowerCase())) return;
      const fragments = place === 'header' || place === 'cookie' ? SECRET_FRAGMENTS : [...PERSONAL_DATA_FRAGMENTS, ...SECRET_FRAGMENTS];
      const words = name
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .toLowerCase()
        .split(/[^a-z0-9]+/);
      const fragment = fragments.find((part) => normalizeName(name).includes(part)) ?? SECRET_WORDS.find((word) => words.includes(word));
      if (fragment !== undefined) {
        ctx.report({
          message: `Parametr ${place} „${name}” wskazuje dane osobowe lub sekret (${fragment}) — dane osobowe przenieś do treści POST …/search, sekrety i tokeny do treści albo nagłówka Authorization (SR-API-04).`,
          location: ctx.location.child('name'),
        });
      }
    },
  };
}

const idOf = (operation: OperationNode): string =>
  typeof operation.operationId === 'string' ? operation.operationId : '(bez operationId)';

/** The channels of an operation: the declared ones; a public operation without any belongs to the panel (`web`). */
function channelsOf(authz: Record<string, unknown>): string[] {
  if (Array.isArray(authz['channels'])) return authz['channels'].map(String);
  return authz['public'] === true ? ['web'] : [];
}

export function PublicChannels() {
  return {
    Operation(operation: OperationNode, ctx: RuleContext) {
      const authz = operation['x-evia-authz'];
      if (!isRecord(authz) || authz['public'] !== true || !('channels' in authz)) return;
      const location = ctx.location.child('x-evia-authz').child('channels');
      const channels = authz['channels'];
      if (!Array.isArray(channels) || channels.length !== 1 || !(CHANNELS as readonly unknown[]).includes(channels[0])) {
        ctx.report({
          message: `Operacja publiczna ${idOf(operation)} ma dokładnie jeden kanał (web albo mobile), nigdy oba (SR-AUTHZ-12).`,
          location,
        });
        return;
      }
      if (channels[0] === 'mobile' && !(PUBLIC_OPERATIONS.includes(idOf(operation)) && MOBILE_OPERATIONS.includes(idOf(operation)))) {
        ctx.report({
          message: `Operacja publiczna z kanałem mobile ${idOf(operation)} musi być na listach PUBLIC_OPERATIONS i MOBILE_OPERATIONS.`,
          location,
        });
      }
    },
  };
}

export function SecuritySchemeChannel() {
  return {
    Operation(operation: OperationNode, ctx: RuleContext) {
      const authz = operation['x-evia-authz'];
      if (!isRecord(authz)) return;
      const channels = channelsOf(authz);
      const only = (channel: string): boolean => channels.length === 1 && channels[0] === channel;
      const schemes = Array.isArray(operation.security)
        ? operation.security.flatMap((entry) => (isRecord(entry) ? Object.keys(entry) : []))
        : [];
      const location = ctx.location.child('security');
      if (schemes.includes('mobileBearer') && !only('mobile')) {
        ctx.report({
          message: `Operacja ${idOf(operation)} przyjmuje mobileBearer, a nie ma kanału dokładnie [mobile] (SR-AUTHZ-12).`,
          location,
        });
      }
      if (schemes.includes('webSession') && !only('web')) {
        ctx.report({
          message: `Operacja ${idOf(operation)} przyjmuje webSession, a nie ma kanału dokładnie [web] (SR-AUTHZ-12).`,
          location,
        });
      }
      if (authz['public'] === true && schemes.length > 0) {
        ctx.report({ message: `Operacja publiczna ${idOf(operation)} nie deklaruje schematu uwierzytelnienia (security: []).`, location });
      }
      if (authz['public'] !== true && only('mobile') && !schemes.includes('mobileBearer')) {
        ctx.report({ message: `Operacja mobilna ${idOf(operation)} musi deklarować security: mobileBearer.`, location: ctx.location });
      }
    },
  };
}

export function MobileNoSetCookie() {
  return {
    Operation(operation: OperationNode, ctx: RuleContext) {
      const authz = operation['x-evia-authz'];
      if (!isRecord(authz) || !channelsOf(authz).includes('mobile') || !isRecord(operation.responses)) return;
      for (const [status, entry] of Object.entries(operation.responses)) {
        const response = isRecord(entry) && typeof entry['$ref'] === 'string' ? ctx.resolve?.({ $ref: entry['$ref'] }).node : entry;
        const headers = isRecord(response) && isRecord(response['headers']) ? Object.keys(response['headers']) : [];
        if (headers.some((header) => header.toLowerCase() === 'set-cookie')) {
          ctx.report({
            message: `Odpowiedź ${status} operacji mobilnej ${idOf(operation)} nie ustawia ciasteczek (Set-Cookie) — sesja mobilna to tokeny (SR-AUTHZ-12).`,
            location: ctx.location.child('responses').child(status),
          });
        }
      }
    },
  };
}

export function PlannedMarker() {
  return {
    Operation(operation: OperationNode, ctx: RuleContext) {
      if ('x-evia-planned' in operation && operation['x-evia-planned'] !== true) {
        ctx.report({
          message: 'x-evia-planned może mieć wyłącznie wartość true (operacja bez trasy do czasu swojej historyjki).',
          location: ctx.location.child('x-evia-planned'),
        });
      }
    },
  };
}

export default function eviaPlugin() {
  return {
    id: 'evia',
    rules: {
      oas3: {
        'authz-required': AuthzRequired,
        'public-allow-list': PublicAllowList,
        'no-personal-data-parameters': NoPersonalDataParameters,
        'channels-required': ChannelsRequired,
        'mobile-channel-allow-list': MobileChannelAllowList,
        'step-up-web-only': StepUpWebOnly,
        'mfa-enrollment-allow-list': MfaEnrollmentAllowList,
        'public-channels': PublicChannels,
        'security-scheme-channel': SecuritySchemeChannel,
        'mobile-no-set-cookie': MobileNoSetCookie,
        'planned-marker': PlannedMarker,
      },
    },
  };
}
