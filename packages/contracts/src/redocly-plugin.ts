/**
 * Local Redocly plugin `evia` (ADR-0004, api-guidelines.md → Autoryzacja, Dokumentowanie operacji; EVM-008 AC2):
 * - `evia/authz-required` — every operation declares `x-evia-authz` (SR-AUTHZ-01);
 * - `evia/public-allow-list` — `x-evia-authz: { public: true }` only for operations on PUBLIC_OPERATIONS;
 * - `evia/no-personal-data-parameters` — no query or path parameter named after personal data or secrets (SR-API-04);
 * - `evia/channels-required` — every non-public operation lists its channels (`web`, `mobile`) (SR-AUTHZ-12);
 * - `evia/mobile-channel-allow-list` — `mobile` only for MOBILE_OPERATIONS (empty in M1: the mobile channel starts with
 *   E9) and never together with `stepUp: true`;
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
}

interface OperationNode {
  operationId?: unknown;
  'x-evia-authz'?: unknown;
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
          message: `Operacja ${id || '(bez operationId)'} nie może mieć kanału mobile przed E9 (MOBILE_OPERATIONS jest pusta).`,
          location,
        });
      }
      if (authz['stepUp'] === true) {
        ctx.report({ message: 'Operacja z stepUp: true nie może mieć kanału mobile (SR-AUTHZ-12).', location });
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
      if (parameter.in !== 'query' && parameter.in !== 'path') return;
      const name = typeof parameter.name === 'string' ? parameter.name : '';
      const fragment = PERSONAL_DATA_FRAGMENTS.find((part) => normalizeName(name).includes(part));
      if (fragment !== undefined) {
        ctx.report({
          message: `Parametr ${parameter.in} „${name}” wskazuje dane osobowe lub sekret (${fragment}) — przenieś do treści POST …/search (SR-API-04).`,
          location: ctx.location.child('name'),
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
        'mfa-enrollment-allow-list': MfaEnrollmentAllowList,
      },
    },
  };
}
