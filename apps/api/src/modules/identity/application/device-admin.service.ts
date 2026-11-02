/**
 * The management of mobile devices (EVM-095; W-15, W-17; SR-SESS-06, SR-SESS-07, SR-MOB-04, SR-AUTHZ-05, SR-DATA-03, SR-LOG-03; CWE-639, CWE-362). The guard has
 * decided before this runs: the web channel, the role, the step-up and CSRF. Here:
 * - the OWN devices of the account (`listOwn`, `logoutOwn`): ownership is in the WHERE; a device of somebody else, a missing one and one removed from the register
 *   are the same `404 not_found` (the same body, the same path through the code);
 * - the devices of ALL users for the Administrator (`list`, `logout`, `wipe`, `summary`): an unknown device is `404`, a bad identifier `400`.
 *
 * Every change is ONE transaction that locks the row of the device (`FOR UPDATE`, so the wipe and the confirmation of the phone do not race), ends the sessions of
 * the device (their access tokens and refresh tokens stop at once), stamps the moment of the invalidation and writes the audit events - identifiers and codes only,
 * never the model typed by the Administrator, a secret or a token. The state `wipe_required` is final: a logout never takes the device back to `active`, and a second
 * order of the wipe is a `204` that changes nothing and writes nothing.
 */
import {
  zAccountDeviceList,
  zGetUserDevicesSummaryPath,
  zLogoutAccountDevicePath,
  zLogoutDevicePath,
  zManagedDeviceList,
  zUserDevicesSummary,
  zWipeDevicePath,
  zWipeDeviceRequest,
} from '@evia/contracts/zod';
import type { AccountDeviceList, ManagedDeviceList, UserDevicesSummary } from '@evia/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import { scopeOf, type CursorCodec } from '../../../platform/crypto/opaque-cursor.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import type { Principal } from '../../../platform/http/principal.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { parseInput, strictObjects } from '../../../platform/http/validation.ts';
import { CLOCK, CURSOR_CODEC, DATABASE, EVENT_BUS } from '../../../platform/tokens.ts';
import { devicePositionParts, parseDevicePosition, resolveDeviceListQuery } from '../domain/device-list-query.ts';
import { modelConfirmed, patchLevel, viewState } from '../domain/device-view.ts';
import type { IdentityEvent } from '../events.ts';
import {
  endSessionsOfDevice,
  lockDevice,
  orderWipe,
  readManagedDevices,
  readOwnDevices,
  stampInvalidated,
  summariseDevicesOfUser,
} from '../infrastructure/device-admin-queries.ts';
import { findUserById } from '../infrastructure/queries.ts';
import { identityTables, type IdentityDb } from '../infrastructure/tables.ts';

const LIST_OPERATION = 'listDevices';
const logoutOwnPath = strictObjects(zLogoutAccountDevicePath);
const logoutPath = strictObjects(zLogoutDevicePath);
const wipePath = strictObjects(zWipeDevicePath);
const wipeBody = strictObjects(zWipeDeviceRequest);
const summaryPath = strictObjects(zGetUserDevicesSummaryPath);

