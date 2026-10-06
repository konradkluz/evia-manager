/**
 * Arguments of the server command (AC1, AC2). The only options are the emergency flag and its reason from a closed list;
 * everything else is rejected — in particular there is no way to pass a password, a token or an e-mail address on the
 * command line (argv is visible in `ps`, in the shell history and in process listings). The address is typed at the
 * prompt of the terminal.
 */
export type ParsedArguments =
  | { readonly ok: true; readonly emergency: false }
  | { readonly ok: true; readonly emergency: true; readonly reason: string }
  | { readonly ok: false; readonly message: string };

const USAGE = 'Użycie: bootstrap-admin [--emergency --reason <powód>] — adres e-mail jest podawany w terminalu, nie w argumentach.';

export function parseArguments(argv: readonly string[], reasons: readonly string[]): ParsedArguments {
  let emergency = false;
  let reason: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? '';
    if (argument === '--emergency') {
      emergency = true;
    } else if (argument === '--reason') {
      index += 1;
      reason = argv[index];
    } else {
      return { ok: false, message: `Nieznany argument. ${USAGE}` };
    }
  }
  if (!emergency) {
    return reason === undefined ? { ok: true, emergency: false } : { ok: false, message: `--reason działa tylko z --emergency. ${USAGE}` };
  }
  if (reason === undefined || !reasons.includes(reason)) {
    return { ok: false, message: `Tryb awaryjny wymaga --reason: ${reasons.join(' | ')}.` };
  }
  return { ok: true, emergency: true, reason };
}
