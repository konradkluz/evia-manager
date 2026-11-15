// @ts-check
/**
 * Dispatch of `node tools/mobile-e2e/cli.mjs [--skip-build] [--port <n>]` (EVM-009 AC4). Exit codes: 0 ok, 1 a problem or a failed
 * flow, 2 usage.
 */
import { DEFAULT_PORT } from './commands.mjs';
import { runE2e } from './run.mjs';

export const USAGE = 'Usage: node tools/mobile-e2e/cli.mjs [--skip-build] [--port <1024-65535>] [--only <scenario-name-or-prefix>[,<...>]]';

/**
 * @param {string[]} argv
 * @returns {{ skipBuild: boolean, port: number, only?: string[] } | null} null for unusable arguments
 * `--only` (EVM-130): the scenarios whose name is, or starts with, one of the given words — e.g. `--only upload-` for the upload scenarios
 */
export function parseArguments(argv) {
  let skipBuild = false;
  let port = DEFAULT_PORT;
  /** @type {string[] | null} */
  let only = null;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--skip-build') {
      skipBuild = true;
    } else if (argument === '--port') {
      const value = argv[index + 1];
      index += 1;
      if (value === undefined || !/^\d{4,5}$/.test(value) || Number(value) > 65_535 || Number(value) < 1024) return null;
      port = Number(value);
    } else if (argument === '--only') {
      const value = argv[index + 1];
      index += 1;
      if (value === undefined || !/^[a-z0-9-]+(,[a-z0-9-]+)*$/.test(value)) return null;
      only = value.split(',');
    } else {
      return null;
    }
  }
  return { skipBuild, port, ...(only === null ? {} : { only }) };
}

/**
 * @param {string[]} argv
 * @param {import('./run.mjs').Host} host
 * @returns {Promise<number>}
 */
export async function main(argv, host) {
  const options = parseArguments(argv);
  if (options === null) {
    host.log(USAGE);
    return 2;
  }
  return runE2e(options, host);
}
