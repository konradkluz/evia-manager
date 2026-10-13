import type { SiteType } from '@evia/contracts';
import { useSyncExternalStore } from 'react';

/**
 * What the person typed to narrow the list of work orders (EVM-072 AC2, AC4; SR-API-04, SR-WEB-05, AB-16): the phrase and the
 * filters of "Więcej filtrów". They live in the memory of the tab only — never in the address, `history.state`, the tab title,
 * localStorage, sessionStorage or IndexedDB. The store lets the TopBar and W-10 share one phrase without passing it through
 * the router. "Wyloguj" and a login of another person drop it (`clearWorkOrderSearch`, called with the drafts); a refresh of
 * the tab loses it by design.
 */
export interface WorkOrderSearchState {
  /** The text of the field as typed (not normalised: the field shows what the person typed). */
  readonly phrase: string;
  readonly siteType: SiteType | '';
  readonly templateId: string;
}

const EMPTY: WorkOrderSearchState = { phrase: '', siteType: '', templateId: '' };

let state: WorkOrderSearchState = EMPTY;
const listeners = new Set<() => void>();

function publish(next: WorkOrderSearchState): void {
  if (next === state) return;
  state = next;
  for (const listener of listeners) listener();
}

export const readWorkOrderSearch = (): WorkOrderSearchState => state;

export function setWorkOrderPhrase(phrase: string): void {
  if (phrase !== state.phrase) publish({ ...state, phrase });
}

export function setWorkOrderMoreFilters(filters: Pick<WorkOrderSearchState, 'siteType' | 'templateId'>): void {
  if (filters.siteType !== state.siteType || filters.templateId !== state.templateId) publish({ ...state, ...filters });
}

/** Everything typed is forgotten (logout, a login of another person, "Wyczyść filtry" clears the parts itself). */
export function clearWorkOrderSearch(): void {
  publish(EMPTY);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useWorkOrderSearch(): WorkOrderSearchState {
  return useSyncExternalStore(subscribe, readWorkOrderSearch, readWorkOrderSearch);
}
