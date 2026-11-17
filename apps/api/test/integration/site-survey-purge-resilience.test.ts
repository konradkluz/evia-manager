/**
 * The automatic purge of site surveys - the rejected survey, the race, the synchronization, the retries, the limit and the permissions (EVM-139 AC3-AC6; ADR-0024 pt 9;
 * SR-PRIV-11, SR-FILE-11, SR-AUTHZ-02, SR-LOG-03) against the real worker job over PostgreSQL. The helpers and the sentinels are those of `site-survey-purge.test.ts`.
 */
import { sql } from 'kysely';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LEAVE_TO_REQUEST_MS } from '../../src/modules/media/application/erasure-completion.job.ts';
import { ErasureCompletionJob } from '../../src/modules/media/index.ts';
import { SITE_SURVEY_PURGE_FAILED } from '../../src/modules/work-orders/application/site-survey-purge.job.ts';
import { SITE_SURVEY_PURGE_LIMIT_PER_RUN } from '../../src/modules/work-orders/domain/site-survey-purge.ts';
import { WORK_ORDER_MUTATION_TARGET, type WorkOrderMutationTarget } from '../../src/modules/work-orders/system-ports.ts';
import { DeletionRegisterUnavailable } from '../../src/platform/deletion-register/deletion-register.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { signInTo } from '../support/customer-erasure.ts';
import { principal } from '../support/principals.ts';
import {
  DAY,
  NOTE,
  TITLE,
  addMedia,
  changeLogText,
  closeStarted,
  db,
  expectNoSentinel,
  inDays,
  job,
  metric,
  one,
  rowOf,
  start,
  survey,
} from '../support/site-survey-purge-harness.ts';

afterEach(closeStarted);

describe('EVM-139 AC3: a rejected survey, a survey with a customer, the race', () => {
  it('EVM-139 AC3 a cancelled survey (its deadline is 14 days after the cancellation) is purged like any other; a restored one with a later deadline is not', async () => {
    const { current, register } = await start('enforce');
    const cancelled = await survey(current, { deadline: inDays(current, -1), status: 'cancelled' });
    const restored = await survey(current, { deadline: inDays(current, 14) });

    expect(await job(current).run()).toMatchObject({ candidates: 1, purged: 1, failed: 0 });
    expect((await rowOf(current, cancelled.id))?.purged_at).not.toBeNull();
    expect((await rowOf(current, restored.id))?.purged_at).toBeNull();
    expect(register.objects).toHaveLength(1);

    // the restored survey keeps its 14 days: 13 days later nothing, 15 days later it is a candidate
    current.clock.advance(13 * DAY);
    expect(await job(current).run()).toMatchObject({ candidates: 0, purged: 0 });
    current.clock.advance(2 * DAY);
    expect(await job(current).run()).toMatchObject({ candidates: 1, purged: 1 });
  });

  it('EVM-139 AC3 the race: a customer assigned in the last moment wins - the locked survey is skipped, then it is no candidate; nothing is erased and nothing is corrupted', async () => {
    const { current, register } = await start('enforce');
    const order = await survey(current, { deadline: inDays(current, -9) });
    const customerId = await insertCustomer(current.database.admin, { firstName: 'Klient', lastName: 'Wyscigu', phone: '+48600139005' });
    let started: () => void = () => undefined;
    const begun = new Promise<void>((resolve) => {
      started = resolve;
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
        started();
        await held;
      });
    await begun;

    expect(await job(current).run()).toMatchObject({ candidates: 1, purged: 0, failed: 0 });
    release();
    await assigning;

    expect(register.calls).toHaveLength(0);
    expect(await job(current).run()).toMatchObject({ candidates: 0, purged: 0 });
    expect(await rowOf(current, order.id)).toMatchObject({ title: TITLE, description: NOTE, deleted_at: null, purged_at: null });
    const customer = await one<{ customer_id: string }>(
      current,
      sql`select customer_id from work_orders.work_orders where id = ${order.id}`,
    );
    expect(customer?.customer_id).toBe(customerId);
  });

  it('EVM-139 AC3 two runs at the same time purge a survey ONCE: one register entry, one tombstone', async () => {
    const { current, register } = await start('enforce');
    const order = await survey(current, { deadline: inDays(current, -9) });
    const [first, second] = await Promise.all([job(current).run(), job(current).run()]);
    expect((first['purged'] ?? 0) + (second['purged'] ?? 0)).toBe(1);
    expect(register.objects).toHaveLength(1);
    expect((await rowOf(current, order.id))?.version).toBe(2);
  });
});

