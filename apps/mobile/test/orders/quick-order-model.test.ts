import { createUuidV7 } from '@evia/sync-core';
import {
  buildQuickOrderInput,
  cleanLine,
  cleanNote,
  customerName,
  draftSiteType,
  EMPTY_DRAFT,
  EMPTY_QUICK_SOURCE,
  findSimilarCustomers,
  hasInput,
  initialDraft,
  nameKey,
  phoneKey,
  templatesFor,
  validateQuickOrder,
  type QuickOrderDraft,
  type QuickOrderSource,
} from '../../src/orders/quick-order-model';
import type { PhoneTemplate } from '../../src/orders/templates';

const must = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('expected');
  return value;
};

// EVM-106 AC2, AC3 (security K6, K8, K9): the pure model of the quick order form. Synthetic data only.
const T1 = '0194c2a0-0000-7000-8000-000000000a01';
const T2 = '0194c2a0-0000-7000-8000-000000000a02';
const T3 = '0194c2a0-0000-7000-8000-000000000a03';
const templates: PhoneTemplate[] = [
  {
    id: T1,
    code: 'wallbox_house',
    name: 'Wallbox w domu',
    siteTypeHint: 'single_family_house',
    itemCount: 3,
    procedureCount: 1,
    milestoneCount: 2,
  },
  {
    id: T2,
    code: 'garage_charger',
    name: 'Ładowarka w garażu',
    siteTypeHint: 'multi_family_garage',
    itemCount: 2,
    procedureCount: 0,
    milestoneCount: 0,
  },
  { id: T3, code: 'any_site', name: 'Dowolny obiekt', siteTypeHint: null, itemCount: 1, procedureCount: 0, milestoneCount: 0 },
];
const source: QuickOrderSource = {
  customers: [
    { id: 'c1', kind: 'person', displayName: 'Łukasz Żółć', phone: '+48 600 000 001' },
    { id: 'c2', kind: 'company', displayName: 'Wspólnota Testowa', phone: '22 000 00 02' },
  ],
  sites: [
    {
      id: 's1',
      siteType: 'multi_family_garage',
      street: 'ul. Testowa',
      buildingNumber: '1',
      apartmentNumber: '',
      postalCode: '00-001',
      city: 'Warszawa',
      parkingSpotNumber: '15',
    },
  ],
};
const valid = (patch: Partial<QuickOrderDraft> = {}): QuickOrderDraft => ({
  ...EMPTY_DRAFT,
  kind: 'person',
  firstName: 'Anna',
  lastName: 'Nowak',
  phone: '600 000 009',
  siteType: 'multi_family_garage',
  street: 'ul. Fikcyjna',
  buildingNumber: '7',
  apartmentNumber: '',
  postalCode: '00-950',
  city: 'Warszawa',
  parkingSpotNumber: '12',
  templateId: T2,
  title: 'Ładowarka w garażu',
  note: 'Klucz u portiera.',
  ...patch,
});
const fields = (draft: QuickOrderDraft, src = source) => validateQuickOrder(draft, src, templates).map((e) => `${e.field}:${e.problem}`);

