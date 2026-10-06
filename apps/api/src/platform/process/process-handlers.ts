/**
 * Last-resort handlers of the process (SR-API-01, SR-ERR-01): an unhandled rejection is logged; an uncaught exception
 * is logged and stops the process (its state is unknown — the orchestrator restarts it). No details reach clients.
 */
import type { Logger } from '../logging/logger.ts';

export interface ProcessLike {
  on(event: 'unhandledRejection' | 'uncaughtException', listener: (error: unknown) => void): unknown;
  exit(code: number): void;
}

export function installProcessHandlers(target: ProcessLike, logger: Logger): void {
  target.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandled promise rejection');
  });
  target.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaught exception');
    target.exit(1);
  });
}
