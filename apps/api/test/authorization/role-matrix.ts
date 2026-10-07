/**
 * The role and channel matrix generated from the contract (EVM-016 AC8; SR-AUTHZ-01, SR-AUTHZ-05, SR-AUTHZ-12; ADR-0014).
 *
 * `buildMatrix` derives, from `x-evia-authz` alone, what every operation must answer to every kind of caller: the three
 * roles on both channels and in both session states, an anonymous caller, a revoked session and a session that ran out of
 * time (EVM-067) — plus an IDOR case for every
 * operation that addresses an object. The expectation is computed here, independently of the guard (a second
 * implementation of the same table in the api-guidelines), so a hole in the guard is a failed cell, not a silent pass.
 * `runMatrix` sends the real requests through the application and returns the cells whose answer differs.
 *
 * "Allowed" means the guard let the request through: a status that is neither 401 nor 403 (the handler then answers with
 * whatever the empty body deserves — usually 400). Denied cells name the exact code.
 */
import type { AuthzManifest } from '@evia/contracts/authz';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import request from 'supertest';
import { PANEL_ORIGIN } from '../support/app.ts';
import type { IdentityApp } from '../support/identity-app.ts';
import { createLink, createPasskey, createSession, createUser, type Role } from '../support/identity-fixtures.ts';

export type Caller =
  | { readonly kind: 'anonymous' }
  | { readonly kind: 'revoked'; readonly role: Role; readonly channel: 'web' }
  /** A session past its idle deadline (EVM-067): 401 session_expired on every operation that needs a session. */
  | { readonly kind: 'expired'; readonly role: Role; readonly channel: 'web' }
  | {
      readonly kind: 'session';
      readonly role: Role;
      readonly channel: 'web' | 'mobile';
      readonly state: 'active' | 'mfa_enrollment';
      /**
       * The last authentication with a passkey of the session (EVM-029): `fresh` — just now, `stale` — 16 minutes ago. Absent: none
       * at all (a session of a password, activation or recovery code), which asks for a step-up as well.
       */
      readonly passkey?: 'fresh' | 'stale';
    };

export type Expectation =
  | { readonly outcome: 'allowed' }
  | { readonly outcome: 'denied'; readonly status: 401 | 403; readonly code: string }
  | { readonly outcome: 'not_found' };

export interface MatrixCell {
  readonly operationId: string;
  readonly method: string;
  readonly path: string;
  readonly caller: Caller;
  readonly expectation: Expectation;
  /** An IDOR case: the caller is entitled to the operation but addresses somebody else's object. */
  readonly idor: boolean;
}

export const ROLES: readonly Role[] = ['administrator', 'editor', 'read_only'];
export const CHANNELS = ['web', 'mobile'] as const;

export interface MatrixLists {
  readonly publicOperations: readonly string[];
  readonly mfaEnrollmentOperations: readonly string[];
}

const hasPathParameter = (path: string): boolean => /\{[^}]+\}/.test(path);

/** SR-AUTHZ-06: the read-only role has no mobile channel. */
const roleMayUseChannel = (role: Role, channel: 'web' | 'mobile'): boolean => !(role === 'read_only' && channel === 'mobile');

export function expectationFor(operationId: string, manifest: AuthzManifest, lists: MatrixLists, caller: Caller): Expectation {
  const operation = manifest[operationId];
  if (operation === undefined) throw new Error(`${operationId}: not in the manifest`);
  const { authz } = operation;
  if (authz.public === true) return { outcome: 'allowed' };
  if (caller.kind === 'anonymous') return { outcome: 'denied', status: 401, code: 'unauthenticated' };
  if (caller.kind === 'revoked') return { outcome: 'denied', status: 401, code: 'session_revoked' };
  if (caller.kind === 'expired') return { outcome: 'denied', status: 401, code: 'session_expired' };
  if (
    caller.state === 'mfa_enrollment' &&
    !(lists.mfaEnrollmentOperations.includes(operationId) && authz.allowDuringMfaEnrollment === true)
  ) {
    return { outcome: 'denied', status: 403, code: 'mfa_enrollment_required' };
  }
  const entitled =
    authz.roles?.includes(caller.role) === true &&
    authz.channels?.includes(caller.channel) === true &&
    roleMayUseChannel(caller.role, caller.channel);
  if (!entitled) return { outcome: 'denied', status: 403, code: 'forbidden' };
  // SR-SESS-08: after the role (a role that may not call the operation never learns it is protected), only a fresh passkey passes
  if (authz.stepUp === true && caller.passkey !== 'fresh') return { outcome: 'denied', status: 403, code: 'step_up_required' };
  return { outcome: 'allowed' };
}

export function buildMatrix(manifest: AuthzManifest, lists: MatrixLists): MatrixCell[] {
  const callers: Caller[] = [
    { kind: 'anonymous' },
    { kind: 'revoked', role: 'administrator', channel: 'web' },
    { kind: 'expired', role: 'administrator', channel: 'web' },
    ...ROLES.flatMap((role) =>
      CHANNELS.flatMap((channel) =>
        (['active', 'mfa_enrollment'] as const).map((state): Caller => ({ kind: 'session', role, channel, state })),
      ),
    ),
    // the Administrator with a fresh and with a stale authentication by a passkey (the step-up window, EVM-029)
    ...CHANNELS.flatMap((channel) =>
      (['fresh', 'stale'] as const).map((passkey): Caller => ({
        kind: 'session',
        role: 'administrator',
        channel,
        state: 'active',
        passkey,
      })),
    ),
  ];
  return Object.entries(manifest).flatMap(([operationId, { method, path, authz }]) => {
    const addressesObject = hasPathParameter(path) || authz.anchor !== undefined;
    const cells = callers.map((caller): MatrixCell => ({
      operationId,
      method,
      path,
      caller,
      expectation: expectationFor(operationId, manifest, lists, caller),
      idor: false,
    }));
    if (!addressesObject || authz.public === true) return cells;
    // IDOR: every caller entitled to the operation, asking for an object of somebody else, gets 404 (never 403: the object is not disclosed)
    const entitled = cells.filter(
      (cell) => cell.expectation.outcome === 'allowed' && !(cell.caller.kind === 'session' && cell.caller.passkey !== undefined),
    );
    return [...cells, ...entitled.map((cell): MatrixCell => ({ ...cell, expectation: { outcome: 'not_found' }, idor: true }))];
  });
}

