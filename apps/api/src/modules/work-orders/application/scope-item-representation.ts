/**
 * The representation of a scope item as the contract has it (EVM-018, EVM-035; SR-DATA-03): the keys of the contract and nothing
 * else — no author, no `source_catalog_item_id`, no column of the model that the contract does not name. The notes are omitted when
 * the item has none. Parsed with the schema of the contract before it leaves (a mismatch is a defect of the server, `500`).
 */
import type { ScopeItem } from '@evia/contracts';
import { zScopeItem } from '@evia/contracts/zod';
import { ProblemException } from '../../../platform/http/problem.ts';
import type { ScopeItemRow } from '../infrastructure/work-order-store.ts';

/** The plain object of the item — the part a representation of an order embeds before the order itself is parsed. */
export const scopeItemView = (item: ScopeItemRow) => ({
  id: item.id,
  position: item.position,
  code: item.code,
  name: item.name,
  parameterSetCode: item.parameter_set_code,
  parameters: item.parameters,
  quantity: item.quantity,
  ...(item.notes === null ? {} : { notes: item.notes }),
  version: item.version,
});

export function toScopeItem(item: ScopeItemRow): ScopeItem {
  const checked = zScopeItem.safeParse(scopeItemView(item));
  if (!checked.success) throw new ProblemException('internal_error');
  return checked.data;
}
