/**
 * Confirmation of the wipe of a phone (EVM-094 AC7; SR-AUTH-14, SR-AUTH-05; CWE-208): the pair `deviceId` + installation secret in the body. The secret is the
 * proof of the transition `wipe_required` → `wiped`, not a factor of authentication; the newest or the previous secret that is still valid is accepted
 * (two-phase rotation). The comparison runs for an unknown `deviceId` too (against decoys, `matchSecret`), and an unknown device, a device of nobody's and a
 * wrong secret are the one answer `401 invalid_credentials` (no enumeration of devices). `204` is idempotent: a device that is not waiting for the wipe, or that
 * already confirmed it, changes nothing. The confirmation burns both secrets. The session of the device is not touched here — the order of the wipe ended it.
 */
import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Clock } from '../../../platform/clock/clock.ts';
import type { Database } from '../../../platform/database/database.ts';
import { runInTransaction } from '../../../platform/database/transactional.ts';
import type { EventBus } from '../../../platform/events/event-bus.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import { CLOCK, DATABASE, EVENT_BUS } from '../../../platform/tokens.ts';
import { matchSecret } from '../domain/device-rules.ts';
import { hashToken } from '../domain/tokens.ts';
import type { IdentityEvent } from '../events.ts';
import { confirmWipe, findDeviceById } from '../infrastructure/device-queries.ts';
import { identityTables } from '../infrastructure/tables.ts';
import type { ClientInfo } from './activation.service.ts';

@Injectable()
export class DeviceWipeService {
  readonly #db: Kysely<Database>;
  readonly #clock: Clock;
  readonly #events: EventBus;

  constructor(@Inject(DATABASE) db: Kysely<Database>, @Inject(CLOCK) clock: Clock, @Inject(EVENT_BUS) events: EventBus) {
    this.#db = db;
    this.#clock = clock;
    this.#events = events;
  }

  async confirm(deviceId: string, installationSecret: string, client: ClientInfo): Promise<void> {
    const now = this.#clock.now();
    const device = await findDeviceById(identityTables(this.#db), deviceId);
    const known = device === undefined || device.removed ? undefined : device;
    const matched = matchSecret(known?.secrets, hashToken(installationSecret), now);
    if (known === undefined || matched === undefined) throw new ProblemException('invalid_credentials');
    await runInTransaction(this.#db, async (transaction) => {
      // Under the lock of the row: of two parallel confirmations the second finds the state already changed and does nothing.
      const locked = await findDeviceById(identityTables(transaction), known.id, true);
      if (locked?.state !== 'wipe_required') return;
      const burned = hashToken(randomBytes(32).toString('base64url'));
      if (!(await confirmWipe(identityTables(transaction), known.id, burned))) return;
      const event: IdentityEvent = {
        type: 'device.wipe_confirmed',
        actor: { type: 'user', userId: known.userId },
        outcome: 'success',
        objectType: 'device',
        objectId: known.id,
      };
      await this.#events.publish(transaction, event, client.context);
    });
  }
}
