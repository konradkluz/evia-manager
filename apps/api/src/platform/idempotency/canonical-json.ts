/**
 * The identity of a request body for idempotency (SR-API-05, AB-09): SHA-256 of the CANONICAL JSON of the parsed body — object keys
 * sorted at every depth, no white space — so the same content in another key order is the same request, and any other
 * content is not. The input is the body after the schema of the contract (JSON values only).
 */
import { createHash } from 'node:crypto';

export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const entries = Object.entries(value)
    .filter(([, member]) => member !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, member]) => `${JSON.stringify(key)}:${canonicalJson(member)}`).join(',')}}`;
}

/** @returns 64 lower-case hex digits */
export const requestHash = (body: unknown): string => createHash('sha256').update(canonicalJson(body), 'utf8').digest('hex');
