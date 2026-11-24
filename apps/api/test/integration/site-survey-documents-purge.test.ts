/**
 * The documents of a site survey go with it (EVM-147 AC5-AC7; ADR-0025 pt 2, 4; SR-PRIV-11, SR-FILE-11, SR-LOG-03) - the real worker job over PostgreSQL with the in-memory
 * register of deletions and storage: the register names the documents (identifiers only) before anything changes; the objects of every version and the upload sessions go;
 * the title is neutral, the description and the file name are gone, the document is deleted; the invariant `change_note IS NULL` fails closed; the race with a new document
 * (the register compared, and the lock of the order at the creation); the mode `report`; the extension and the assignment of a customer leave the documents; the operation
 * the replay of the register shares. Synthetic data only: the sentinels of the harness must stay out of every trail.
 */
import { sql } from 'kysely';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LEAVE_TO_REQUEST_MS } from '../../src/modules/media/application/erasure-completion.job.ts';
import { SurveyDocumentPurge } from '../../src/modules/media/application/survey-document-purge.ts';
import { ERASURE_MARKER_PATTERN } from '../../src/modules/media/domain/erasure.ts';
import { ErasureCompletionJob } from '../../src/modules/media/index.ts';
import { SITE_SURVEY_PURGE_FAILED } from '../../src/modules/work-orders/application/site-survey-purge.job.ts';
import { registerObjectOf } from '../../src/platform/deletion-register/register-object.ts';
import type { MetricsRegistry } from '../../src/platform/metrics/metrics.ts';
import { METRICS } from '../../src/platform/tokens.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { signInTo } from '../support/customer-erasure.ts';
import { sha256Of } from '../support/media-fixtures.ts';
import {
  DOC_DESCRIPTION,
  DOC_FILE,
  DOC_TITLE,
  addDocument,
  addMedia,
  auditText,
  changeLogText,
  closeStarted,
  db,
  everything,
  expectNoSentinel,
  inDays,
  job,
  metric,
  one,
  rowOf,
  start,
  survey,
  type Survey,
} from '../support/site-survey-purge-harness.ts';
import type { IdentityApp } from '../support/identity-app.ts';
import { uuidv7 } from '../support/uuid.ts';

afterEach(closeStarted);

const SYSTEM = '00000000-0000-7000-8000-000000000000';
const NOTE_SENTINEL = 'Notatka-wersji-synt-147-nazwisko';

interface DocumentRow {
  id: string;
  title: string;
  description: string | null;
  deleted_at: Date | null;
  deleted_by: string | null;
  file_purged_at: Date | null;
  version: number;
}
const documentsOf = async (app: IdentityApp, order: Survey): Promise<DocumentRow[]> =>
  (
    await sql<DocumentRow>`select id, title, description, deleted_at, deleted_by, file_purged_at, version from media.documents
      where work_order_id = ${order.id} order by id`.execute(db(app))
  ).rows;
interface FileRow {
  erased_at: Date | null;
  objects_erased_at: Date | null;
  original_filename: string | null;
}
const documentFilesOf = async (app: IdentityApp, order: Survey): Promise<FileRow[]> =>
  (
    await sql<FileRow>`select f.erased_at, f.objects_erased_at, f.original_filename from media.stored_files f
      join media.document_versions v on v.id = f.document_version_id join media.documents d on d.id = v.document_id
      where d.work_order_id = ${order.id} order by f.id`.execute(db(app))
  ).rows;
const documentSessionsOf = async (app: IdentityApp, order: Survey): Promise<string[]> =>
  (
    await sql<{ state: string }>`select s.state from media.upload_sessions s join media.stored_files f on f.id = s.stored_file_id
      join media.document_versions v on v.id = f.document_version_id join media.documents d on d.id = v.document_id
      where d.work_order_id = ${order.id}`.execute(db(app))
  ).rows.map((row) => row.state);
