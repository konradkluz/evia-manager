/**
 * Read-only GitHub REST client of the verifier (EVM-007 AC3; ADR-0018 n3; security-engineer A3, B "Limit API").
 * - One fixed base URL (https://api.github.com in production); every path starts with /repos/<owner>/<name>/.
 * - A timeout and a size limit on every response; a request budget per cycle.
 * - Fail-closed: an exhausted rate limit (rate-limit headers, 403/429), any status other than the expected one, a 5xx,
 *   a timeout, a body that is too large or not JSON — all are a Rejection, never a skipped check.
 * - Redirects are never followed with the token: the artifact download reads the 302 itself, checks the target host
 *   against the allow-list and fetches it WITHOUT the Authorization header (A3).
 */
import { hostAllowed } from './config.ts';
import { Rejection, ensure } from './errors.ts';

export interface GitHubOptions {
  readonly baseUrl: string;
  readonly token: string;
  readonly owner: string;
  readonly repo: string;
  readonly budget: number;
  readonly artifactHosts: readonly string[];
  readonly timeoutMs?: number;
  readonly maxJsonBytes?: number;
  readonly maxArtifactBytes?: number;
  /** Tests only: the redirect target may use http (a local stub of the blob storage). */
  readonly allowHttpArtifactHost?: boolean;
}

export interface JsonPage {
  readonly body: unknown;
  /** The `rel="next"` URL of the Link header (already checked to be a path of this repository), or null. */
  readonly next: string | null;
}

export const PRODUCTION_API = 'https://api.github.com';
const DEFAULT_TIMEOUT = 15_000;
export const MAX_JSON_BYTES = 4 * 1024 * 1024;
export const MAX_ARTIFACT_BYTES = 1024 * 1024;

