import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  auditOf,
  canaryCustomer,
  codeOf,
  CUSTOMERS,
  NOW,
  rowOf,
  signInTo,
  startErasureApp,
  tag,
  type Browser,
  type ErasureApp,
} from '../support/customer-erasure.ts';
import { clearCustomers } from '../support/customer-fixtures.ts';
import { uuidv7 } from '../support/uuid.ts';
import { clearWorkOrderCreation } from '../support/work-order-fixtures.ts';

let app: ErasureApp;
beforeAll(async () => {
  app = await startErasureApp();
});
afterAll(async () => {
  await app.current.close();
});
beforeEach(async () => {
  app.current.clock.set(NOW);
  app.register().recover();
  app.register().calls.length = 0;
  app.register().objects.length = 0;
  await clearWorkOrderCreation(app.current.database.admin);
  await clearCustomers(app.current.database.admin);
});

const admin = () => app.current.database.admin;
const url = (id: string, suffix = '') => `${CUSTOMERS}/${id}${suffix}`;
const remove = (browser: Browser, id: string, version: number, key?: string) =>
  browser.panel.delete(url(id), { 'If-Match': tag(version), ...(key === undefined ? {} : { 'Idempotency-Key': key }) });
const restore = (browser: Browser, id: string, version: number, key?: string) =>
  browser.panel.post(url(id, '/restore'), undefined, {
    'If-Match': tag(version),
    ...(key === undefined ? {} : { 'Idempotency-Key': key }),
  });
const anonymize = (browser: Browser, id: string, version: number) =>
  browser.panel.post(url(id, '/anonymize'), undefined, { 'If-Match': tag(version) });

/** A trigger of the tests: how to install it, how to remove it. */
interface TestTrigger {
  install(): Promise<void>;
  remove(): Promise<void>;
}
const triggers = {
  /** the UPDATE of a customer is silently cancelled (the row is not touched) */
  cancelUpdate: {
    install: async () => {
      await sql`create function public.cancel_customer_update() returns trigger language plpgsql set search_path = pg_catalog as $$ begin return null; end $$`.execute(
        admin(),
      );
      await sql`create trigger cancel_customer_update before update on customers.customers for each row execute function public.cancel_customer_update()`.execute(
        admin(),
      );
    },
    remove: async () => {
      await sql`drop trigger cancel_customer_update on customers.customers`.execute(admin());
      await sql`drop function public.cancel_customer_update()`.execute(admin());
    },
  },
  /** the customer is deleted by its own UPDATE (a security definer function: the application role has no DELETE) */
  removeCustomer: {
    install: async () => {
      await sql`create function public.remove_updated_customer() returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$ begin delete from customers.customers where id = new.id; return null; end $$`.execute(
        admin(),
      );
      await sql`create trigger remove_updated_customer after update on customers.customers for each row execute function public.remove_updated_customer()`.execute(
        admin(),
      );
    },
    remove: async () => {
      await sql`drop trigger remove_updated_customer on customers.customers`.execute(admin());
      await sql`drop function public.remove_updated_customer()`.execute(admin());
    },
  },
  /** the audit record of a failed operation is refused */
  refuseFailedAudit: {
    install: async () => {
      await sql`create function public.refuse_failed_audit() returns trigger language plpgsql set search_path = pg_catalog as $$ begin if new.outcome = 'failed' then raise exception 'refused for the test'; end if; return new; end $$`.execute(
        admin(),
      );
      await sql`create trigger refuse_failed_audit before insert on audit.events for each row execute function public.refuse_failed_audit()`.execute(
        admin(),
      );
    },
    remove: async () => {
      await sql`drop trigger refuse_failed_audit on audit.events`.execute(admin());
      await sql`drop function public.refuse_failed_audit()`.execute(admin());
    },
  },
} satisfies Record<string, TestTrigger>;

/** Runs `body` with the trigger installed, and removes it afterwards. */
async function withTrigger(trigger: TestTrigger, body: () => Promise<void>): Promise<void> {
  await trigger.install();
  try {
    await body();
  } finally {
    await trigger.remove();
  }
}

