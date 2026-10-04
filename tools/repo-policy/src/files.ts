/**
 * Read-only access to the repository for the policy tests (EVM-006). Paths are repository-relative with `/`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

export const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

export const exists = (path: string): boolean => existsSync(join(ROOT, path));
export const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');
export const json = (path: string): unknown => JSON.parse(read(path)) as unknown;
export const yaml = (path: string): unknown => parse(read(path), { merge: true }) as unknown;

/** Removes `//` line comments of JSONC files (tsconfig) — enough for our configuration files. */
export const jsonc = (path: string): unknown =>
  JSON.parse(
    read(path)
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n'),
  ) as unknown;

/** Workspace directories (`apps/*`, `services/*`, `packages/*`, `tools/*`) that have a package.json. */
export function workspaces(): string[] {
  return ['apps', 'services', 'packages', 'tools'].flatMap((dir) =>
    exists(dir)
      ? readdirSync(join(ROOT, dir), { withFileTypes: true })
          .filter((entry) => entry.isDirectory() && exists(`${dir}/${entry.name}/package.json`))
          .map((entry) => `${dir}/${entry.name}`)
      : [],
  );
}

/** Files below a repository directory (recursive), skipping generated directories. */
export function filesBelow(dir: string, filter: (path: string) => boolean): string[] {
  const skipped = new Set(['node_modules', 'dist', 'coverage', '.turbo']);
  const walk = (path: string): string[] =>
    readdirSync(join(ROOT, path), { withFileTypes: true }).flatMap((entry) => {
      const child = `${path}/${entry.name}`;
      if (entry.isDirectory()) return skipped.has(entry.name) ? [] : walk(child);
      return entry.isFile() && filter(child) ? [child] : [];
    });
  return exists(dir) ? walk(dir) : [];
}

/**
 * The content git would commit — the index (`git show :<path>`); the file itself outside a git checkout. For files
 * whose unstaged local edits are the owner's own choice but must never be committed weakened (.claude/settings.json).
 */
export function staged(path: string, root = ROOT): string {
  const result = spawnSync('git', ['show', `:${path}`], { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout : readFileSync(join(root, path), 'utf8');
}

/** `git check-ignore -q`: true when git ignores the path. */
export function gitIgnores(path: string): boolean {
  return spawnSync('git', ['check-ignore', '-q', '--no-index', path], { cwd: ROOT }).status === 0;
}

export const record = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
export const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
export const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Today in Europe/Warsaw as YYYY-MM-DD (business time zone, conventions.md). */
export function today(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