/** A document whose files the Administrator erased by hand before (EVM-051): the marker, the files erased, the objects gone - but not soft deleted. */
async function erasedByHand(app: IdentityApp, order: Survey): Promise<string> {
  const added = await addDocument(app, order);
  const at = new Date(app.clock.now().getTime() - 86_400_000);
  await sql`update media.documents set file_purged_at = ${at}, title = 'Plik usunięty przez administratora 30.04.2027.', description = null
    where id = ${added.documentId}`.execute(db(app));
  await sql`update media.stored_files set erased_at = ${at}, objects_erased_at = ${at}, original_filename = null where document_version_id in
    (select id from media.document_versions where document_id = ${added.documentId})`.execute(db(app));
  for (const key of added.keys) await app.storage.deleteObject(key);
  return added.documentId;
}
const expectErased = (rows: readonly DocumentRow[], files: readonly FileRow[]): void => {
  for (const row of rows) {
    expect(row.title, row.id).toMatch(ERASURE_MARKER_PATTERN);
    expect(row.description, row.id).toBeNull();
    expect(row.deleted_at, row.id).not.toBeNull();
    expect(row.deleted_by, row.id).not.toBeNull();
    expect(row.file_purged_at, row.id).not.toBeNull();
  }
  for (const file of files) {
    expect(file.erased_at).not.toBeNull();
    expect(file.objects_erased_at).not.toBeNull();
    expect(file.original_filename).toBeNull();
  }
};
const sample = (app: IdentityApp, name: string, label?: Record<string, string>) =>
  app.app
    .get<MetricsRegistry>(METRICS, { strict: false })
    .snapshot()
    .find((entry) => entry.name === name && (label === undefined || JSON.stringify(entry.labels) === JSON.stringify(label)))?.value;

