/**
 * Query string checks (api-guidelines.md → Walidacja wejścia; ASVS V15.3.7, SR-INPUT-06): a parameter the contract does
 * not declare is `400 unknown_parameter`, a repeated one is `400 duplicate_parameter` (lists are comma separated).
 */
import type { Request } from 'express';
import { ProblemException } from './problem.ts';

/** Methods that do not change state (no CSRF check, `mutating: false`). */
export const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

export function assertQueryParameters(query: Request['query'], declared: readonly string[]): void {
  const entries = Object.entries(query);
  if (entries.some(([name]) => !declared.includes(name))) throw new ProblemException('unknown_parameter');
  if (entries.some(([, value]) => Array.isArray(value))) throw new ProblemException('duplicate_parameter');
}
