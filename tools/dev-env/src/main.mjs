// @ts-check
/**
 * Dispatch of `node tools/dev-env/cli.mjs <init|dev|admin|seed|stop|reset>` (EVM-077). Exit codes: 0 ok, 1 a problem or a
 * refusal, 2 usage or no interactive terminal.
 */
import { adminCommand, devCommand, EXIT_USAGE, initCommand, resetCommand, seedCommand, stopCommand } from './commands.mjs';

export const USAGE = 'Użycie: node tools/dev-env/cli.mjs init | dev | admin | seed | stop | reset';

/**
 * @param {string[]} argv
 * @param {import('./commands.mjs').Deps} deps
 * @returns {Promise<number>}
 */
export async function main(argv, deps) {
  const [command, ...rest] = argv;
  if (rest.length > 0 || command === undefined) {
    deps.err(`${USAGE}\n`);
    return EXIT_USAGE;
  }
  switch (command) {
    case 'init':
      return initCommand(deps);
    case 'dev':
      return devCommand(deps);
    case 'admin':
      return adminCommand(deps);
    case 'seed':
      return seedCommand(deps);
    case 'stop':
      return stopCommand(deps);
    case 'reset':
      return resetCommand(deps);
    default:
      deps.err(`${USAGE}\n`);
      return EXIT_USAGE;
  }
}