describe('EVM-147 AC5: the documents are erased with the survey (enforce)', () => {
  it('EVM-147 AC5 the register names every document (two versions, a deleted one, one erased by hand) before the first change; then the objects and the sessions are gone, the title is neutral, the rest cleared; the location is anonymized; a second run changes nothing', async () => {
    const { current, register } = await start('enforce');
    const order = await survey(current, { deadline: inDays(current, -9) });
    const mediaKeys = await addMedia(current, order, 1);
    const twoVersions = await addDocument(current, order, { versions: 2, session: true });
    const deleted = await addDocument(current, order, { deleted: true });
    const byHand = await erasedByHand(current, order);
    let seenBeforeTheFirstChange = '';
    register.onRecord = async () => {
      seenBeforeTheFirstChange = await everything(current);
    };
    const before = await everything(current);

    expect(await job(current).run()).toMatchObject({ purged: 1, failed: 0, objectsPending: 0 });

    expect(seenBeforeTheFirstChange).toBe(before);
    expect(register.objects).toHaveLength(1);
    const entry = JSON.parse(register.objects[0]?.body ?? '{}') as Record<string, unknown>;
    expect(entry).toMatchObject({
      schemaVersion: 1,
      operationCode: 'site_survey_purged',
      subjectId: order.id,
      siteId: order.siteId,
      actorUserId: SYSTEM,
    });
    expect(entry['documentIds']).toEqual([twoVersions.documentId, deleted.documentId, byHand].sort());
    expectNoSentinel(register.objects[0]?.body ?? '');

    const rows = await documentsOf(current, order);
    expect(rows).toHaveLength(3);
    const files = await documentFilesOf(current, order);
    expect(files).toHaveLength(4);
    expectErased(rows, files);
    for (const key of [...twoVersions.keys, ...deleted.keys, ...mediaKeys]) expect(current.storage.currentKeys()).not.toContain(key);
    expect(await documentSessionsOf(current, order)).toEqual(['aborted']);
    const site = await one<{ anonymized_at: Date | null }>(current, sql`select anonymized_at from sites.sites where id = ${order.siteId}`);
    expect(site?.anonymized_at).not.toBeNull();

    expectNoSentinel(await everything(current));
    expectNoSentinel(await auditText(current));
    expectNoSentinel(await changeLogText(current));
    expectNoSentinel(current.logs.text);

    const after = await everything(current);
    expect(await job(current).run()).toMatchObject({ candidates: 0, purged: 0 });
    expect(await everything(current)).toBe(after);
    expect(register.objects).toHaveLength(1);
  });

  it('EVM-147 AC5 a survey without documents keeps the register entry of EVM-139: no field documentIds', async () => {
    const { current, register } = await start('enforce');
    await survey(current, { deadline: inDays(current, -9) });
    expect(await job(current).run()).toMatchObject({ purged: 1 });
    expect(JSON.parse(register.objects[0]?.body ?? '{}')).not.toHaveProperty('documentIds');
  });

  it('EVM-147 AC5 a register that does not take the record stops the erasure: the documents, their files and objects stay', async () => {
    const { current, register } = await start('enforce');
    const order = await survey(current, { deadline: inDays(current, -9) });
    const added = await addDocument(current, order, { versions: 2 });
    register.failAll();
    const before = await everything(current);

    await expect(job(current).run()).rejects.toMatchObject({ code: SITE_SURVEY_PURGE_FAILED });

    expect(await everything(current)).toBe(before);
    for (const key of added.keys) expect(current.storage.currentKeys()).toContain(key);
  });

  it('EVM-147 AC5 a storage that fails after the commit leaves the files of the documents marked erased; ErasureCompletionJob removes their objects', async () => {
    const { current, register } = await start('enforce');
    const order = await survey(current, { deadline: inDays(current, -9) });
    const added = await addDocument(current, order, { versions: 2 });
    const failing = vi.spyOn(current.storage, 'deleteObject').mockRejectedValue(new Error('storage down'));

    expect(await job(current).run()).toMatchObject({ purged: 1, failed: 0, objectsPending: 1 });
    expect((await documentFilesOf(current, order)).map((file) => [file.erased_at !== null, file.objects_erased_at !== null])).toEqual([
      [true, false],
      [true, false],
    ]);
    for (const key of added.keys) expect(current.storage.currentKeys()).toContain(key);

    failing.mockRestore();
    current.clock.advance(LEAVE_TO_REQUEST_MS + 1000);
    expect(await current.app.get(ErasureCompletionJob, { strict: false }).run()).toMatchObject({ completed: 2, failed: 0 });
    for (const key of added.keys) expect(current.storage.currentKeys()).not.toContain(key);
    expectErased(await documentsOf(current, order), await documentFilesOf(current, order));
    expect(register.objects).toHaveLength(1);
  });

  it('EVM-147 AC5 ADR-0025 pt 4: a version with a change_note stops the erasure FAIL CLOSED - the survey stays, the alert site_survey_purge_failed and the audit carry no value, the log names change_note_invariant', async () => {
    const { current } = await start('enforce');
    const order = await survey(current, { deadline: inDays(current, -9) });
    const added = await addDocument(current, order, { versions: 2 });
    await addMedia(current, order, 1);
    await sql`update media.document_versions set change_note = ${NOTE_SENTINEL} where document_id = ${added.documentId} and version_number = 2`.execute(
      db(current),
    );
    const before = await everything(current);

    await expect(job(current).run()).rejects.toMatchObject({ code: SITE_SURVEY_PURGE_FAILED });

    expect(await everything(current), 'ADR-0025 pkt 4: the survey must stay untouched').toBe(before);
    expect((await rowOf(current, order.id))?.purged_at).toBeNull();
    for (const key of added.keys) expect(current.storage.currentKeys()).toContain(key);
    const alerts = await one<{ n: string }>(
      current,
      sql`select count(*)::text as n from platform.security_alert_outbox where alert_code = 'site_survey_purge_failed'`,
    );
    expect(alerts?.n).toBe('1');
    const failed = await one<{ n: string }>(
      current,
      sql`select count(*)::text as n from audit.events where action = 'work_order.site_survey_purge_failed' and object_id = ${order.id}`,
    );
    expect(failed?.n).toBe('1');
    expect(sample(current, 'site_survey_purge_failures_total', { reason: 'change_note_invariant' })).toBe(1);
    expect(current.logs.text).toContain('"errorCode":"change_note_invariant"');
    expect(current.logs.text).not.toContain(NOTE_SENTINEL);
    expect(await auditText(current)).not.toContain(NOTE_SENTINEL);
    expectNoSentinel(current.logs.text);
  });
});

