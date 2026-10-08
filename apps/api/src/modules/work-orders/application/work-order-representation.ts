/**
 * The representation of a work order as the contract has it (SR-DATA-03), parsed with the schema of the contract before it leaves:
 * only the fields of the contract can leave — the customer is `{id, displayName}`, the site the address of the search item, the
 * coordinator `{id, displayName}`; never a telephone number, an e-mail address, the notes, a technical column or a person's
 * identifier of the author.
 */
import type { WorkOrder } from '@evia/contracts';
import { zWorkOrder } from '@evia/contracts/zod';
import type { CustomerSummary } from '../../customers/index.ts';
import type { SiteSummary } from '../../sites/index.ts';
import { ProblemException } from '../../../platform/http/problem.ts';
import type { ScopeItemRow, WorkOrderRow } from '../infrastructure/work-order-store.ts';

const present = <K extends string>(key: K, value: string | null): { [P in K]?: string } =>
  (value === null ? {} : { [key]: value }) as { [P in K]?: string };

export interface WorkOrderParts {
  readonly row: WorkOrderRow;
  readonly scope: readonly ScopeItemRow[];
  readonly customer: CustomerSummary;
  readonly site: SiteSummary;
  readonly coordinator: { readonly id: string; readonly displayName: string };
}

export function toWorkOrder({ row, scope, customer, site, coordinator }: WorkOrderParts): WorkOrder {
  const order = {
    id: row.id,
    number: row.number,
    title: row.title,
    status: row.status,
    customer: { id: customer.id, displayName: customer.displayName },
    site: {
      id: site.id,
      siteType: site.siteType,
      street: site.street,
      buildingNumber: site.buildingNumber,
      ...present('apartmentNumber', site.apartmentNumber),
      postalCode: site.postalCode,
      city: site.city,
      ...present('parkingSpotNumber', site.parkingSpotNumber),
      ...present('garageLevel', site.garageLevel),
    },
    coordinator: { id: coordinator.id, displayName: coordinator.displayName },
    ...present('plannedDate', row.planned_date),
    ...present('description', row.description),
    scopeItems: scope.map((item) => ({
      id: item.id,
      position: item.position,
      code: item.code,
      name: item.name,
      parameterSetCode: item.parameter_set_code,
      parameters: item.parameters,
      quantity: item.quantity,
    })),
    version: row.version,
    createdAt: row.created_at.toISOString(),
  };
  const checked = zWorkOrder.safeParse(order);
  if (!checked.success) throw new ProblemException('internal_error');
  return checked.data;
}