describe('EVM-041 AC1 AC3 - a repeat with a NEW key is not a repeat (the state decides)', () => {
  it('EVM-041 AC1 a customer that is deleted already with a key that was never used is 404 (like a missing customer); nothing is recorded', async () => {
    const id = await canaryCustomer(app.current);
    const administrator = await signInTo(app.current, 'administrator');
    expect((await remove(administrator, id, 1, uuidv7())).status).toBe(204);
    const again = await remove(administrator, id, 2, uuidv7());
    expect([again.status, codeOf(again.body)]).toEqual([404, 'not_found']);
    expect(await auditOf(app.current, id)).toHaveLength(1);
  });

  it('EVM-041 AC3 a customer that is not deleted with a key that was never used is 404 on the restoration', async () => {
    const id = await canaryCustomer(app.current);
    const administrator = await signInTo(app.current, 'administrator');
    const response = await restore(administrator, id, 1, uuidv7());
    expect([response.status, codeOf(response.body)]).toEqual([404, 'not_found']);
    expect(await rowOf(app.current, id)).toMatchObject({ version: 1, deleted_at: null });
  });
});

describe('EVM-041 AC5 - defences that must fail closed (SR-ERR-01)', () => {
  it('EVM-041 AC5 an UPDATE that touches no row is 500 internal_error on all three operations: nothing is committed, no audit event, no idempotency record', async () => {
    const id = await canaryCustomer(app.current, { lastName: 'Zwykly' });
    const gone = await canaryCustomer(app.current, { lastName: 'Usuniety', deletedAt: NOW });
    const administrator = await signInTo(app.current, 'administrator', { fresh: true });
    await withTrigger(triggers.cancelUpdate, async () => {
      const answers = [
        await remove(administrator, id, 1, uuidv7()),
        await restore(administrator, gone, 1, uuidv7()),
        await anonymize(administrator, id, 1),
      ];
      expect(answers.map((answer) => [answer.status, codeOf(answer.body)])).toEqual([
        [500, 'internal_error'],
        [500, 'internal_error'],
        [500, 'internal_error'],
      ]);
    });
    expect(await rowOf(app.current, id)).toMatchObject({ version: 1, deleted_at: null, anonymized_at: null });
    expect(await rowOf(app.current, gone)).toMatchObject({ version: 1 });
    expect(await auditOf(app.current, id)).toEqual([]);
    const records = await sql<{ n: string }>`select count(*)::text as n from platform.idempotency_records`.execute(admin());
    expect(records.rows[0]?.n).toBe('0');
  });

  it('EVM-041 AC5 a customer that disappears between the restoration and its answer is 500 internal_error and the restoration is rolled back', async () => {
    const gone = await canaryCustomer(app.current, { lastName: 'Usuniety', deletedAt: NOW });
    const administrator = await signInTo(app.current, 'administrator');
    await withTrigger(triggers.removeCustomer, async () => {
      const response = await restore(administrator, gone, 1);
      expect([response.status, codeOf(response.body)]).toEqual([500, 'internal_error']);
    });
    expect(await rowOf(app.current, gone)).toMatchObject({ version: 1 });
    expect((await rowOf(app.current, gone))?.deleted_at).not.toBeNull();
  });

  it('EVM-041 AC5 when even the audit record of a refused anonymization cannot be written the answer is still 503 and the failure is logged without any value', async () => {
    const id = await canaryCustomer(app.current);
    const administrator = await signInTo(app.current, 'administrator', { fresh: true });
    app.register().failAll();
    await withTrigger(triggers.refuseFailedAudit, async () => {
      const response = await anonymize(administrator, id, 1);
      expect([response.status, codeOf(response.body)]).toEqual([503, 'deletion_register_unavailable']);
    });
    expect(app.current.logs.text).toContain('audit of a refused anonymization was not written');
    expect(app.current.logs.text).not.toContain('Kanarkowski');
    expect(await rowOf(app.current, id)).toMatchObject({ version: 1, anonymized_at: null });
    expect(await auditOf(app.current, id)).toEqual([]);
  });
});
