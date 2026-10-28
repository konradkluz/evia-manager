// Allow-list scrubbing of events and breadcrumbs (EVM-085 AC6, AC7; architect 2, security A1, A2).
// Structural types only: the module must not depend on any @sentry/* package, so it also fits the mobile app later.
import { redactText, scrubUrl } from './text.ts';

type Json = Record<string, unknown>;

export interface ScrubOptions {
  /** Tags that may stay in an event (values are still redacted). Everything else is dropped. */
  readonly allowedTags?: readonly string[];
}

const DEFAULT_TAGS: readonly string[] = ['service', 'runtime', 'handled', 'alertCode', 'environment'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const URL_BREADCRUMB_CATEGORIES = new Set(['http', 'fetch', 'xhr', 'navigation']);
const URL_KEYS = ['url', 'from', 'to'] as const;
const SAFE_EVENT_KEYS = ['event_id', 'timestamp', 'platform', 'level', 'environment', 'release', 'type'] as const;
const SAFE_FRAME_KEYS = ['function', 'module', 'lineno', 'colno', 'in_app', 'filename', 'abs_path'] as const;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pickScalars(source: Json, keys: readonly string[]): Json {
  const out: Json = {};
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') out[key] = value;
  }
  return out;
}

function scrubFrame(frame: unknown): Json {
  if (!isRecord(frame)) return {};
  const out = pickScalars(frame, SAFE_FRAME_KEYS);
  // No `vars` (local variables) and no source context lines: they can hold tokens and passwords.
  for (const key of ['filename', 'abs_path'] as const) {
    const value = out[key];
    if (typeof value === 'string') out[key] = scrubUrl(value);
  }
  return out;
}

function scrubException(exception: unknown): Json | undefined {
  if (!isRecord(exception) || !Array.isArray(exception['values'])) return undefined;
  const values = exception['values'].filter(isRecord).map((entry) => {
    const out: Json = {};
    if (typeof entry['type'] === 'string') out['type'] = redactText(entry['type']);
    if (typeof entry['value'] === 'string') out['value'] = redactText(entry['value']);
    if (isRecord(entry['mechanism'])) out['mechanism'] = pickScalars(entry['mechanism'], ['type', 'handled']);
    const stack = entry['stacktrace'];
    if (isRecord(stack) && Array.isArray(stack['frames'])) {
      out['stacktrace'] = { frames: stack['frames'].map(scrubFrame) };
    }
    return out;
  });
  return { values };
}

function scrubRequest(request: unknown): Json | undefined {
  if (!isRecord(request)) return undefined;
  // No data, cookies, headers (Referer, X-CSRF-Token, Authorization included) and no query_string: method and path only.
  const out: Json = {};
  if (typeof request['method'] === 'string') out['method'] = request['method'].slice(0, 16).toUpperCase();
  if (typeof request['url'] === 'string') out['url'] = scrubUrl(request['url']);
  return out;
}

function scrubTags(tags: unknown, allowed: readonly string[]): Json | undefined {
  if (!isRecord(tags)) return undefined;
  const out: Json = {};
  for (const key of allowed) {
    const value = tags[key];
    if (typeof value === 'string') out[key] = redactText(value).slice(0, 200);
    else if (typeof value === 'boolean' || typeof value === 'number') out[key] = value;
  }
  return out;
}

/** Scrubs one breadcrumb: URL-like data is reduced to the path, messages are redacted, other data is dropped. */
export function scrubBreadcrumb<T extends Json>(breadcrumb: T): T {
  const out: Json = pickScalars(breadcrumb, ['timestamp', 'type', 'category', 'level']);
  if (typeof breadcrumb['message'] === 'string') out['message'] = redactText(breadcrumb['message']);
  const category = typeof breadcrumb['category'] === 'string' ? breadcrumb['category'] : '';
  const data = breadcrumb['data'];
  if (URL_BREADCRUMB_CATEGORIES.has(category) && isRecord(data)) {
    const kept: Json = pickScalars(data, ['method', 'status_code']);
    for (const key of URL_KEYS) {
      const value = data[key];
      if (typeof value === 'string') kept[key] = scrubUrl(value);
    }
    out['data'] = kept;
  }
  return out as T;
}

/**
 * Scrubs one error event with an allow-list: what is not named here does not leave the process. Use as `beforeSend`
 * (tracing stays off; if it is ever enabled, scrub `beforeSendTransaction` and `beforeSendSpan` too).
 */
export function scrubEvent<T extends Json>(event: T, options: ScrubOptions = {}): T {
  const out: Json = pickScalars(event, SAFE_EVENT_KEYS);
  const sdk = event['sdk'];
  if (isRecord(sdk)) out['sdk'] = pickScalars(sdk, ['name', 'version']);
  if (typeof event['message'] === 'string') out['message'] = redactText(event['message']);
  if (typeof event['transaction'] === 'string') out['transaction'] = scrubUrl(event['transaction']);
  const exception = scrubException(event['exception']);
  if (exception !== undefined) out['exception'] = exception;
  const request = scrubRequest(event['request']);
  if (request !== undefined) out['request'] = request;
  const tags = scrubTags(event['tags'], options.allowedTags ?? DEFAULT_TAGS);
  if (tags !== undefined) out['tags'] = tags;
  const user = event['user'];
  if (isRecord(user) && typeof user['id'] === 'string' && UUID.test(user['id'])) out['user'] = { id: user['id'] };
  const crumbs = event['breadcrumbs'];
  if (Array.isArray(crumbs)) out['breadcrumbs'] = crumbs.filter(isRecord).map((crumb) => scrubBreadcrumb(crumb));
  return out as T;
}
