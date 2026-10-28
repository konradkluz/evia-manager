import { represent, type JournalRecord, type JournalServer } from './mock-journal.ts';
import type { Answer } from './mock-locations.ts';
import type { OrderServer } from './mock-procedures.ts';

/**
 * The part of the synthetic API that deletes, restores and redacts an entry of the journal (EVM-040): the role (`403`), the step-up
 * for the redaction (`403 step_up_required`), the order and the entry (`404`), the automatic entry (`409 entry_is_event`), `If-Match`
 * (`428` / `412 version_conflict`), `already_redacted`, and `ETag` on the reads. The register of the deletions, the audit and the
 * append-only trigger belong to the API integration tests.
 */
export type EraseOperation = 'read' | 'delete' | 'restore' | 'redact';

const MARKER_DAY = '03.10.2026';

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Answer => ({
  status,
  headers: { 'Content-Type': status >= 400 ? 'application/problem+json' : 'application/json', ...headers },
  body: JSON.stringify(body),
});

const problem = (status: number, code: string): Answer =>
  json(status, { type: `/problems/${code}`, title: code, status, code, traceId: 'abcdef0123456789abcdef0123456789' });

interface EraseInput {
  readonly role: 'administrator' | 'editor' | 'read_only';
  readonly ifMatch: string | undefined;
  readonly stepUpFresh: boolean;
}

export function answerEntryErase(
  server: JournalServer,
  orders: OrderServer,
  orderId: string,
  entryId: string,
  operation: EraseOperation,
  input: EraseInput,
): Answer {
  if (operation !== 'read' && input.role !== 'administrator') return problem(403, 'forbidden');
  if (operation === 'redact' && !input.stepUpFresh) return problem(403, 'step_up_required');
  const list = server.entries.get(orderId) ?? [];
  const found = list.find((entry) => entry.id === entryId);
  const visible = found !== undefined && (input.role === 'administrator' || (found.deletedAt ?? null) === null);
  if (!orders.created.some((entry) => entry.id === orderId) || !visible) return problem(404, 'not_found');
  const version = found.version ?? 1;
  if (operation === 'read') return json(200, represent(server, orders, orderId, found), { ETag: `"${String(version)}"` });
  if (found.kind === 'event' && operation !== 'restore') return problem(409, 'entry_is_event');
  if (input.ifMatch === undefined) return problem(428, 'precondition_required');
  if (input.ifMatch !== `"${String(version)}"`) return problem(412, 'version_conflict');
  const deleted = (found.deletedAt ?? null) !== null;
  if ((operation === 'delete' && deleted) || (operation === 'restore' && !deleted)) return problem(404, 'not_found');
  if (operation === 'redact' && (found.redactedAt ?? null) !== null) return problem(409, 'already_redacted');

  const changed: JournalRecord =
    operation === 'delete'
      ? { ...found, deletedAt: new Date().toISOString(), version: version + 1 }
      : operation === 'restore'
        ? { ...found, deletedAt: null, version: version + 1 }
        : {
            ...found,
            body: `Treść usunięta przez administratora ${MARKER_DAY}.`,
            redactedAt: new Date().toISOString(),
            version: version + 1,
          };
  server.entries.set(
    orderId,
    list.map((entry) => (entry.id === entryId ? changed : entry)),
  );
  if (operation === 'delete') return { status: 204, headers: {}, body: '' };
  return json(200, represent(server, orders, orderId, changed), { ETag: `"${String(version + 1)}"` });
}