describe('EVM-139 AC4: synchronization, queues and access after the purge', () => {
  it('EVM-139 AC4 the change log gets the marker delete for the order (identifiers only), the mutation of a phone finds the target unavailable, nobody reads the media', async () => {
    const { current } = await start('enforce');
    const order = await survey(current, { deadline: inDays(current, -9) });
    await addMedia(current, order, 1);
    const admin = await signInTo(current, 'administrator');
    const readOnly = await signInTo(current, 'read_only');
    const before = Number((await one<{ n: string }>(current, sql`select coalesce(max(seq), 0)::text as n from sync.change_log`))?.n);

    await job(current).run();

    const markers = (
      await sql<{ entity_type: string; entity_id: string; operation: string }>`
        select entity_type, entity_id, operation from sync.change_log where seq > ${before}`.execute(db(current))
    ).rows;
    expect(markers).toContainEqual({ entity_type: 'work_order', entity_id: order.id, operation: 'delete' });
    expectNoSentinel(await changeLogText(current));

    // the phone: a mutation of the queue to the purged survey is refused without a retry - the person with access to the order gets `target_unavailable`
    const target = current.app.get<WorkOrderMutationTarget>(WORK_ORDER_MUTATION_TARGET, { strict: false });
    const state = await db(current)
      .transaction()
      .execute((trx) => target.stateOf(trx, principal({ userId: admin.userId, role: 'administrator', channel: 'mobile' }), order.id));
    expect(['target_unavailable', 'forbidden']).toContain(state);

    // the panel: the order and its media are absent for every role
    const path = `/api/v1/work-orders/${order.id}`;
    for (const browser of [admin, readOnly]) {
      expect((await browser.panel.get(`${path}/media-assets`)).status).toBe(404);
      expect((await browser.panel.get(path)).status).toBe(404);
    }
  });
});

