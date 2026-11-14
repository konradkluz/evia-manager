import { parseStoredTemplates, parseTemplateResponse } from '../../src/orders/templates';

// EVM-106 AC1 (security K3): the answer of the server and the stored document are both validated. Synthetic data only.
const ID = '0194c2a0-0000-7000-8000-000000000a01';
const template = (patch: Record<string, unknown> = {}) => ({
  id: ID,
  code: 'wallbox_house',
  name: 'Wallbox w domu',
  siteTypeHint: 'single_family_house',
  isActive: true,
  items: [],
  procedures: [],
  paymentMilestones: [],
  ...patch,
});

describe('templates of the phone (EVM-106 AC1)', () => {
  it('EVM-106 AC1: an answer of the contract becomes the allow-listed set (counters, no items), only active templates', () => {
    const set = parseTemplateResponse(
      { items: [template(), template({ id: '0194c2a0-0000-7000-8000-000000000a02', isActive: false })], nextCursor: null },
      42,
    );
    expect(set).toEqual({
      fetchedAt: 42,
      items: [
        {
          id: ID,
          code: 'wallbox_house',
          name: 'Wallbox w domu',
          siteTypeHint: 'single_family_house',
          itemCount: 0,
          procedureCount: 0,
          milestoneCount: 0,
        },
      ],
    });
  });

  it('EVM-106 AC1: an empty answer is an empty set (the catalogue has no active template)', () => {
    expect(parseTemplateResponse({ items: [], nextCursor: null }, 1)).toEqual({ fetchedAt: 1, items: [] });
  });

  it('EVM-106 AC1: anything that is not the contract is refused as a whole (the old set stays)', () => {
    for (const body of [
      null,
      'x',
      [],
      {},
      { items: 'x', nextCursor: null },
      { items: [template({ id: 'not-a-uuid' })], nextCursor: null },
      { items: [template({ siteTypeHint: 'castle' })], nextCursor: null },
    ]) {
      expect(parseTemplateResponse(body, 1)).toBeNull();
    }
  });

  it('EVM-106 AC1: the stored document is read defensively - a bad element is skipped, an unknown hint is "none", extra fields are dropped', () => {
    const stored = {
      fetchedAt: 5,
      items: [
        {
          id: ID,
          code: 'a_b',
          name: 'Nazwa',
          siteTypeHint: 'castle',
          itemCount: 2,
          procedureCount: -1,
          milestoneCount: 'x',
          secret: 'LEAK',
        },
        { id: 'bad', code: 'a_b', name: 'x' },
        { id: ID, code: '', name: 'x' },
        { id: ID, code: 'a_b', name: 'x'.repeat(201) },
        'junk',
        null,
      ],
    };
    const set = parseStoredTemplates(stored);
    expect(set).toEqual({
      fetchedAt: 5,
      items: [{ id: ID, code: 'a_b', name: 'Nazwa', siteTypeHint: null, itemCount: 2, procedureCount: 0, milestoneCount: 0 }],
    });
    expect(JSON.stringify(set)).not.toContain('LEAK');
  });

  it('EVM-106 AC1: a damaged stored value is "no set", never a crash', () => {
    for (const raw of [
      null,
      undefined,
      'x',
      7,
      [],
      {},
      { items: [] },
      { fetchedAt: 'x', items: [] },
      { fetchedAt: Number.NaN, items: [] },
      { fetchedAt: 1, items: 'x' },
    ]) {
      expect(parseStoredTemplates(raw)).toBeNull();
    }
  });
});
