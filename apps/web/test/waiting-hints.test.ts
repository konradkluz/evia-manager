import type { ProcedureStageTemplate, SiteCard } from '@evia/contracts';
import { describe, expect, it } from 'vitest';
import { buildWaitingHints } from '../src/work-orders/waiting-hints.ts';
import { SITE } from './work-order-api.ts';

const OSD = { id: '01968f3e-0000-7000-8000-00000000c001', displayName: 'Stoen Operator' };
const MANAGER = { id: '01968f3e-0000-7000-8000-00000000c002', displayName: 'Wspólnota Mieszkaniowa „Zielony Dziedziniec”' };
const card = (extra: Partial<SiteCard> = {}): SiteCard => ({
  ...SITE,
  distributionSystemOperator: OSD,
  manager: MANAGER,
  ...extra,
});
const template = (extra: Partial<ProcedureStageTemplate> = {}): ProcedureStageTemplate => ({
  code: 'connection_conditions',
  name: 'Warunki przyłączenia i projekt umowy',
  position: 1,
  defaultWaitingOn: 'party',
  defaultWaitingOnPartyKind: 'distribution_system_operator',
  outputDocumentKindCodes: [],
  ...extra,
});

describe('waiting hints from the card of the location (EVM-033)', () => {
  it('EVM-033 AC1 the OSD comes first and the manager second, both with the kind', () => {
    const hints = buildWaitingHints(card(), 'housing_community', undefined);
    expect(hints.suggestions).toEqual([
      { ...OSD, kind: 'distribution_system_operator' },
      { ...MANAGER, kind: 'housing_community' },
    ]);
  });

  it('EVM-033 AC1 a manager whose kind is not known yet is not suggested (no flicker of a line without a kind)', () => {
    expect(buildWaitingHints(card(), 'pending', undefined).suggestions.map((party) => party.id)).toEqual([OSD.id]);
  });

  it('EVM-033 AC1 a manager whose kind could not be read is suggested by the name alone', () => {
    const hints = buildWaitingHints(card(), 'unknown', undefined);
    expect(hints.suggestions[1]).toEqual(MANAGER);
  });

  it('EVM-033 AC2 the default kind of the stage picks the OSD of the location', () => {
    const hints = buildWaitingHints(card(), 'housing_community', template());
    expect(hints.waitingOn).toBe('party');
    expect(hints.partyKind).toBe('distribution_system_operator');
    expect(hints.party?.id).toBe(OSD.id);
  });

  it('EVM-033 AC2 the default kind of a manager picks the manager', () => {
    const hints = buildWaitingHints(card(), 'housing_community', template({ defaultWaitingOnPartyKind: 'housing_community' }));
    expect(hints.party?.id).toBe(MANAGER.id);
  });

  it('EVM-033 AC2 no suggestion of the default kind: "Stronę" is the default and no party is chosen', () => {
    const hints = buildWaitingHints(card(), 'property_manager', template({ defaultWaitingOnPartyKind: 'designer' }));
    expect(hints.waitingOn).toBe('party');
    expect(hints.partyKind).toBe('designer');
    expect(hints.party).toBeNull();
  });

  it('EVM-033 AC2 a stage that waits for the customer by default; a stage without a default has none', () => {
    expect(
      buildWaitingHints(card(), 'housing_community', template({ defaultWaitingOn: 'customer', defaultWaitingOnPartyKind: null })),
    ).toMatchObject({
      waitingOn: 'customer',
      party: null,
      partyKind: null,
    });
    expect(
      buildWaitingHints(card(), 'housing_community', template({ defaultWaitingOn: null, defaultWaitingOnPartyKind: null })),
    ).toMatchObject({
      waitingOn: null,
      party: null,
    });
    expect(buildWaitingHints(card(), 'housing_community', undefined)).toMatchObject({ waitingOn: null, partyKind: null });
  });

  it('EVM-033 AC4 a location without the OSD and the manager has no suggestions; so has a card that is not read yet', () => {
    expect(buildWaitingHints(card({ distributionSystemOperator: null, manager: null }), 'gone', template()).suggestions).toEqual([]);
    expect(buildWaitingHints(undefined, 'pending', template()).suggestions).toEqual([]);
  });

  it('EVM-033 AC5 a party that was deleted (null on the card, 404 of the manager) is not suggested and not chosen', () => {
    const hints = buildWaitingHints(card({ distributionSystemOperator: null }), 'gone', template());
    expect(hints.suggestions).toEqual([]);
    expect(hints.party).toBeNull();
  });
});
