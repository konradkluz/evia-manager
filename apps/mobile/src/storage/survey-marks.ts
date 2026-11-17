import type { DbAccess } from './database';

/**
 * The marks "this order was a site survey" (EVM-137, W10): the ids of the orders the phone has seen as surveys - created by itself or read
 * from the replica. A survey can disappear from the replica (the server deleted it) while notes, comments and files for it still wait in
 * the queue; only the mark tells that they must never be offered "Dodaj do innego zlecenia" (the photos of a house in the files of another
 * order would be a leak). One JSON array of UUIDs in the `meta` table of the queue side (no migration; a UUID is not personal data); the
 * newest 500 are kept. It lives and dies with the encrypted database (the wipe removes the file).
 */
const KEY = 'survey_orders';
export const MAX_SURVEY_MARKS = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function decode(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && UUID.test(item)) : [];
  } catch {
    return [];
  }
}

export class SqlSurveyMarks {
  readonly #db: DbAccess;

  constructor(db: DbAccess) {
    this.#db = db;
  }

  /** The marked ids; a damaged document is an empty list (the marks are re-learned from the queue and the replica). */
  async read(): Promise<string[]> {
    return this.#db.read(async (tx) => decode((await tx.get('SELECT value FROM meta WHERE key = ?', [KEY]))?.['value']));
  }

  /** Adds ids that are not marked yet (valid UUIDs only), one transaction; nothing is written when nothing is new. */
  async add(ids: readonly string[]): Promise<void> {
    const fresh = ids.filter((id) => UUID.test(id));
    if (fresh.length === 0) return;
    await this.#db.transaction(async (tx) => {
      const known = decode((await tx.get('SELECT value FROM meta WHERE key = ?', [KEY]))?.['value']);
      const have = new Set(known);
      const added = [...new Set(fresh)].filter((id) => !have.has(id));
      if (added.length === 0) return;
      const next = [...known, ...added].slice(-MAX_SURVEY_MARKS);
      await tx.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', [
        KEY,
        JSON.stringify(next),
      ]);
    });
  }
}
