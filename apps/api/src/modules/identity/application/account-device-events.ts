/**
 * What an event of an ACCOUNT does to the phones of that account (EVM-095 AC5; P2, SR-MOB-04, SR-SESS-06/07; table M-02). Called in the SAME transaction as the
 * change of the account, after the sessions of the account ended:
 * - deactivation and a role changed to Read-only: every `active` device is ordered to wipe (`wipe_required`, final) - the person must not keep the company
 *   data on a phone;
 * - a reset of the password, a reset of the second step and a change between Administrator and Editor: the sessions end (done by the caller) and the devices
 *   stay `active` - the phone signs in again; only the moment of the invalidation is stamped (the retention counts from it).
 * Audit: one event per device, identifiers and a reason code only - never a model.
 */
import type { Kysely } from 'kysely';
import type { Database } from '../../../platform/database/database.ts';
import type { EventBus, EventContext } from '../../../platform/events/event-bus.ts';
import type { EventActor, IdentityEvent, ReasonCode } from '../events.ts';
import { lockDevicesOfUser, orderWipe, stampInvalidated } from '../infrastructure/device-admin-queries.ts';
import { identityTables } from '../infrastructure/tables.ts';

export type AccountEventDeviceMode = 'wipe' | 'sign_out';
export type AccountEventReason = Extract<ReasonCode, 'account_deactivated' | 'role_changed' | 'password_reset' | 'second_step_reset'>;

export async function applyAccountEventToDevices(
  tx: Kysely<Database>,
  events: EventBus,
  input: {
    readonly userId: string;
    readonly mode: AccountEventDeviceMode;
    readonly reason: AccountEventReason;
    readonly actor: EventActor;
    readonly context: EventContext;
    readonly now: Date;
  },
): Promise<void> {
  const db = identityTables(tx);
  for (const device of await lockDevicesOfUser(db, input.userId)) {
    const ordered = input.mode === 'wipe' && (await orderWipe(db, device.id, input.now));
    if (!ordered) await stampInvalidated(db, device.id, input.now);
    const event: IdentityEvent = {
      type: ordered ? 'device.wipe_ordered' : 'device.logged_out',
      actor: input.actor,
      outcome: 'success',
      reasonCode: input.reason,
      objectType: 'device',
      objectId: device.id,
    };
    await events.publish(tx, event, input.context);
  }
}
