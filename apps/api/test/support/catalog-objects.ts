import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { ObjectPaths } from '../authorization/role-matrix.ts';
import type { IdentityApp } from './identity-app.ts';

const TEMPLATE_PATH = '/api/v1/catalog/work-order-templates';

/**
 * The IDOR fixture of the catalogue operation that addresses an object (EVM-019 AC7; SR-AUTHZ-05, CWE-639): "own" is the
 * id of a template of the starting data — a RETIRED one, because the by-id read must serve it too (AC5) — and "foreign"
 * is a random UUID that names nothing (404 `not_found`: the configuration is global, so nothing is "somebody else's",
 * but a made-up object must not be told apart from a missing one). The retirement is done by the migration role: the
 * application role cannot change the configuration (AC6).
 */
export async function catalogObjects(app: IdentityApp): Promise<Record<string, ObjectPaths>> {
  const retired = await sql<{ id: string }>`
    update catalog.work_order_templates set is_active = false where code = 'garage_charger_installation' returning id`.execute(
    app.database.admin,
  );
  const id = retired.rows[0]?.id;
  if (id === undefined) throw new Error('the starting data has no template garage_charger_installation');
  return {
    getWorkOrderTemplate: {
      own: () => `${TEMPLATE_PATH}/${id}`,
      foreign: () => `${TEMPLATE_PATH}/${randomUUID()}`,
    },
  };
}