describe('quick order model: the command (EVM-106 AC2)', () => {
  const ids = createUuidV7({ now: () => 1_000 }, { getRandomValues: (b) => b.fill(7) });

  it('EVM-106 AC2: a new customer and a new place give a CreateQuickWorkOrder with new UUIDv7 ids and the garage spot', () => {
    const built = buildQuickOrderInput(valid(), source, templates, ids);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const p = built.input.payload as Record<string, Record<string, unknown> & string>;
    expect(built.input.type).toBe('CreateQuickWorkOrder');
    expect(built.input.commandVersion).toBe(1);
    expect(p['workOrderId']).toBe(built.workOrderId);
    expect(p['templateId']).toBe(T2);
    expect(p['title']).toBe('Ładowarka w garażu');
    expect(p['note']).toBe('Klucz u portiera.');
    expect(p['customerId']).toBeUndefined();
    expect(p['siteId']).toBeUndefined();
    expect(p['newCustomer']).toMatchObject({ kind: 'person', displayName: 'Anna Nowak', phone: '600 000 009' });
    expect(p['newSite']).toMatchObject({
      siteType: 'multi_family_garage',
      street: 'ul. Fikcyjna',
      buildingNumber: '7',
      postalCode: '00-950',
      city: 'Warszawa',
      parkingSpotNumber: '12',
    });
    const all = [built.workOrderId, p['newCustomer']?.['id'], p['newSite']?.['id']];
    expect(new Set(all).size).toBe(3);
    for (const id of all) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('EVM-106 AC2: an existing customer and place are referred to by id; nothing new is sent for them', () => {
    const built = buildQuickOrderInput(
      valid({ customerMode: 'existing', customerId: 'c1', siteMode: 'existing', siteId: 's1' }),
      source,
      templates,
      ids,
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.input.payload).toMatchObject({ customerId: 'c1', siteId: 's1' });
    expect(built.input.payload).not.toHaveProperty('newCustomer');
    expect(built.input.payload).not.toHaveProperty('newSite');
  });

  it('EVM-106 AC2: the spot only for a garage, the apartment only when typed, an empty note is left out, a company has its own name', () => {
    const house = buildQuickOrderInput(
      valid({
        siteType: 'single_family_house',
        templateId: T1,
        kind: 'company',
        companyName: ' Firma  Testowa ',
        apartmentNumber: '4',
        note: '  ',
      }),
      source,
      templates,
      ids,
    );
    expect(house.ok).toBe(true);
    if (!house.ok) return;
    const p = house.input.payload as Record<string, Record<string, unknown>>;
    expect(p['newSite']).not.toHaveProperty('parkingSpotNumber');
    expect(p['newSite']).toMatchObject({ apartmentNumber: '4' });
    expect(p['newCustomer']).toMatchObject({ kind: 'company', displayName: 'Firma Testowa' });
    expect(house.input.payload).not.toHaveProperty('note');
    const garage = buildQuickOrderInput(valid({ parkingSpotNumber: '' }), source, templates, ids);
    expect(garage.ok && (garage.input.payload as Record<string, Record<string, unknown>>)['newSite']).not.toHaveProperty(
      'parkingSpotNumber',
    );
  });

  it('EVM-106 AC2: text is cleaned like the server does - NFC, control characters out, notes keep line breaks', () => {
    expect(cleanLine('  An\u0301na \u0000\n  Nowak ')).toBe('Ańna Nowak'.normalize('NFC'));
    expect(cleanNote('a\r\nb\u0000c\u202e')).toBe('a\nbc');
    expect(cleanNote('\ud800')).toBeNull();
  });

  it('EVM-106 AC2: a note longer than 2000 characters after normalisation is refused, exactly 2000 is accepted', () => {
    expect(fields(valid({ note: 'x'.repeat(2000) }))).toEqual([]);
    expect(fields(valid({ note: 'x'.repeat(2001) }))).toEqual(['note:too_long']);
    expect(fields(valid({ note: '\ud800' }))).toEqual(['note:invalid']);
  });

  it('EVM-106 AC2: templates are filtered by the type of the place (hint or none), "show all" lifts the filter', () => {
    expect(templatesFor(templates, 'multi_family_garage', false).map((t) => t.id)).toEqual([T2, T3]);
    expect(templatesFor(templates, 'single_family_house', false).map((t) => t.id)).toEqual([T1, T3]);
    expect(templatesFor(templates, 'commercial', false).map((t) => t.id)).toEqual([T3]);
    expect(templatesFor(templates, null, false)).toHaveLength(3);
    expect(templatesFor(templates, 'commercial', true)).toHaveLength(3);
  });

  it('EVM-106 AC2: the type of the place comes from the chosen place of the phone or from the typed one', () => {
    expect(draftSiteType(valid({ siteMode: 'existing', siteId: 's1' }), source)).toBe('multi_family_garage');
    expect(draftSiteType(valid({ siteMode: 'existing', siteId: 'nope' }), source)).toBeNull();
    expect(draftSiteType(valid({ siteType: 'commercial' }), source)).toBe('commercial');
    expect(
      draftSiteType(valid({ siteMode: 'existing', siteId: 's1' }), {
        customers: [],
        sites: [{ ...must(source.sites[0]), siteType: 'weird' }],
      }),
    ).toBeNull();
  });

  it('EVM-106 AC2: the empty state opens straight in "Nowy klient" and "Nowa"; with data it starts on "Z telefonu"', () => {
    expect(initialDraft(EMPTY_QUICK_SOURCE)).toMatchObject({ customerMode: 'new', siteMode: 'new' });
    expect(initialDraft(source)).toMatchObject({ customerMode: 'existing', siteMode: 'existing' });
    expect(hasInput(initialDraft(source))).toBe(false);
    expect(hasInput(valid())).toBe(true);
    expect(hasInput({ ...EMPTY_DRAFT, templateId: T1 })).toBe(true);
    expect(hasInput({ ...EMPTY_DRAFT, customerId: 'c1' })).toBe(true);
    expect(hasInput({ ...EMPTY_DRAFT, siteId: 's1' })).toBe(true);
  });
});

describe('quick order model: validation (EVM-106 AC3)', () => {
  it('EVM-106 AC3: a complete draft has no problems', () => {
    expect(fields(valid())).toEqual([]);
  });

  it('EVM-106 AC3: the phone must match the pattern of the contract (7-32 of digits, + ( ) - and space)', () => {
    expect(fields(valid({ phone: '' }))).toEqual(['phone:required']);
    expect(fields(valid({ phone: '12345' }))).toEqual(['phone:format']);
    expect(fields(valid({ phone: '600-000-00x' }))).toEqual(['phone:format']);
    expect(fields(valid({ phone: '()- ()- ()-' }))).toEqual(['phone:format']);
    expect(fields(valid({ phone: '+'.padEnd(33, '1') }))).toEqual(['phone:format']);
    expect(fields(valid({ phone: '+48 (22) 123-45-67' }))).toEqual([]);
  });

  it('EVM-106 AC3: a person needs the first name and the surname - one word is not enough', () => {
    expect(fields(valid({ firstName: '', lastName: '' }))).toEqual(['firstName:required', 'lastName:required']);
    expect(fields(valid({ lastName: '  ' }))).toEqual(['lastName:single_word']);
    expect(fields(valid({ firstName: '' }))).toEqual(['firstName:single_word']);
    expect(fields(valid({ lastName: 'x'.repeat(200) }))).toEqual(['lastName:too_long']);
    expect(customerName(valid({ firstName: 'Anna', lastName: '' }))).toBeNull();
  });

  it('EVM-106 AC3: a company needs a name of at most 200 characters', () => {
    expect(fields(valid({ kind: 'company', companyName: '' }))).toEqual(['companyName:required']);
    expect(fields(valid({ kind: 'company', companyName: 'x'.repeat(201) }))).toEqual(['companyName:too_long']);
    expect(fields(valid({ kind: 'company', companyName: 'Firma' }))).toEqual([]);
    expect(customerName(valid({ kind: 'company', companyName: '' }))).toBeNull();
  });

  it('EVM-106 AC3: a missing address is reported per field; a postal code other than 00-000 is refused', () => {
    expect(fields(valid({ siteType: null, street: '', buildingNumber: '', postalCode: '', city: '' }))).toEqual([
      'siteType:required',
      'street:required',
      'buildingNumber:required',
      'postalCode:required',
      'city:required',
    ]);
    expect(fields(valid({ postalCode: '00950' }))).toEqual(['postalCode:format']);
    expect(fields(valid({ postalCode: '0-0950' }))).toEqual(['postalCode:format']);
    expect(
      fields(
        valid({
          street: 'x'.repeat(201),
          buildingNumber: 'y'.repeat(21),
          apartmentNumber: 'z'.repeat(21),
          city: 'c'.repeat(101),
          parkingSpotNumber: 'p'.repeat(21),
        }),
      ),
    ).toEqual(['street:too_long', 'buildingNumber:too_long', 'apartmentNumber:too_long', 'city:too_long', 'parkingSpotNumber:too_long']);
  });

  it('EVM-106 AC3: the title is required and at most 200 characters; the template must be one of the stored', () => {
    expect(fields(valid({ title: '   ' }))).toEqual(['title:required']);
    expect(fields(valid({ title: 'x'.repeat(201) }))).toEqual(['title:too_long']);
    expect(fields(valid({ title: 'x'.repeat(200) }))).toEqual([]);
    expect(fields(valid({ templateId: null }))).toEqual(['template:required']);
    expect(fields(valid({ templateId: 'gone' }))).toEqual(['template:required']);
    expect(validateQuickOrder(valid(), source, [])).toEqual([{ field: 'template', problem: 'required' }]);
  });

  it('EVM-106 AC3: an existing customer or place must be chosen and must be on the phone', () => {
    expect(fields(valid({ customerMode: 'existing', customerId: null, siteMode: 'existing', siteId: null }))).toEqual([
      'customer:required',
      'site:required',
    ]);
    expect(fields(valid({ customerMode: 'existing', customerId: 'gone', siteMode: 'existing', siteId: 'gone' }))).toEqual([
      'customer:required',
      'site:required',
    ]);
    // an existing customer needs no phone and no name
    expect(fields(valid({ customerMode: 'existing', customerId: 'c1', firstName: '', phone: '' }))).toEqual([]);
  });

  it('EVM-106 AC3: an invalid draft puts nothing in the command (no ids are drawn either)', () => {
    let drawn = 0;
    const built = buildQuickOrderInput(valid({ phone: '' }), source, templates, () => {
      drawn += 1;
      return 'x';
    });
    expect(built).toEqual({ ok: false, errors: [{ field: 'phone', problem: 'required' }] });
    expect(drawn).toBe(0);
  });

  it('EVM-106 AC3: errors are codes - they never contain the typed text', () => {
    const errors = JSON.stringify(
      validateQuickOrder(valid({ phone: 'SECRET-PHONE', street: '', firstName: 'SECRET', lastName: '' }), source, templates),
    );
    expect(errors).not.toContain('SECRET');
  });
});

describe('quick order model: similar customers (EVM-106 AC3)', () => {
  const draft = (patch: Partial<QuickOrderDraft>) => ({ ...valid(), ...patch });

  it('EVM-106 AC3: the same phone in E.164 matches whatever the way it is written', () => {
    for (const phone of ['600000001', '+48 600-000-001', '0048 600 000 001', '48600000001']) {
      expect(findSimilarCustomers(draft({ phone }), source.customers).map((c) => c.id)).toEqual(['c1']);
    }
    expect(findSimilarCustomers(draft({ phone: '(22) 000 00 02' }), source.customers).map((c) => c.id)).toEqual(['c2']);
    expect(findSimilarCustomers(draft({ phone: '22 000 00 02' }), source.customers).map((c) => c.id)).toEqual(['c2']);
  });

  it('EVM-106 AC3: the same name matches without Polish letters and without case', () => {
    expect(findSimilarCustomers(draft({ firstName: 'lukasz', lastName: 'ZOLC', phone: '' }), source.customers).map((c) => c.id)).toEqual([
      'c1',
    ]);
    expect(
      findSimilarCustomers(draft({ kind: 'company', companyName: ' wspólnota   testowa ', phone: '' }), source.customers).map((c) => c.id),
    ).toEqual(['c2']);
    expect(nameKey('Łódź')).toBe('lodz');
  });

  it('EVM-106 AC3: nothing similar, nothing typed, or an existing customer chosen -> no hint; at most three are offered', () => {
    expect(findSimilarCustomers(draft({}), source.customers)).toEqual([]);
    expect(findSimilarCustomers(draft({ firstName: '', lastName: '', phone: '' }), source.customers)).toEqual([]);
    expect(findSimilarCustomers(draft({ customerMode: 'existing', phone: '600000001' }), source.customers)).toEqual([]);
    const many = Array.from({ length: 5 }, (_, i) => ({ id: `m${String(i)}`, kind: 'person', displayName: 'Jan Kowalski', phone: '' }));
    expect(findSimilarCustomers(draft({ firstName: 'Jan', lastName: 'Kowalski', phone: '' }), many)).toHaveLength(3);
    // an empty stored name never matches an empty typed one
    expect(
      findSimilarCustomers(draft({ firstName: '', lastName: '', phone: '600000009' }), [
        { id: 'e', kind: 'person', displayName: '', phone: '' },
      ]),
    ).toEqual([]);
  });

  it('EVM-106 AC3: phoneKey - E.164 for the comparison only, null for too few digits', () => {
    expect(phoneKey('600 000 001')).toBe('+48600000001');
    expect(phoneKey('+44 20 7946 0958')).toBe('+442079460958');
    expect(phoneKey('0044 20 7946 0958')).toBe('+442079460958');
    expect(phoneKey('1234567890')).toBe('+1234567890');
    expect(phoneKey('12')).toBeNull();
  });
});