describe('EVM-147 AC6: the race, the mode report, the extension and the assignment of a customer', () => {
  it('EVM-147 AC6 a document committed while the register is written stops the survey (SurveyChangedDuringPurge); the next run erases it with the new document', async () => {
    const { current, register } = await start('enforce');
    const order = await survey(current, { deadline: inDays(current, -9) });
    await addDocument(current, order);
    let late = '';
    register.onRecord = async () => {
      if (late !== '') return;
      late = (await addDocument(current, order)).documentId;
    };

    expect(await job(current).run()).toMatchObject({ purged: 0, failed: 0, changedDuringPurge: 1 });
    expect((await documentsOf(current, order)).every((row) => row.title === DOC_TITLE && row.deleted_at === null)).toBe(true);

    expect(await job(current).run()).toMatchObject({ purged: 1, failed: 0 });
    const entry = JSON.parse(register.objects[1]?.body ?? '{}') as { documentIds?: string[] };
    expect(entry.documentIds).toContain(late);
    expect(entry.documentIds).toHaveLength(2);
    expectErased(await documentsOf(current, order), await documentFilesOf(current, order));
  });

  it('EVM-147 AC6 ADR-0025 pt 2: the creation of a document waits for the purge that holds the survey and then gets 404 - no document is written next to the tombstone', async () => {
    const { current, register } = await start('enforce');
    const order = await survey(current, { deadline: inDays(current, -9) });
    const editor = await signInTo(current, 'editor');
    let entered: () => void = () => undefined;
    const inRegister = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    register.onRecord = async () => {
      entered();
      await held;
    };

    const purging = job(current).run();
    await inRegister;
    const bytes = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2039, 9)]);
    let answered = false;
    const creating = editor.panel
      .post(
        `/api/v1/work-orders/${order.id}/documents`,
        {
          id: uuidv7(),
          kindCode: 'quote',
          title: DOC_TITLE,
          file: { fileName: DOC_FILE, contentType: 'application/pdf', declaredSize: bytes.length, sha256: sha256Of(bytes) },
        },
        { 'Idempotency-Key': uuidv7() },
      )
      .then((answer) => {
        answered = true;
        return answer;
      });
    // the creation waits on the lock of the order the purge holds
    await vi.waitFor(
      async () => {
        const waiting = await one<{ n: string }>(
          current,
          sql`select count(*)::text as n from pg_stat_activity where wait_event_type = 'Lock' and query ilike '%work_orders%'`,
        );
        expect(Number(waiting?.n)).toBeGreaterThanOrEqual(1);
      },
      { timeout: 15_000, interval: 50 },
    );
    expect(answered).toBe(false);
    release();

    expect(await purging).toMatchObject({ purged: 1, failed: 0 });
    const answer = await creating;
    expect(answer.status).toBe(404);
    expect(await documentsOf(current, order)).toEqual([]);
  });

  it('EVM-147 AC6 report counts the documents of the candidates and the broken invariants (numbers only) and changes nothing', async () => {
    const { current, register } = await start('report');
    const first = await survey(current, { deadline: inDays(current, -9) });
    const second = await survey(current, { deadline: inDays(current, -3) });
    const notYet = await survey(current, { deadline: inDays(current, 9) });
    await addDocument(current, first, { versions: 2 });
    await addDocument(current, first, { deleted: true });
    const noted = await addDocument(current, second);
    await addDocument(current, notYet);
    await sql`update media.document_versions set change_note = ${NOTE_SENTINEL} where document_id = ${noted.documentId}`.execute(
      db(current),
    );
    const before = await everything(current);

    expect(await job(current).run()).toEqual({ candidates: 2, documents: 3, changeNoteViolations: 1, purged: 0, failed: 0 });

    expect(await everything(current)).toBe(before);
    expect(register.calls).toHaveLength(0);
    expect(metric(current, 'site_survey_purge_candidate_documents')).toBe(3);
    expect(metric(current, 'site_survey_purge_change_note_violations')).toBe(1);
    const line = current.logs.lines.find((entry) => entry.includes('"mode":"report"'));
    expect(line).toContain('"documents":3');
    expect(line).toContain('"changeNoteViolations":1');
    expect(current.logs.text).not.toContain(NOTE_SENTINEL);
    expect(current.logs.text).not.toContain(noted.documentId);
    expectNoSentinel(current.logs.text);
  });

  it('EVM-147 AC6 the extension of a survey (EVM-140) does not change its documents', async () => {
    const { current } = await start('report');
    const order = await survey(current, { deadline: inDays(current, 5) });
    await addDocument(current, order, { versions: 2 });
    const before = await documentsOf(current, order);
    const editor = await signInTo(current, 'editor');
    const version = (await one<{ version: number }>(current, sql`select version from work_orders.work_orders where id = ${order.id}`))
      ?.version;
    const extended = await editor.panel.post(
      `/api/v1/work-orders/${order.id}/site-survey/extensions`,
      { reason: 'awaiting_client_decision', version },
      { 'Idempotency-Key': uuidv7() },
    );
    expect(extended.status, JSON.stringify(extended.body)).toBe(200);
    expect(await documentsOf(current, order)).toEqual(before);
  });

  it('EVM-147 AC6 the race of the assignment of a customer and the purge: the customer wins, the documents are not touched', async () => {
    const { current, register } = await start('enforce');
    const order = await survey(current, { deadline: inDays(current, -9) });
    const added = await addDocument(current, order, { versions: 2 });
    const before = await documentsOf(current, order);
    const customerId = await insertCustomer(current.database.admin, { firstName: 'Klient', lastName: 'Oferty', phone: '+48600147005' });
    let begun: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      begun = resolve;
    });
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const assigning = db(current)
      .transaction()
      .execute(async (trx) => {
        await sql`update work_orders.work_orders set customer_id = ${customerId}, site_survey_expires_at = null, requester_phone = null where id = ${order.id}`.execute(
          trx,
        );
        begun();
        await held;
      });
    await started;

    expect(await job(current).run()).toMatchObject({ purged: 0, failed: 0 });
    release();
    await assigning;

    expect(await job(current).run()).toMatchObject({ candidates: 0, purged: 0 });
    expect(register.calls).toHaveLength(0);
    expect(await documentsOf(current, order)).toEqual(before);
    for (const key of added.keys) expect(current.storage.currentKeys()).toContain(key);
  });
});

