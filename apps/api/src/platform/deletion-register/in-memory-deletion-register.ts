/** The fake of the port for the tests (EVM-040 AC3): objects are kept in memory; a test can make the register unavailable. Never wired by configuration. */
import type { Clock } from '../clock/clock.ts';
import { DeletionRegisterUnavailable, type DeletionReceipt, type DeletionRecord, type DeletionRegister } from './deletion-register.ts';
import { registerObjectOf } from './register-object.ts';

export class InMemoryDeletionRegister implements DeletionRegister {
  /** The objects written: key and JSON body, in the order of writing. */
  readonly objects: Array<{ readonly key: string; readonly body: string }> = [];
  /** The calls in order, including the refused ones (a test checks that nothing was asked for). */
  readonly calls: DeletionRecord[] = [];
  /** Runs inside `record`, before the object is stored: a test looks at the state of the database at that moment. */
  onRecord: (() => Promise<void>) | undefined;
  #unavailable = false;
  readonly #clock: Clock;

  constructor(clock: Clock) {
    this.#clock = clock;
  }

  /** Every `record` fails until {@link recover} (a register that is down). */
  failAll(): void {
    this.#unavailable = true;
  }

  recover(): void {
    this.#unavailable = false;
  }

  async record(record: DeletionRecord): Promise<DeletionReceipt> {
    this.calls.push(record);
    await this.onRecord?.();
    if (this.#unavailable) throw new DeletionRegisterUnavailable('write_failed');
    const object = registerObjectOf(record, this.#clock.now());
    this.objects.push({ key: object.key, body: object.body });
    return { operationId: object.operationId, key: object.key };
  }
}
