/**
 * Chooses the adapter of the register from the settings (EVM-040 AC3), once at start. The S3 adapter when all five settings are present; in every
 * other case the adapter that refuses (fail closed for the erasing operations, the service stays healthy). One log line says which: a warning for
 * "not configured", an error for an incomplete set - with the NAMES of the settings, never a value (SR-LOG-02). The failures are counted in
 * `deletion_register_failures_total{reason}` so an unavailable register is visible (SR-LOG-06), not only a refused request.
 */
import type { Clock } from '../clock/clock.ts';
import type { Logger } from '../logging/logger.ts';
import type { MetricsRegistry } from '../metrics/metrics.ts';
import type { DeletionRegister } from './deletion-register.ts';
import type { DeletionRegisterSettings } from './deletion-register-settings.ts';
import { S3DeletionRegister } from './s3-deletion-register.ts';
import { UnavailableDeletionRegister } from './unavailable-deletion-register.ts';

export const REGISTER_FAILURES_METRIC = 'deletion_register_failures_total';

export function deletionRegisterFor(
  settings: DeletionRegisterSettings,
  clock: Clock,
  logger: Logger,
  metrics: MetricsRegistry,
): DeletionRegister {
  const failures = metrics.counter(REGISTER_FAILURES_METRIC, ['reason']);
  if (settings.status === 'configured') return new S3DeletionRegister(settings, clock, logger, failures);
  if (settings.status === 'unconfigured') {
    logger.warn('deletion register is not configured: erasing operations are refused (503)');
  } else {
    logger.error(
      { missing: settings.missing, invalid: settings.invalid },
      'deletion register settings are incomplete: erasing operations are refused (503)',
    );
  }
  return new UnavailableDeletionRegister(failures);
}