describe('EVM-147 AC7: the operation the replay of the register shares', () => {
  it('EVM-147 AC7 applied to the state before the purge with the documentIds of a register object, it gives the result of AC5; a repeat changes nothing; an identifier of another order is ignored', async () => {
    const { current } = await start('enforce');
    const purged = await survey(current, { deadline: inDays(current, -9) });
    await addDocument(current, purged, { versions: 2, session: true });
    await addDocument(current, purged, { deleted: true });
    expect(await job(current).run()).toMatchObject({ purged: 1 });
    const result = await documentsOf(current, purged);

    // the state BEFORE the purge (as a restored backup has it): an equal survey, still there
    const restored = await survey(current, { deadline: inDays(current, 30) });
    const twoVersions = await addDocument(current, restored, { versions: 2, session: true });
    const deleted = await addDocument(current, restored, { deleted: true });
    const other = await survey(current, { deadline: inDays(current, 30) });
    const stranger = await addDocument(current, other);
    const object = registerObjectOf(
      {
        operationCode: 'site_survey_purged',
        subjectType: 'work_order',
        subjectId: restored.id,
        workOrderId: restored.id,
        mediaAssetIds: [],
        documentIds: [twoVersions.documentId, deleted.documentId, stranger.documentId],
        actorUserId: SYSTEM,
      },
      current.clock.now(),
    );
    const read = JSON.parse(object.body) as { workOrderId: string; documentIds: string[] };
    const operation = current.app.get(SurveyDocumentPurge, { strict: false });

    await operation.apply(read.workOrderId, read.documentIds);

    const rows = await documentsOf(current, restored);
    expectErased(rows, await documentFilesOf(current, restored));
    const shape = (list: readonly DocumentRow[]) =>
      list.map((row) => ({
        title: row.title,
        description: row.description,
        deleted: row.deleted_at !== null,
        erased: row.file_purged_at !== null,
      }));
    expect(shape(rows)).toEqual(shape(result));
    for (const key of [...twoVersions.keys, ...deleted.keys]) expect(current.storage.currentKeys()).not.toContain(key);
    expect(await documentSessionsOf(current, restored)).toEqual(['aborted']);
    // another order's document named in the list is not touched
    const strangerRow = (await documentsOf(current, other))[0];
    expect(strangerRow).toMatchObject({
      title: DOC_TITLE,
      description: DOC_DESCRIPTION,
      deleted_at: null,
      file_purged_at: null,
      version: 1,
    });
    for (const key of stranger.keys) expect(current.storage.currentKeys()).toContain(key);

    const once = await everything(current);
    await operation.apply(read.workOrderId, read.documentIds);
    expect(await everything(current)).toBe(once);
    expectNoSentinel(JSON.stringify(rows));
    expect(JSON.stringify(rows)).not.toContain(DOC_FILE);
  });
});