export interface ObjectPaths {
  /** The path of an object the caller owns, and of one somebody else owns — for operations that address objects. */
  readonly own: (userId: string) => string;
  readonly foreign: (userId: string) => string;
}

export interface Mismatch {
  readonly operationId: string;
  readonly caller: string;
  readonly expected: string;
  readonly actual: string;
}

const describeCaller = (caller: Caller): string =>
  caller.kind === 'session'
    ? `${caller.role}/${caller.channel}/${caller.state}${caller.passkey === undefined ? '' : `/key ${caller.passkey}`}`
    : caller.kind === 'revoked'
      ? 'revoked session'
      : caller.kind === 'expired'
        ? 'expired session'
        : 'anonymous';

const describeExpectation = (expectation: Expectation): string =>
  expectation.outcome === 'allowed'
    ? 'not 401/403'
    : expectation.outcome === 'not_found'
      ? '404 not_found'
      : `${expectation.status} ${expectation.code}`;

/** Sends every cell through the application and returns the cells whose answer is not the expected one. */
export async function runMatrix(
  app: IdentityApp,
  cells: readonly MatrixCell[],
  objects: Readonly<Record<string, ObjectPaths>> = {},
): Promise<Mismatch[]> {
  const db = app.database.admin;
  const server = app.app.getHttpServer();
  const enrolment = new Map<Role, { linkId: string }>();
  const accounts = new Map<string, Awaited<ReturnType<typeof createUser>>>();
  const mismatches: Mismatch[] = [];

  for (const cell of cells) {
    const { caller } = cell;
    const headers: Record<string, string> = {};
    let userId: string = randomUUID();
    if (caller.kind !== 'anonymous') {
      const waiting = caller.kind === 'session' && caller.state === 'mfa_enrollment';
      const key = `${caller.role}:${waiting ? 'invited' : 'active'}`;
      let account = accounts.get(key);
      if (account === undefined) {
        account = await createUser(db, app.clock, { role: caller.role, status: waiting ? 'invited' : 'active' });
        if (!waiting) await createPasskey(db, app.clock, account); // the options of a step-up need a key to name
        accounts.set(key, account);
      }
      let linkId: string | undefined;
      if (waiting) {
        let link = enrolment.get(caller.role);
        if (link === undefined) {
          link = { linkId: (await createLink(db, app.clock, account.id)).id };
          enrolment.set(caller.role, link);
        }
        linkId = link.linkId;
      }
      const passkey = caller.kind === 'session' ? caller.passkey : undefined;
      const session = await createSession(db, app.clock, account, {
        channel: caller.channel,
        state: waiting ? 'mfa_enrollment' : 'active',
        ...(linkId === undefined ? {} : { linkId }),
        ...(passkey === undefined
          ? {}
          : { passkeyAuthenticatedAt: new Date(app.clock.now().getTime() - (passkey === 'fresh' ? 0 : 16 * 60_000)) }),
      });
      if (caller.kind === 'revoked') {
        await sql`update identity.sessions set revoked_at = ${app.clock.now()}, revoke_reason = 'logout' where id = ${session.id}`.execute(
          db,
        );
      }
      if (caller.kind === 'expired') {
        await sql`update identity.sessions set idle_expires_at = ${new Date(app.clock.now().getTime() - 1)} where id = ${session.id}`.execute(
          db,
        );
      }
      headers['Cookie'] = session.cookie;
      headers['X-CSRF-Token'] = session.csrfToken;
      userId = account.id;
    }

    const mutating = cell.method !== 'get';
    if (mutating) {
      headers['Origin'] = PANEL_ORIGIN;
      headers['Sec-Fetch-Site'] = 'same-origin';
    }
    let path = cell.path;
    if (hasPathParameter(path)) {
      const target = objects[cell.operationId];
      if (target === undefined) {
        mismatches.push({
          operationId: cell.operationId,
          caller: describeCaller(caller),
          expected: 'an IDOR case for an operation with a path parameter',
          actual: 'none defined',
        });
        continue;
      }
      path = cell.idor ? target.foreign(userId) : target.own(userId);
    }

    app.clock.advance(61_000); // a new minute: the per-IP limits are not what the matrix measures
    let call = request(server)[cell.method as 'get' | 'post'](path).set(headers);
    if (mutating) call = call.set('Content-Type', 'application/json').send('{}');
    const response = await call;

    const code = (response.body as { code?: string } | undefined)?.code ?? '';
    const { expectation } = cell;
    const ok =
      expectation.outcome === 'allowed'
        ? response.status !== 401 && response.status !== 403 && response.status < 500
        : expectation.outcome === 'not_found'
          ? response.status === 404 && code === 'not_found'
          : response.status === expectation.status && code === expectation.code;
    if (!ok) {
      mismatches.push({
        operationId: cell.operationId,
        caller: `${describeCaller(caller)}${cell.idor ? ' (foreign object)' : ''}`,
        expected: describeExpectation(expectation),
        actual: `${response.status} ${code}`,
      });
    }
  }
  return mismatches;
}
