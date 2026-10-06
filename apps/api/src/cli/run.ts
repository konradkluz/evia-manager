/**
 * The body of the server command (AC1, AC2; SR-AUTH-12, RR-16): reads the address at the terminal, runs the bootstrap use
 * case and prints the link — only to the terminal, never through the logger. Terminal and use case are injected so the
 * whole flow is tested without a TTY; `process-run.ts` wires the real application and terminal.
 */
import { z } from 'zod';
import { EMERGENCY_REASONS, normalizeEmail, type BootstrapRequest, type BootstrapResult } from '../modules/identity/index.ts';
import { newTraceId } from '../platform/http/request-context.ts';
import { parseArguments } from './args.ts';

/** The terminal of the operator — the only place the link is ever written to. */
export interface TerminalIo {
  question(prompt: string): Promise<string>;
  write(text: string): void;
}

export interface BootstrapDependencies {
  readonly bootstrap: { run(request: BootstrapRequest, context: { origin: 'cli'; traceId: string }): Promise<BootstrapResult> };
  /** Origin of the panel from the configuration — the link never takes its host from anywhere else. */
  readonly panelOrigin: string;
}

const emailSchema = z.email().max(254);

const warsaw = new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', dateStyle: 'medium', timeStyle: 'short' });

export const EXIT_OK = 0;
export const EXIT_REFUSED = 1;
export const EXIT_USAGE = 2;

const REFUSALS: Record<string, string> = {
  active_administrator_exists:
    'Odmowa: w systemie jest już aktywny Administrator. Tryb awaryjny: --emergency --reason <powód> (wymaga potwierdzenia adresu konta).',
  account_unavailable: 'Odmowa: nie można wydać linku dla tego adresu.',
};

export async function executeBootstrap(
  argv: readonly string[],
  io: TerminalIo,
  { bootstrap, panelOrigin }: BootstrapDependencies,
): Promise<number> {
  const parsed = parseArguments(argv, EMERGENCY_REASONS);
  if (!parsed.ok) {
    io.write(`${parsed.message}\n`);
    return EXIT_USAGE;
  }

  const email = normalizeEmail(
    await io.question(
      parsed.emergency ? 'Adres e-mail konta Administratora do zresetowania: ' : 'Adres e-mail pierwszego Administratora: ',
    ),
  );
  if (!emailSchema.safeParse(email).success) {
    io.write('Odmowa: to nie jest poprawny adres e-mail.\n');
    return EXIT_REFUSED;
  }
  if (parsed.emergency) {
    io.write(
      'TRYB AWARYJNY: konto wróci do stanu "wymaga aktywacji", wszystkie jego sesje zostaną zakończone, a hasło i klucze dostępu usunięte.\n',
    );
    const confirmation = normalizeEmail(await io.question('Wpisz adres e-mail jeszcze raz, aby potwierdzić: '));
    if (confirmation !== email) {
      io.write('Odmowa: potwierdzenie nie zgadza się z adresem. Nic nie zmieniono.\n');
      return EXIT_REFUSED;
    }
  }

  const request: BootstrapRequest = parsed.emergency
    ? { mode: 'emergency', email, reason: parsed.reason as (typeof EMERGENCY_REASONS)[number] }
    : { mode: 'activation', email };
  const result = await bootstrap.run(request, { origin: 'cli', traceId: newTraceId() });
  if (result.kind === 'refused') {
    io.write(`${REFUSALS[result.reason] ?? 'Odmowa.'}\n`);
    return EXIT_REFUSED;
  }

  io.write(
    [
      '',
      'Jednorazowy link aktywacyjny (ważny 72 godziny, do ' + warsaw.format(result.expiresAt) + '):',
      '',
      `  ${panelOrigin}/activate#${result.token}`,
      '',
      'Otwórz go w przeglądarce na swoim komputerze. Nie wklejaj go do czatu, zgłoszeń ani poczty; po użyciu wyczyść ekran terminala (clear).',
      'Link nie zostanie wypisany ponownie — kolejne uruchomienie polecenia wydaje nowy i unieważnia ten.',
      '',
    ].join('\n'),
  );
  return EXIT_OK;
}
