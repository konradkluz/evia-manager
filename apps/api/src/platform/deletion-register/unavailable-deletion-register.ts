/**
 * The register of an installation that is not configured (EVM-040 AC3; fail closed): every record is refused, so no erasure starts. The service
 * itself stays healthy - readiness does not depend on the register, so a missing bucket never blocks a deployment; only the erasing operations
 * answer `503 deletion_register_unavailable`.
 */
import type { Counter } from '../metrics/metrics.ts';
import { DeletionRegisterUnavailable, type DeletionReceipt, type DeletionRegister } from './deletion-register.ts';

export class UnavailableDeletionRegister implements DeletionRegister {
  readonly #failures: Counter;

  constructor(failures: Counter) {
    this.#failures = failures;
  }

  record(): Promise<DeletionReceipt> {
    this.#failures.increment({ reason: 'not_configured' });
    return Promise.reject(new DeletionRegisterUnavailable('not_configured'));
  }
}
