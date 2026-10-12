import type { PartyKind, ProcedureStageTemplate, SiteCard, WaitingOn } from '@evia/contracts';

/**
 * What the dialog "Na kogo czekamy?" knows about the manager of the location (EVM-033): the card carries `{id, displayName}` only,
 * so the kind comes from one read of the party. `pending` and `gone` (404: deleted in the meantime, AC5) hide the suggestion;
 * `unknown` (the read failed) keeps it by the name alone.
 */
export type ManagerKind = PartyKind | 'pending' | 'gone' | 'unknown';

/** A party suggested from the location: the name and, when known, the kind — nothing else (SR-DATA-03). */
export interface HintParty {
  readonly id: string;
  readonly displayName: string;
  readonly kind?: PartyKind;
}

export interface WaitingHints {
  /** The OSD first, then the manager (AC1); empty for a location without them (AC4). */
  readonly suggestions: readonly HintParty[];
  /** The default of the stage template — a hint of the screen, not an automation (AC2). */
  readonly waitingOn: WaitingOn | null;
  readonly partyKind: PartyKind | null;
  /** The suggestion of the default kind, `null` when there is none. Only an id of the card can be here (SR-INPUT-02). */
  readonly party: HintParty | null;
}

/** Pure: puts together the suggestions and the defaults of one stage from the card of the location and the template. */
export function buildWaitingHints(
  card: SiteCard | undefined,
  managerKind: ManagerKind,
  template: ProcedureStageTemplate | undefined,
): WaitingHints {
  const suggestions: HintParty[] = [];
  if (card?.distributionSystemOperator != null) {
    suggestions.push({ ...card.distributionSystemOperator, kind: 'distribution_system_operator' });
  }
  if (card?.manager != null && managerKind !== 'pending' && managerKind !== 'gone') {
    suggestions.push(managerKind === 'unknown' ? { ...card.manager } : { ...card.manager, kind: managerKind });
  }
  const waitingOn = template?.defaultWaitingOn ?? null;
  const partyKind = waitingOn === 'party' ? (template?.defaultWaitingOnPartyKind ?? null) : null;
  const party = partyKind === null ? null : (suggestions.find((candidate) => candidate.kind === partyKind) ?? null);
  return { suggestions, waitingOn, partyKind, party };
}
