/**
 * The server command of the read model (ADR-0017 W11, T7; EVM-034): `rebuild` and `verify` of the projection of the list of work
 * orders. No HTTP route and no function of the panel — the operator runs it in the container of the API
 * (`node dist/src/cli/overview.js rebuild|verify [--only <uuid> …]`), as the application role, with the same locks and the same
 * recomputation as the handlers of the events. The arguments are a command and at most 100 identifiers (validated as UUIDs).
 *
 * The output and the log carry NUMBERS and identifiers of orders only — never a date, a name or an amount (SR-LOG-02, SR-LOG-03).
 * `verify` ends with exit code 1 when the projection differs from the recomputation (an alert for the authorisation column is
 * enqueued in the outbox of the platform).
 */
import { z } from 'zod';
import { COLUMN_GROUPS, type ProjectionMaintenance } from '../modules/overview/index.ts';
import type { Logger } from '../platform/logging/logger.ts';

export const EXIT_OK = 0;
export const EXIT_DRIFT = 1;
export const EXIT_USAGE = 2;

export const MAX_ONLY = 100;
const USAGE = `Użycie: overview rebuild|verify [--only <uuid> ...] (do ${MAX_ONLY} identyfikatorów zleceń).`;

const uuid = z.uuid();

export type ParsedCommand =
  | { readonly ok: true; readonly command: 'rebuild' | 'verify'; readonly only: readonly string[] | undefined }
  | { readonly ok: false; readonly message: string };

export function parseOverviewArguments(argv: readonly string[]): ParsedCommand {
  const [command, ...rest] = argv;
  if (command !== 'rebuild' && command !== 'verify') return { ok: false, message: `Nieznane polecenie. ${USAGE}` };
  if (rest.length === 0) return { ok: true, command, only: undefined };
  const [flag, ...identifiers] = rest;
  if (flag !== '--only' || identifiers.length === 0) return { ok: false, message: `Nieznany argument. ${USAGE}` };
  if (identifiers.length > MAX_ONLY) return { ok: false, message: `Za dużo identyfikatorów. ${USAGE}` };
  if (!identifiers.every((value) => uuid.safeParse(value).success)) {
    return { ok: false, message: `Identyfikator zlecenia musi być UUID. ${USAGE}` };
  }
  return { ok: true, command, only: identifiers };
}

export interface OverviewIo {
  write(text: string): void;
}

export interface OverviewDependencies {
  readonly maintenance: Pick<ProjectionMaintenance, 'rebuild' | 'verify'>;
  readonly logger: Logger;
  readonly traceId: string;
}

/** @returns the exit code of the command */
export async function executeOverviewCommand(argv: readonly string[], io: OverviewIo, deps: OverviewDependencies): Promise<number> {
  const parsed = parseOverviewArguments(argv);
  if (!parsed.ok) {
    io.write(`${parsed.message}\n`);
    return EXIT_USAGE;
  }
  const options = parsed.only === undefined ? {} : { only: parsed.only };
  deps.logger.info({ traceId: deps.traceId, command: parsed.command, named: parsed.only?.length ?? 0 }, 'overview: start');
  if (parsed.command === 'rebuild') {
    const report = await deps.maintenance.rebuild(options);
    deps.logger.info({ traceId: deps.traceId, command: 'rebuild', ...report }, 'overview: done');
    io.write(`rebuild: przeliczono ${report.rebuilt}, partii ${report.batches}, pominięto ${report.skipped}\n`);
    return EXIT_OK;
  }
  const report = await deps.maintenance.verify({ ...options, traceId: deps.traceId });
  const differing = COLUMN_GROUPS.reduce((total, group) => total + report.drift[group].length, 0) + report.missing.length;
  deps.logger.info(
    { traceId: deps.traceId, command: 'verify', checked: report.checked, inSync: report.inSync, differing },
    'overview: done',
  );
  io.write(`verify: sprawdzono ${report.checked}, zgodnych ${report.inSync}, brak wiersza ${report.missing.length}\n`);
  for (const group of COLUMN_GROUPS) io.write(`  ${group}: ${report.drift[group].length}\n`);
  for (const id of report.missing) io.write(`  missing ${id}\n`);
  for (const group of COLUMN_GROUPS) for (const id of report.drift[group]) io.write(`  ${group} ${id}\n`);
  return differing === 0 ? EXIT_OK : EXIT_DRIFT;
}
