// @ts-check
/**
 * `pnpm run dev:init` (EVM-077 AC1; SR-INFRA-05): creates `.env` from `.env.example` with a random CURSOR_KEY (32 bytes,
 * base64url). The file is created with the flag `wx` — atomically, never overwriting and without a check-then-write race
 * (CWE-367). The key is never printed; errors carry a code only.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @typedef {{
 *   readFile?: (path: string) => string,
 *   writeFile?: (path: string, data: string, options: { flag: string, mode: number }) => void,
 *   random?: (size: number) => Buffer,
 * }} EnvFileDeps
 * @param {string} root repository root
 * @param {EnvFileDeps} [deps]
 * @returns {{ status: 'created' | 'exists' | 'no-example' | 'failed' }}
 */
export function initEnvFile(
  root,
  { readFile = (path) => readFileSync(path, 'utf8'), writeFile = writeFileSync, random = randomBytes } = {},
) {
  /** @type {string} */
  let example;
  try {
    example = readFile(join(root, '.env.example'));
  } catch {
    return { status: 'no-example' };
  }
  const key = random(32).toString('base64url');
  const content = example.replace(/^CURSOR_KEY=.*$/m, () => `CURSOR_KEY=${key}`);
  try {
    writeFile(join(root, '.env'), content, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    return { status: /** @type {{ code?: string }} */ (error).code === 'EEXIST' ? 'exists' : 'failed' };
  }
  return { status: 'created' };
}
