import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROJECTION_EVENT_TYPES } from '../../src/modules/overview/application/projection-recorder.ts';
import { PARTY_EVENT_TYPES } from '../../src/modules/parties/events.ts';
import { PAYMENT_MILESTONE_EVENT_TYPES, PAYMENT_MILESTONE_JOURNAL_EVENT_TYPES } from '../../src/modules/payments/events.ts';
import { PROCEDURE_EVENT_TYPES, PROCEDURE_JOURNAL_EVENT_TYPES } from '../../src/modules/procedures/events.ts';
import { SITE_EVENT_TYPES } from '../../src/modules/sites/events.ts';
import { WORK_ORDER_EVENT_TYPES, WORK_ORDER_JOURNAL_EVENT_TYPES } from '../../src/modules/work-orders/events.ts';

const SRC = join(import.meta.dirname, '..', '..', 'src');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}

describe('the architecture of the read model (EVM-034; ADR-0017 W2, W11)', () => {
  it('EVM-034 AC6 `.transaction()` occurs only in platform/database/transactional.ts: every unit of work goes through runInTransaction', () => {
    const offenders = sourceFiles(SRC)
      .filter((file) => /\.transaction\(\)/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file).split(sep).join('/'))
      .filter((file) => file !== 'platform/database/transactional.ts');
    expect(offenders).toEqual([]);
  });

  it('EVM-034 AC6 EVM-056 AC1 every domain event of the modules that feed the projection has a handler in overview — the milestones of payments included (P4)', () => {
    const expected = [
      ...WORK_ORDER_EVENT_TYPES,
      ...WORK_ORDER_JOURNAL_EVENT_TYPES,
      ...PROCEDURE_EVENT_TYPES,
      ...PROCEDURE_JOURNAL_EVENT_TYPES,
      ...SITE_EVENT_TYPES,
      ...PARTY_EVENT_TYPES,
      ...PAYMENT_MILESTONE_EVENT_TYPES,
      ...PAYMENT_MILESTONE_JOURNAL_EVENT_TYPES,
    ];
    expect([...PROJECTION_EVENT_TYPES].sort()).toEqual([...new Set(expected)].sort());
  });

  it('EVM-057 AC1 AC2 AC3 AC4 P4 the corrections and the deletion of a milestone recompute the read model: their seven events have a handler', () => {
    expect(PROJECTION_EVENT_TYPES).toEqual(
      expect.arrayContaining([
        'payment_milestone.invoice_withdrawn',
        'payment_milestone.invoice_cancelled',
        'payment_milestone.payment_undone',
        'payment_milestone.restored',
        'payment_milestone.amount_corrected',
        'payment_milestone.deleted',
        'payment_milestone.removed',
      ]),
    );
  });

  it('EVM-034 AC6 no lock of a row of work_orders.work_orders is FOR UPDATE: the commands take FOR NO KEY UPDATE (no cycle with the key checks)', () => {
    const offenders = sourceFiles(join(SRC, 'modules', 'work-orders'))
      .filter((file) => /\.forUpdate\(\)/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(SRC, file).split(sep).join('/'));
    expect(offenders).toEqual([]);
  });

  it('EVM-034 W11 the job queue library is imported only by its adapter; a module and the platform never import the adapter', () => {
    const offenders = sourceFiles(SRC)
      .map((file) => ({ file: relative(SRC, file).split(sep).join('/'), source: readFileSync(file, 'utf8') }))
      .filter(
        ({ file, source }) =>
          (/from 'pg-boss'/.test(source) && file !== 'platform/jobs/pg-boss-job-queue.ts') ||
          (/pg-boss-job-queue/.test(source) && !file.startsWith('worker/') && !file.startsWith('platform/jobs/')),
      )
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it('EVM-024 AC6 the SMTP library is imported only by its adapter; the adapter is imported only by platform/email and the worker (one way to send an e-mail)', () => {
    const offenders = sourceFiles(SRC)
      .map((file) => ({ file: relative(SRC, file).split(sep).join('/'), source: readFileSync(file, 'utf8') }))
      .filter(
        ({ file, source }) =>
          (/from 'nodemailer'/.test(source) && file !== 'platform/email/smtp-email-sender.ts') ||
          (/smtp-email-sender/.test(source) && !file.startsWith('worker/') && !file.startsWith('platform/email/')),
      )
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
    expect(readFileSync(join(SRC, 'platform', 'email', 'smtp-email-sender.ts'), 'utf8')).toMatch(/from 'nodemailer'/);
  });
});
