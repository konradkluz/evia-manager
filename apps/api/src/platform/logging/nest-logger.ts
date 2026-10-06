/** Routes NestJS framework messages to the pino logger (JSON, redaction) instead of the console logger. */
import type { LoggerService } from '@nestjs/common';
import type { Logger } from './logger.ts';

type Level = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

export class NestLoggerAdapter implements LoggerService {
  readonly #logger: Logger;

  constructor(logger: Logger) {
    this.#logger = logger;
  }

  log(message: unknown, ...params: unknown[]): void {
    this.#write('info', message, params);
  }

  error(message: unknown, ...params: unknown[]): void {
    this.#write('error', message, params);
  }

  warn(message: unknown, ...params: unknown[]): void {
    this.#write('warn', message, params);
  }

  debug(message: unknown, ...params: unknown[]): void {
    this.#write('debug', message, params);
  }

  verbose(message: unknown, ...params: unknown[]): void {
    this.#write('trace', message, params);
  }

  fatal(message: unknown, ...params: unknown[]): void {
    this.#write('fatal', message, params);
  }

  /** Nest passes the context as the last string parameter; stack strings and other values are not logged. */
  #write(level: Level, message: unknown, params: unknown[]): void {
    const last = params.at(-1);
    const fields = {
      ...(typeof last === 'string' ? { context: last } : {}),
      ...(message instanceof Error ? { err: message } : {}),
    };
    this.#logger[level](fields, typeof message === 'string' ? message : 'nest event');
  }
}