@Injectable()
export class DeviceAdminService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;
  readonly #cursors: CursorCodec;

  constructor(
    @Inject(DATABASE) db: Kysely<Database>,
    @Inject(CLOCK) clock: Clock,
    @Inject(EVENT_BUS) events: EventBus,
    @Inject(CURSOR_CODEC) cursors: CursorCodec,
  ) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
    this.#cursors = cursors;
  }

  /** W-15: the phones of the signed-in account. */
  async listOwn(principal: Principal): Promise<AccountDeviceList> {
    const now = this.#clock.now();
    const rows = await readOwnDevices(identityTables(this.#db), principal.userId, now);
    const list = zAccountDeviceList.safeParse({
      items: rows.map((row) => ({
        id: row.id,
        model: row.model,
        osVersion: row.osVersion,
        appVersion: row.appVersion,
        lastContactAt: row.lastContactAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        state: viewState(row.state, row.hasValidSession),
      })),
    });
    if (!list.success) throw new ProblemException('internal_error');
    return list.data;
  }

  /** W-15: the person logs out one of THEIR phones. */
  async logoutOwn(principal: Principal, rawParams: unknown, context: EventContext): Promise<void> {
    const { deviceId } = parseInput(logoutOwnPath, rawParams) as { deviceId: string };
    await this.#logout(principal, deviceId, principal.userId, 'ended_by_user', context);
  }

  /** W-17: the devices of all users, one page; the read is audited in the same transaction (a read that cannot be audited is not served). */
  async list(principal: Principal, rawQuery: unknown, context: EventContext): Promise<ManagedDeviceList> {
    const query = parseInput(resolveDeviceListQuery, rawQuery);
    const scope = scopeOf([query.userId ?? '', query.state ?? '']);
    const after = this.#positionOf(query.cursor, principal, scope);
    const now = this.#clock.now();
    const page = await runInTransaction(this.#db, async (tx) => {
      const rows = await readManagedDevices(identityTables(tx), {
        userId: query.userId,
        state: query.state,
        limit: query.limit,
        after,
        now,
      });
      await this.#audit(tx, principal, context, 'device.list_read');
      return rows;
    });
    const shown = page.slice(0, query.limit);
    const last = shown.at(-1);
    const list = zManagedDeviceList.safeParse({
      items: shown.map((row) => ({
        id: row.id,
        user: { userId: row.userId, displayName: row.displayName },
        model: row.model,
        osVersion: row.osVersion,
        appVersion: row.appVersion,
        patchLevel: patchLevel(row.securityPatch, now),
        lastContactAt: row.lastContactAt.toISOString(),
        state: viewState(row.state, row.hasValidSession),
        pendingItemsReported: row.pendingItemsReported,
      })),
      nextCursor:
        page.length > query.limit && last !== undefined
          ? this.#cursors.seal(LIST_OPERATION, {
              position: devicePositionParts({ lastContactAt: last.lastContactAt, id: last.id }),
              scope,
              userId: principal.userId,
            })
          : null,
    });
    if (!list.success) throw new ProblemException('internal_error');
    return list.data;
  }

  /** W-17: logs out a device of any user (the state stays). */
  async logout(principal: Principal, rawParams: unknown, context: EventContext): Promise<void> {
    const { deviceId } = parseInput(logoutPath, rawParams) as { deviceId: string };
    await this.#logout(principal, deviceId, undefined, 'sessions_ended', context);
  }

  /** W-17: "Zablokuj i wyczyść" - `active` to `wipe_required`; idempotent for a device that is already past it. */
  async wipe(principal: Principal, rawParams: unknown, rawBody: unknown, context: EventContext): Promise<void> {
    const { deviceId } = parseInput(wipePath, rawParams) as { deviceId: string };
    await runInTransaction(this.#db, async (tx) => {
      const db = identityTables(tx);
      const device = await lockDevice(db, deviceId);
      if (device === undefined) throw new ProblemException('not_found');
      // The body is read AFTER the device was found: an unknown device never learns anything about the shape of the request (404 before 400).
      const { confirmModel } = parseInput(wipeBody, rawBody) as { confirmModel: string };
      if (!modelConfirmed(confirmModel, device.model))
        throw new ProblemException('device_model_mismatch', { errors: [{ pointer: '/confirmModel', code: 'mismatch' }] });
      const now = this.#clock.now();
      if (!(await orderWipe(db, device.id, now))) return;
      for (const sessionId of await endSessionsOfDevice(db, device.id, 'device_wipe', now)) {
        await this.#revoked(tx, principal, context, sessionId, 'manual');
      }
      await this.#publish(tx, principal, context, 'device.wipe_ordered', device.id);
    });
  }

  /** W-17: the numbers for the dialogs - devices, active ones and the reported unsent items of one user; audited like the list. */
  async summary(principal: Principal, rawParams: unknown, context: EventContext): Promise<UserDevicesSummary> {
    const { userId } = parseInput(summaryPath, rawParams) as { userId: string };
    const summary = await runInTransaction(this.#db, async (tx) => {
      const db = identityTables(tx);
      const user = await findUserById(db, userId);
      if (user === undefined || user.deletedAt !== null) throw new ProblemException('not_found');
      await this.#audit(tx, principal, context, 'device.list_read');
      return summariseDevicesOfUser(db, userId);
    });
    const checked = zUserDevicesSummary.safeParse(summary);
    if (!checked.success) throw new ProblemException('internal_error');
    return checked.data;
  }

  async #logout(
    principal: Principal,
    deviceId: string,
    ownerId: string | undefined,
    reason: 'ended_by_user' | 'sessions_ended',
    context: EventContext,
  ): Promise<void> {
    await runInTransaction(this.#db, async (tx) => {
      const db: IdentityDb = identityTables(tx);
      const device = await lockDevice(db, deviceId, ownerId);
      if (device === undefined) throw new ProblemException('not_found');
      const now = this.#clock.now();
      for (const sessionId of await endSessionsOfDevice(db, device.id, reason, now)) {
        await this.#revoked(tx, principal, context, sessionId, reason);
      }
      await stampInvalidated(db, device.id, now);
      await this.#publish(tx, principal, context, 'device.logged_out', device.id);
    });
  }

  /** @throws ProblemException `invalid_cursor` - one answer for every reason: not ours, expired, other filters or user, not a position */
  #positionOf(cursor: string | undefined, principal: Principal, scope: string) {
    if (cursor === undefined) return undefined;
    const parts = this.#cursors.open(LIST_OPERATION, cursor, { scope, userId: principal.userId });
    const position = parts === undefined ? undefined : parseDevicePosition(parts);
    if (position === undefined) throw new ProblemException('invalid_cursor');
    return position;
  }

  #audit(tx: Kysely<Database>, principal: Principal, context: EventContext, type: 'device.list_read'): Promise<void> {
    const event: IdentityEvent = { type, actor: { type: 'user', userId: principal.userId }, outcome: 'success', objectType: 'device' };
    return this.#events.publish(tx, event, { ...context, sessionId: principal.sessionId });
  }

  #publish(
    tx: Kysely<Database>,
    principal: Principal,
    context: EventContext,
    type: 'device.logged_out' | 'device.wipe_ordered',
    deviceId: string,
  ): Promise<void> {
    const event: IdentityEvent = {
      type,
      actor: { type: 'user', userId: principal.userId },
      outcome: 'success',
      reasonCode: 'manual',
      objectType: 'device',
      objectId: deviceId,
    };
    return this.#events.publish(tx, event, { ...context, sessionId: principal.sessionId });
  }

  #revoked(
    tx: Kysely<Database>,
    principal: Principal,
    context: EventContext,
    sessionId: string,
    reason: 'manual' | 'ended_by_user' | 'sessions_ended',
  ): Promise<void> {
    const event: IdentityEvent = {
      type: 'session.revoked',
      actor: { type: 'user', userId: principal.userId },
      outcome: 'success',
      reasonCode: reason,
      objectType: 'session',
      objectId: sessionId,
    };
    return this.#events.publish(tx, event, { ...context, sessionId });
  }
}
