/**
 * Synthetic work orders written straight into the database (EVM-017) — and the generator of 10 000 of them for the performance
 * test of AC4. A TEST helper: it lives outside `src`, so it is not in the production image and no route reaches it; it refuses
 * to run when `NODE_ENV=production` (SR-INFRA-08). Everything is synthetic and deterministic: titles are made of a fixed word list
 * and a counter, people are the fixture users of the identity tests, numbers follow `ZL-YYYY-NNNN`.
 */
import type { Kysely } from 'kysely';
import type { WorkOrderStatus } from '../../src/modules/work-orders/domain/work-order-list-query.ts';
import { workOrderTables } from '../../src/modules/work-orders/infrastructure/tables.ts';
import type { Database } from '../../src/platform/database/database.ts';

export const ALL_STATUSES: readonly WorkOrderStatus[] = [
  'new',
  'quoting',
  'accepted',
  'in_progress',
  'completed',
  'settled',
  'on_hold',
  'cancelled',
];

export interface WorkOrderSpec {
  readonly number: string;
  readonly title?: string;
  readonly status?: WorkOrderStatus;
  readonly createdAt?: Date;
  readonly deletedAt?: Date;
  /** the active coordinator (a user id) */
  readonly coordinatorId?: string;
  /** a coordinator assignment that was ended (soft deleted) — the order has no active coordinator through it */
  readonly formerCoordinatorId?: string;
}

/** The generator never runs against production data (SR-INFRA-08). */
export function assertSyntheticDataAllowed(env: Readonly<Record<string, string | undefined>> = process.env): void {
  if (env['NODE_ENV'] === 'production') throw new Error('synthetic data generation is refused when NODE_ENV=production');
}

const BASE = Date.parse('2026-01-01T08:00:00.000Z');
const CHUNK = 1000;

/** Inserts the orders (and their assignments) and returns the identifiers by number. */
export async function insertWorkOrders(db: Kysely<Database>, specs: readonly WorkOrderSpec[]): Promise<Map<string, string>> {
  assertSyntheticDataAllowed();
  const tables = workOrderTables(db);
  const ids = new Map<string, string>();
  for (let start = 0; start < specs.length; start += CHUNK) {
    const chunk = specs.slice(start, start + CHUNK);
    const rows = await tables
      .insertInto('work_orders.work_orders')
      .values(
        chunk.map((spec, index) => {
          const createdAt = spec.createdAt ?? new Date(BASE + (start + index) * 60_000);
          return {
            number: spec.number,
            title: spec.title ?? `Zlecenie syntetyczne ${spec.number}`,
            status: spec.status ?? 'new',
            created_at: createdAt,
            created_by: null,
            updated_at: createdAt,
            updated_by: null,
            deleted_at: spec.deletedAt ?? null,
            deleted_by: null,
          };
        }),
      )
      .returning(['id', 'number'])
      .execute();
    for (const row of rows) ids.set(row.number, row.id);
    const assignments = chunk.flatMap((spec) => {
      const workOrderId = ids.get(spec.number) ?? '';
      const at = spec.createdAt ?? new Date(BASE);
      const make = (userId: string, deletedAt: Date | null) => ({
        work_order_id: workOrderId,
        user_id: userId,
        role: 'coordinator' as const,
        created_at: at,
        created_by: null,
        updated_at: at,
        updated_by: null,
        deleted_at: deletedAt,
        deleted_by: null,
      });
      return [
        ...(spec.formerCoordinatorId === undefined ? [] : [make(spec.formerCoordinatorId, at)]),
        ...(spec.coordinatorId === undefined ? [] : [make(spec.coordinatorId, null)]),
      ];
    });
    if (assignments.length > 0) await tables.insertInto('work_orders.work_order_assignments').values(assignments).execute();
  }
  return ids;
}

/** `ZL-2026-0001` … */
export const numberOf = (year: number, sequence: number): string => `ZL-${year}-${String(sequence).padStart(4, '0')}`;

/** A year holds at most 9999 orders (fixed width of the number), so a large set is spread over several years. */
const PER_YEAR = 2500;
const SUBJECTS = ['Wallbox do garażu', 'Instalacja ładowarki', 'Przyłącze mocy', 'Rozdzielnia', 'Przegląd instalacji', 'Linia zasilająca'];
const PLACES = ['dom jednorodzinny', 'garaż podziemny', 'parking wspólnoty', 'hala'];

/** Deterministic synthetic orders: statuses cycle, coordinators rotate (every 7th has none), creation times rise by a minute. */
export function syntheticSpecs(count: number, coordinators: readonly string[]): WorkOrderSpec[] {
  return Array.from({ length: count }, (_, index): WorkOrderSpec => {
    const coordinator = coordinators.length === 0 || index % 7 === 6 ? undefined : coordinators[index % coordinators.length];
    return {
      number: numberOf(2020 + Math.floor(index / PER_YEAR), (index % PER_YEAR) + 1),
      title: `${SUBJECTS[index % SUBJECTS.length]} — ${PLACES[index % PLACES.length]} #${index + 1}`,
      status: ALL_STATUSES[index % ALL_STATUSES.length] ?? 'new',
      createdAt: new Date(BASE + index * 60_000),
      ...(coordinator === undefined ? {} : { coordinatorId: coordinator }),
    };
  });
}

export async function generateWorkOrders(
  db: Kysely<Database>,
  count: number,
  coordinators: readonly string[],
): Promise<Map<string, string>> {
  return insertWorkOrders(db, syntheticSpecs(count, coordinators));
}
