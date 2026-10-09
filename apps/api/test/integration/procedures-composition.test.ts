import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WorkOrderCompositionRegistry, type WorkOrderCompositionContributor } from '../../src/modules/work-orders/index.ts';
import { PANEL_ORIGIN } from '../support/app.ts';
import { insertCustomer } from '../support/customer-fixtures.ts';
import { createIdentityApp, ISSUED_AT, type IdentityApp } from '../support/identity-app.ts';
import { createSession, createUser, type Role } from '../support/identity-fixtures.ts';
import { PanelClient } from '../support/panel-client.ts';
import { insertSite } from '../support/site-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { clearWorkOrderCreation } from '../support/work-order-fixtures.ts';

let current: IdentityApp;
beforeAll(async () => {
  current = await createIdentityApp();
});
afterAll(async () => {
  await current.close();
});
beforeEach(async () => {
  current.clock.set(ISSUED_AT);
  await clearWorkOrderCreation(current.database.admin);
});

const admin = () => current.database.admin;
const CREATE = '/api/v1/work-orders';

async function signIn(role: Role = 'editor') {
  const user = await createUser(admin(), current.clock, { role });
  const session = await createSession(admin(), current.clock, user, { channel: 'web' });
  const panel = new PanelClient(current.app.getHttpServer(), PANEL_ORIGIN);
  panel.cookie = session.cookie;
  panel.csrfToken = session.csrfToken;
  return { userId: user.id, panel };
}

const templateId = async (code: string): Promise<string> =>
  (await sql<{ id: string }>`select id from catalog.work_order_templates where code = ${code}`.execute(admin())).rows[0]?.id ?? '';
async function newOrder(templateCode: string | null, key: string = uuidv7()) {
  const customerId = await insertCustomer(admin(), { email: 'jan@example.invalid' });
  const siteId = await insertSite(admin());
  const browser = await signIn();
  const body = {
    id: uuidv7(),
    customerId,
    siteId,
    templateId: templateCode === null ? null : await templateId(templateCode),
  };
  const response = await browser.panel.post(CREATE, body).set('Idempotency-Key', key);
  return { browser, body, response, key };
}
const COUNTS = {
  procedures: () => sql<{ n: string }>`select count(*)::text as n from procedures.procedures`,
  procedure_stages: () => sql<{ n: string }>`select count(*)::text as n from procedures.procedure_stages`,
};
const count = async (table: keyof typeof COUNTS): Promise<number> => Number((await COUNTS[table]().execute(admin())).rows[0]?.n);

interface ProcessRow {
  code: string;
  name: string;
  position: number;
  source_procedure_template_id: string;
  source_scope_item_id: string | null;
  stages: Array<{ code: string; name: string; position: number; status: string; source_stage_template_id: string; version: number }>;
}
async function processesOf(workOrderId: string): Promise<ProcessRow[]> {
  const { rows } = await sql<ProcessRow>`
    select p.code, p.name, p.position, p.source_procedure_template_id, p.source_scope_item_id,
      (select json_agg(json_build_object('code', s.code, 'name', s.name, 'position', s.position, 'status', s.status,
          'source_stage_template_id', s.source_stage_template_id, 'version', s.version) order by s.position)
       from procedures.procedure_stages s where s.procedure_id = p.id) as stages
    from procedures.procedures p where p.work_order_id = ${workOrderId} order by p.position`.execute(admin());
  return rows;
}
/** What the template brings, as the preview of the card counts it: each process once, in the order of its first appearance. */
async function broughtBy(templateCode: string): Promise<Array<{ code: string; name: string; stages: number; itemCode: string }>> {
  const { rows } = await sql<{ code: string; name: string; stages: string; item_code: string }>`
    select procedure.code, procedure.name, service.code as item_code,
      (select count(*)::text from catalog.procedure_stage_templates stage
        where stage.procedure_template_id = procedure.id and stage.deleted_at is null) as stages
    from catalog.work_order_templates template
    join catalog.work_order_template_items item on item.work_order_template_id = template.id and item.deleted_at is null
    join catalog.service_catalog_items service on service.id = item.catalog_item_id and service.deleted_at is null
    join catalog.service_catalog_item_procedures link on link.catalog_item_id = item.catalog_item_id and link.deleted_at is null
    join catalog.procedure_templates procedure on procedure.id = link.procedure_template_id and procedure.deleted_at is null
    where template.code = ${templateCode}
    order by item.position, link.position`.execute(admin());
  const first = new Map(rows.map((row) => [row.code, row] as const).reverse());
  return rows
    .filter((row) => first.get(row.code) === row)
    .map((row) => ({ code: row.code, name: row.name, stages: Number(row.stages), itemCode: row.item_code }));
}

