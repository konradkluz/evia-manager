// @ts-check
/**
 * Dispatch of `node tools/mobile-e2e/cli.mjs [--skip-build] [--port <n>]` (EVM-009 AC4). Exit codes: 0 ok, 1 a problem or a failed
 * flow, 2 usage.
 */
import { DEFAULT_PORT } from './commands.mjs';
import { runE2e } from './run.mjs';

export const USAGE = 'Usage: node tools/mobile-e2e/cli.mjs [--skip-build] [--port <1024-65535>]';

/**
 * @param {string[]} argv
 * @returns {{ skipBuild: boolean, port: number } | null} null for unusable arguments
 */
export function parseArguments(argv) {
  let skipBuild = false;
  let port = DEFAULT_PORT;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--skip-build') {
      skipBuild = true;
    } else if (argument === '--port') {
      const value = argv[index + 1];
      index += 1;
      if (value === undefined || !/^\d{4,5}$/.test(value) || Number(value) > 65_535 || Number(value) < 1024) return null;
      port = Number(value);
    } else {
      return null;
    }
  }
  return { skipBuild, port };
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
