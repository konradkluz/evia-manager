import type { CreateWorkOrderRequest, FieldError, WorkOrderTemplate } from '@evia/contracts';
import type { PickedCustomer } from '../customers/customer-picker.tsx';
import type { LocationState } from '../sites/location-section.tsx';

/** The choice of the section "3. Szablon" that means "no template": the radio "Puste zlecenie (bez szablonu)". */
export const EMPTY_CHOICE = 'empty';

/** What a person types and chooses in the sections "3. Szablon" and "4. Zlecenie" (text and identifiers only). */
export interface OrderDetails {
  /** `''` — nothing chosen yet, {@link EMPTY_CHOICE}, or the identifier of a template. */
  readonly choice: string;
  /** "Pokaż wszystkie" took the filter by the type of the object off. */
  readonly showAll: boolean;
  readonly title: string;
  /** The title stays the default (the name of the template) until a person types in the field. */
  readonly titleEdited: boolean;
  /** `''` — the person who is logged in (the default); otherwise the chosen user. */
  readonly assigneeId: string;
  readonly plannedDate: string;
  readonly description: string;
}

export const EMPTY_DETAILS: OrderDetails = {
  choice: '',
  showAll: false,
  title: '',
  titleEdited: false,
  assigneeId: '',
  plannedDate: '',
  description: '',
};

/** Has the person done anything in these sections (a draft is worth keeping, "Anuluj" asks before dropping it). */
export const detailsStarted = (details: OrderDetails): boolean =>
  details.choice !== '' ||
  details.titleEdited ||
  details.assigneeId !== '' ||
  details.plannedDate !== '' ||
  details.description.trim() !== '';

/** Fields that can carry an error; the order is the order on the page (the first one gets the focus). */
export const ORDER_FIELDS = ['customer', 'site', 'template', 'title', 'assignee', 'plannedDate', 'description'] as const;
export type OrderField = (typeof ORDER_FIELDS)[number];
export type OrderFieldErrors = Partial<Record<OrderField, string>>;

/** The fields the panel can see are missing before anything is sent (the API checks all again, SR-INPUT-01). */
export function missingFields(customer: PickedCustomer | null, location: LocationState, details: OrderDetails): OrderField[] {
  const missing: OrderField[] = [];
  if (customer === null) missing.push('customer');
  if (location.site === null) missing.push('site');
  if (details.choice === '') missing.push('template');
  return missing;
}

/** The default title shown in the field: the name of the chosen template (the API names an empty order "Nowe zlecenie"). */
export const defaultTitle = (template: WorkOrderTemplate | undefined): string => template?.name ?? '';

/**
 * The body of `createWorkOrder`: the identifiers and what was filled in. A title left at the default is absent (the server
 * names the order after the template); an empty optional field is absent, never an empty text. The number and the status are
 * the server's — they are never sent (SR-AUTHZ-04); the assignee is absent unless a person chose one (the server uses the session).
 */
export function buildOrderBody(id: string, customer: PickedCustomer, siteId: string, details: OrderDetails): CreateWorkOrderRequest {
  const title = details.titleEdited ? details.title.trim() : '';
  const description = details.description.trim();
  return {
    id,
    customerId: customer.id,
    siteId,
    templateId: details.choice === EMPTY_CHOICE ? null : details.choice,
    ...(title === '' ? {} : { title }),
    ...(details.assigneeId === '' ? {} : { assigneeUserId: details.assigneeId }),
    ...(details.plannedDate === '' ? {} : { plannedDate: details.plannedDate }),
    ...(description === '' ? {} : { description }),
  };
}

/** The same content (everything but the identifier) is the same request: a retry of it keeps the `id` and the key. */
export const orderFingerprint = (body: CreateWorkOrderRequest): string => JSON.stringify({ ...body, id: undefined });

const POINTERS: Readonly<Record<string, OrderField>> = {
  '/customerId': 'customer',
  '/siteId': 'site',
  '/templateId': 'template',
  '/title': 'title',
  '/assigneeUserId': 'assignee',
  '/plannedDate': 'plannedDate',
  '/description': 'description',
};

/** The field an error of the server points at (`undefined` for a pointer the form has no field for). */
export const orderFieldOf = (error: FieldError): OrderField | undefined => POINTERS[error.pointer];

/** The singular, few and many forms of a Polish count word (`1 pozycja`, `2 pozycje`, `5 pozycji`). */
export const pluralForm = (count: number): 'one' | 'few' | 'many' => {
  const category = new Intl.PluralRules('pl').select(count);
  return category === 'one' || category === 'few' ? category : 'many';
};

/** The range of the planned date that the API accepts (`out_of_range` otherwise). */
export const PLANNED_DATE_MIN = '2000-01-01';
export const PLANNED_DATE_MAX = '2100-12-31';