describe('the processes of a new order (EVM-031 AC1; domain-model → "Kompozycja zlecenia z szablonu")', () => {
  it('EVM-031 AC1 the template "Garaż — pełny proces" gives 9 processes in the order of the template, each with the stages of its process template, every stage "todo"', async () => {
    const { response, body } = await newOrder('garage_full_process');
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const expected = await broughtBy('garage_full_process');
    expect(expected).toHaveLength(9);

    const processes = await processesOf(body.id);
    expect(processes).toHaveLength(9);
    expect(processes.map((process) => [process.position, process.code, process.name])).toEqual(
      expected.map((process, index) => [index + 1, process.code, process.name]),
    );
    expect(processes.map((process) => process.stages.length)).toEqual(expected.map((process) => process.stages));
    for (const process of processes) {
      expect(process.stages.map((stage) => stage.position)).toEqual(process.stages.map((_, index) => index + 1));
      expect(process.stages.every((stage) => stage.status === 'todo' && stage.version === 1)).toBe(true);
    }
    expect(await count('procedure_stages')).toBe(expected.reduce((total, process) => total + process.stages, 0));
  });

  it('EVM-031 AC1 every process is a COPY with its sources: the process template, the stage templates and the scope item of the order that brought it', async () => {
    const { body } = await newOrder('garage_full_process');
    const { rows } = await sql<{ id: string; code: string; name: string; source_catalog_item_id: string | null }>`
      select id, code, name, source_catalog_item_id from work_orders.scope_items where work_order_id = ${body.id}`.execute(admin());
    const scopeByCode = new Map(rows.map((row) => [row.code, row.id]));
    const expected = await broughtBy('garage_full_process');
    const processes = await processesOf(body.id);
    for (const [index, process] of processes.entries()) {
      const { rows: template } = await sql<{ id: string; code: string; name: string }>`
        select id, code, name from catalog.procedure_templates where id = ${process.source_procedure_template_id}`.execute(admin());
      expect(template[0]).toMatchObject({ code: process.code, name: process.name });
      expect(process.source_scope_item_id, process.code).toBe(scopeByCode.get(expected[index]?.itemCode ?? '') ?? null);
      expect(process.source_scope_item_id).not.toBeNull();
      const { rows: stages } = await sql<{ code: string; name: string }>`
        select code, name from catalog.procedure_stage_templates
        where procedure_template_id = ${process.source_procedure_template_id} and deleted_at is null order by position`.execute(admin());
      expect(process.stages.map((stage) => [stage.code, stage.name])).toEqual(stages.map((stage) => [stage.code, stage.name]));
      for (const stage of process.stages) expect(stage.source_stage_template_id).toBeTruthy();
    }
  });

  it('EVM-031 AC1 a process that two items bring is made ONCE, with the first item that brings it: one active process per code', async () => {
    const { rows: shared } = await sql<{ procedure_template_id: string; first_item: string; second_item: string }>`
      select link.procedure_template_id, (array_agg(link.catalog_item_id order by link.catalog_item_id))[1] as first_item,
             (array_agg(link.catalog_item_id order by link.catalog_item_id))[2] as second_item
      from catalog.service_catalog_item_procedures link where link.deleted_at is null
      group by link.procedure_template_id having count(distinct link.catalog_item_id) >= 2 limit 1`.execute(admin());
    const pair = shared[0];
    if (pair === undefined) throw new Error('the seed has no process brought by two items');
    const at = '2026-10-09T08:00:00Z';
    const { rows: created } = await sql<{ id: string }>`
      insert into catalog.work_order_templates (code, name, is_active, position, created_at, updated_at)
      values ('test_shared_process', 'Szablon z procesem wspólnym', true, 99, ${at}, ${at}) returning id`.execute(admin());
    const templateRow = created[0]?.id ?? '';
    for (const [position, itemId] of [pair.second_item, pair.first_item].entries()) {
      await sql`
        insert into catalog.work_order_template_items (work_order_template_id, catalog_item_id, position, created_at, updated_at)
        values (${templateRow}, ${itemId}, ${position + 1}, ${at}, ${at})`.execute(admin());
    }
    try {
      const customerId = await insertCustomer(admin(), { email: 'jan@example.invalid' });
      const browser = await signIn();
      const body = { id: uuidv7(), customerId, siteId: await insertSite(admin()), templateId: templateRow };
      const response = await browser.panel.post(CREATE, body).set('Idempotency-Key', uuidv7());
      expect(response.status, JSON.stringify(response.body)).toBe(201);

      const processes = await processesOf(body.id);
      const codes = processes.map((process) => process.code);
      expect(new Set(codes).size).toBe(codes.length);
      const shared = processes.filter((process) => process.source_procedure_template_id === pair.procedure_template_id);
      expect(shared).toHaveLength(1);
      const { rows: scope } = await sql<{ id: string; source_catalog_item_id: string }>`
        select id, source_catalog_item_id from work_orders.scope_items where work_order_id = ${body.id}`.execute(admin());
      expect(scope).toHaveLength(2);
      // the item of position 1 is pair.second_item: it is the first to bring the process, so the process points at ITS scope item
      expect(shared[0]?.source_scope_item_id).toBe(scope.find((item) => item.source_catalog_item_id === pair.second_item)?.id);
    } finally {
      await clearWorkOrderCreation(admin());
      await sql`delete from catalog.work_order_template_items where work_order_template_id = ${templateRow}`.execute(admin());
      await sql`delete from catalog.work_order_templates where id = ${templateRow}`.execute(admin());
    }
  });

  it('EVM-031 AC1 an order without a template has no processes (and the order is made)', async () => {
    const { response, body } = await newOrder(null);
    expect(response.status).toBe(201);
    expect(await processesOf(body.id)).toEqual([]);
    expect(await count('procedures')).toBe(0);
  });

  it('EVM-031 AC1 a repeat of the creation (same key and id) does not make the processes twice', async () => {
    const { browser, body, key } = await newOrder('garage_full_process');
    const before = await count('procedure_stages');
    const repeat = await browser.panel.post(CREATE, body).set('Idempotency-Key', key);
    expect(repeat.status).toBe(201);
    expect(repeat.headers['idempotent-replayed']).toBe('true');
    expect(await count('procedures')).toBe(9);
    expect(await count('procedure_stages')).toBe(before);
  });

  it('EVM-031 AC1 two orders from one template have their own, independent processes (a copy, not a reference)', async () => {
    const first = await newOrder('garage_full_process');
    const second = await newOrder('garage_full_process');
    expect(first.response.status).toBe(201);
    expect(second.response.status).toBe(201);
    expect(await count('procedures')).toBe(18);
    const ids = await sql<{ id: string }>`select id from procedures.procedures`.execute(admin());
    expect(new Set(ids.rows.map((row) => row.id)).size).toBe(18);
  });
});