/** Reads a body up to `limit` bytes — counted on the bytes actually received, never on Content-Length. */
export async function readCapped(response: Response, limit: number): Promise<Uint8Array> {
  if (response.body === null) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  // leaving the loop early (throw) cancels the stream
  for await (const value of response.body as unknown as AsyncIterable<Uint8Array>) {
    total += value.byteLength;
    if (total > limit) throw new Rejection('api-size', `response over ${String(limit)} bytes`);
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** `rel="next"` of a Link header. */
export function nextLink(header: string | null): string | null {
  if (header === null) return null;
  for (const part of header.split(',')) {
    const match = /^\s*<([^>]+)>\s*;\s*rel="next"\s*$/.exec(part);
    if (match?.[1] !== undefined) return match[1];
  }
  return null;
}

export class GitHub {
  readonly #options: GitHubOptions;
  readonly #base: URL;
  #requests = 0;

  constructor(options: GitHubOptions) {
    this.#options = options;
    this.#base = new URL(options.baseUrl);
    ensure(this.#base.pathname === '/' && this.#base.search === '' && this.#base.username === '', 'config', 'API base URL');
  }

  get requests(): number {
    return this.#requests;
  }

  /** Path prefix of every request: /repos/<owner>/<name>/. */
  get repoPath(): string {
    return `/repos/${encodeURIComponent(this.#options.owner)}/${encodeURIComponent(this.#options.repo)}`;
  }

  /** The full URL of a repository path; the base and the repository prefix are fixed. */
  url(path: string): URL {
    ensure(path.startsWith(`${this.repoPath}/`), 'api-path', path);
    return new URL(path, this.#base);
  }

  #count(): void {
    this.#requests += 1;
    if (this.#requests > this.#options.budget) throw new Rejection('api-budget', `more than ${String(this.#options.budget)} requests`);
  }

  async #fetch(url: URL, headers: Record<string, string>, redirect: 'manual' | 'error'): Promise<Response> {
    this.#count();
    try {
      return await fetch(url, { headers, redirect, signal: AbortSignal.timeout(this.#options.timeoutMs ?? DEFAULT_TIMEOUT) });
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      throw new Rejection(name === 'TimeoutError' || name === 'AbortError' ? 'api-timeout' : 'api-network', url.pathname);
    }
  }

  #headers(): Record<string, string> {
    return {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${this.#options.token}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': 'evia-deploy-agent',
    };
  }

  /** Limits and errors of a response other than 200 (A3, n3). */
  static #status(response: Response, path: string): never {
    const remaining = response.headers.get('x-ratelimit-remaining');
    if ((response.status === 403 || response.status === 429) && (remaining === '0' || response.headers.has('retry-after')))
      throw new Rejection('api-rate-limit', path);
    throw new Rejection(response.status >= 500 ? 'api-unavailable' : 'api-status', `${String(response.status)} ${path}`);
  }

  /** GET of a JSON resource of this repository (a path or a `next` URL returned by an earlier page). */
  async json(pathOrUrl: string): Promise<JsonPage> {
    const url = pathOrUrl.startsWith('/') ? this.url(pathOrUrl) : new URL(pathOrUrl);
    ensure(url.origin === this.#base.origin && url.pathname.startsWith(`${this.repoPath}/`), 'api-path', 'foreign URL');
    const response = await this.#fetch(url, this.#headers(), 'manual');
    if (response.status !== 200) GitHub.#status(response, url.pathname);
    const bytes = await readCapped(response, this.#options.maxJsonBytes ?? MAX_JSON_BYTES);
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      throw new Rejection('api-parse', url.pathname);
    }
    const next = nextLink(response.headers.get('link'));
    if (next !== null) {
      const target = new URL(next);
      ensure(target.origin === this.#base.origin && target.pathname.startsWith(`${this.repoPath}/`), 'api-path', 'foreign next link');
    }
    return { body, next };
  }

  /** Every page of a list resource (the array is the body itself, or `body[key]`). */
  async all(path: string, key?: string, maxPages = 20): Promise<unknown[]> {
    const items: unknown[] = [];
    let next: string | null = path;
    for (let page = 0; next !== null; page += 1) {
      ensure(page < maxPages, 'api-pages', path);
      const result: JsonPage = await this.json(next);
      const list = key === undefined ? result.body : (result.body as Record<string, unknown> | null)?.[key];
      ensure(Array.isArray(list), 'api-parse', `${path}: list expected`);
      items.push(...(list as unknown[]));
      next = result.next;
    }
    return items;
  }

  /**
   * The ZIP of an artifact (A3): `archive` must be exactly <base>/repos/<owner>/<name>/actions/artifacts/<id>/zip; the
   * answer must be a redirect to an allowed host; the second request carries no token and follows no redirect.
   */
  async artifactZip(id: number, archive: string): Promise<Uint8Array> {
    const expected = this.url(`${this.repoPath}/actions/artifacts/${String(id)}/zip`);
    ensure(archive === expected.href, 'v3-artifact-url', 'archive_download_url of another origin or repository');
    const first = await this.#fetch(expected, this.#headers(), 'manual');
    ensure([301, 302, 303, 307, 308].includes(first.status), 'v3-artifact-redirect', `status ${String(first.status)}`);
    const location = first.headers.get('location');
    ensure(location !== null && URL.canParse(location), 'v3-artifact-redirect', 'no location');
    const target = new URL(location);
    const scheme = target.protocol === 'https:' || (this.#options.allowHttpArtifactHost === true && target.protocol === 'http:');
    ensure(
      scheme && target.username === '' && hostAllowed(target.hostname, this.#options.artifactHosts),
      'v3-artifact-host',
      target.hostname,
    );
    const second = await this.#fetch(target, { 'user-agent': 'evia-deploy-agent' }, 'error');
    ensure(second.status === 200, 'v3-artifact-download', `status ${String(second.status)}`);
    return readCapped(second, this.#options.maxArtifactBytes ?? MAX_ARTIFACT_BYTES);
  }
}
