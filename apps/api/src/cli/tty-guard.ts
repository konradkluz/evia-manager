/**
 * Where the server command may run (AC1; SR-AUTH-12, SR-LOG-02). The activation link is printed once and must never
 * land in the logs of the container: `docker compose run` allocates a terminal by default and the output of a one-off
 * container goes to `docker logs` (and from there to the log collector), so "stdout is a TTY" is not enough. The command
 * therefore also refuses to run as the main process of a container (pid 1) or as a direct child of it (an init such as
 * tini is pid 1). Only `docker exec -it <api> …` passes: both streams are terminals and the parent is a shell.
 *
 * This file imports nothing: it runs before the application is loaded, before any database connection and before any
 * argument is interpreted, so a refusal can neither change data nor leak anything.
 */
export interface ProcessFacts {
  readonly stdinIsTTY: boolean | undefined;
  readonly stdoutIsTTY: boolean | undefined;
  readonly pid: number;
  readonly ppid: number;
}

/** @returns the reason the command must not run here, or undefined when it may */
export function interactiveRefusal({ stdinIsTTY, stdoutIsTTY, pid, ppid }: ProcessFacts): string | undefined {
  if (stdinIsTTY !== true || stdoutIsTTY !== true) {
    return 'Polecenie wymaga terminala interaktywnego (docker exec -it); bez terminala nie wydaje linku.';
  }
  if (pid === 1 || ppid === 1) {
    return 'Polecenie nie może być głównym procesem kontenera (docker run / docker compose run): wynik trafiłby do logów kontenera. Użyj: docker exec -it <kontener-api> …';
  }
  return undefined;
}