describe('one transaction with the order (EVM-031 AC1; SR-API-06, SR-ERR-01 — fail closed)', () => {
  let failing = false;
  const contributor: WorkOrderCompositionContributor = {
    name: 'zz-after-procedures',
    order: 200,
    contribute: async (tx) => {
      await sql`select 1`.execute(tx);
      if (failing) throw new Error('contributor failed');
    },
  };
  beforeAll(() => {
    current.app.get(WorkOrderCompositionRegistry).register(contributor);
  });
  beforeEach(() => {
    failing = false;
  });

  it('EVM-031 AC1 a contributor that fails AFTER the processes were written: 500, and there is no order, no process, no stage, no audit event, no idempotency record', async () => {
    failing = true;
    const { response, body } = await newOrder('garage_full_process');
    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({ code: 'internal_error' });
    expect(JSON.stringify(response.body)).not.toMatch(/contributor failed/);
    expect(await count('procedures')).toBe(0);
    expect(await count('procedure_stages')).toBe(0);
    const counts = await sql<{ orders: string; events: string; records: string }>`
      select (select count(*) from work_orders.work_orders)::text as orders,
             (select count(*) from audit.events where object_id = ${body.id})::text as events,
             (select count(*) from platform.idempotency_records)::text as records`.execute(admin());
    expect(counts.rows[0]).toEqual({ orders: '0', events: '0', records: '0' });
  });

  it('EVM-031 AC1 the same request made again once the failure is gone creates the order with its 9 processes', async () => {
    failing = true;
    const failed = await newOrder('garage_full_process');
    expect(failed.response.status).toBe(500);
    failing = false;
    const retried = await failed.browser.panel.post(CREATE, failed.body).set('Idempotency-Key', failed.key);
    expect(retried.status, JSON.stringify(retried.body)).toBe(201);
    expect(await count('procedures')).toBe(9);
  });
});