describe('EVM-139 AC5: retries, a failure of one survey, the limit, the alert', () => {
  it('EVM-139 AC5 a storage that fails after the commit leaves the files marked erased; the sweep of the worker finishes it, with ONE register entry and no orphan', async () => {
    const { current, register } = await start('enforce');
    const order = await survey(current, { deadline: inDays(current, -9) });
    await addMedia(current, order, 2);
    const failing = vi.spyOn(current.storage, 'deleteObject').mockRejectedValue(new Error('storage down'));

    expect(await job(current).run()).toMatchObject({ purged: 1, failed: 0, objectsPending: 1 });
    const pending = await sql<{ erased: boolean; confirmed: boolean }>`
      select f.erased_at is not null as erased, f.objects_erased_at is not null as confirmed from media.stored_files f
      join media.media_assets a on a.id = f.media_asset_id where a.work_order_id = ${order.id}`.execute(db(current));
    expect(pending.rows).toEqual([
      { erased: true, confirmed: false },
      { erased: true, confirmed: false },
    ]);
    expect(current.storage.currentKeys()).toHaveLength(2);

    failing.mockRestore();
    current.clock.advance(LEAVE_TO_REQUEST_MS + 1000);
    expect(await current.app.get(ErasureCompletionJob, { strict: false }).run()).toMatchObject({ completed: 2, failed: 0 });
    expect(current.storage.currentKeys()).toHaveLength(0);

    // the purged survey is no candidate again: nothing is written to the register a second time
    expect(await job(current).run()).toMatchObject({ candidates: 0, purged: 0 });
    expect(register.objects).toHaveLength(1);
    expectNoSentinel(current.logs.text);
  });

  it('EVM-139 AC5 a survey that fails does not stop the others: the rest is purged, the failed one is untouched, the job ends as a failure with ONE alert, the next run takes the one left', async () => {
    const { current, register } = await start('enforce');
    const first = await survey(current, { deadline: inDays(current, -9) });
    const second = await survey(current, { deadline: inDays(current, -8) });
    const third = await survey(current, { deadline: inDays(current, -7) });
    let calls = 0;
    register.onRecord = () => {
      calls += 1;
      return calls === 1 ? Promise.reject(new DeletionRegisterUnavailable('write_failed')) : Promise.resolve();
    };
    const before = await rowOf(current, first.id);

    await expect(job(current).run()).rejects.toMatchObject({ code: SITE_SURVEY_PURGE_FAILED });

    expect(await rowOf(current, first.id)).toEqual(before);
    expect((await rowOf(current, second.id))?.purged_at).not.toBeNull();
    expect((await rowOf(current, third.id))?.purged_at).not.toBeNull();
    const alerts = await one<{ n: string }>(
      current,
      sql`select count(*)::text as n from platform.security_alert_outbox where alert_code = 'site_survey_purge_failed'`,
    );
    expect(alerts?.n).toBe('1');
    expect(metric(current, 'site_survey_purge_failures_total')).toBe(1);
    expect(await job(current).run()).toMatchObject({ purged: 1, failed: 0 });
  });

  it('EVM-139 AC5 one run erases at most the limit of surveys; the rest waits for the next run', async () => {
    const { current } = await start('enforce');
    for (let index = 0; index < SITE_SURVEY_PURGE_LIMIT_PER_RUN + 1; index += 1) await survey(current, { deadline: inDays(current, -9) });
    expect(await job(current).run()).toMatchObject({
      candidates: SITE_SURVEY_PURGE_LIMIT_PER_RUN + 1,
      taken: SITE_SURVEY_PURGE_LIMIT_PER_RUN,
      purged: SITE_SURVEY_PURGE_LIMIT_PER_RUN,
    });
    expect(await job(current).run()).toMatchObject({ candidates: 1, purged: 1 });
    expect(await job(current).run()).toMatchObject({ candidates: 0, purged: 0 });
  }, 120_000);
});

describe('EVM-139 AC6: nobody can erase a survey by hand, and the application role cannot delete rows', () => {
  it('EVM-139 AC6 there is no operation that erases a survey on request: no route, whoever asks; the application role has no DELETE on the tables of the purge', async () => {
    const { current } = await start('report');
    const order = await survey(current, { deadline: inDays(current, 30) });
    const admin = await signInTo(current, 'administrator', { fresh: true });
    const editor = await signInTo(current, 'editor');
    for (const browser of [admin, editor]) {
      for (const path of [
        `/api/v1/work-orders/${order.id}/purge`,
        `/api/v1/site-surveys/${order.id}/purge`,
        `/api/v1/site-surveys/${order.id}`,
      ]) {
        expect([404, 405], path).toContain((await browser.panel.delete(path)).status);
        expect([404, 405], path).toContain((await browser.panel.post(path, {})).status);
      }
    }
    expect((await rowOf(current, order.id))?.purged_at).toBeNull();
    for (const table of [
      'work_orders.work_orders',
      'sites.sites',
      'media.media_assets',
      'media.stored_files',
      'timeline.timeline_entries',
    ]) {
      const privilege = await one<{ allowed: boolean }>(
        current,
        sql`select has_table_privilege('evia_app', ${table}, 'DELETE') as allowed`,
      );
      expect(privilege?.allowed, table).toBe(false);
    }
  });
});
