import { describe, expect, it } from 'vitest';
import { zSyncMutationsResponse, zWorkOrderDetails, zWorkOrderPatch } from '../src/zod.ts';

const MUTATION_ID = '0198a2b4-0000-7000-8000-000000000001';
const details = {
  id: '0198a2b4-0000-7000-8000-000000000002',
  number: 'ZL-2026-0001',
  title: 'Montaż',
  status: 'new',
  customer: null,
  site: null,
  coordinator: null,
  version: 1,
  createdAt: '2026-10-31T10:00:00.000Z',
  origin: 'mobile_quick',
  createdBy: { displayName: 'Jan Przykładowy' },
  allowedTransitions: [],
};

describe('EVM-099 AC5 AC7 contract of the results of a quick work order', () => {
  it('EVM-099 AC7 accepts the code quota_exceeded and AC5 the list of field errors (pointer and code only)', () => {
    const parsed = zSyncMutationsResponse.safeParse({
      serverTime: '2026-10-31T10:00:00.000Z',
      results: [
        { mutationId: MUTATION_ID, outcome: 'rejected', code: 'quota_exceeded' },
        {
          mutationId: MUTATION_ID,
          outcome: 'rejected',
          code: 'validation_failed',
          errors: [{ pointer: '/newCustomer/phone', code: 'invalid_format' }],
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it('EVM-099 AC5 an error of a field has a pointer and a code and no place for a value', () => {
    const error = (
      zSyncMutationsResponse.shape.results.element.shape.errors as unknown as { unwrap(): { element: { shape: object } } }
    ).unwrap().element.shape;
    expect(Object.keys(error).sort()).toEqual(['code', 'pointer']);
  });
});

describe('EVM-099 AC8 read-only fields of the detail of a work order', () => {
  it('EVM-099 AC8 the detail has origin and the author (display name only)', () => {
    expect(zWorkOrderDetails.safeParse(details).success).toBe(true);
    expect(Object.keys(zWorkOrderDetails.shape)).toEqual(expect.arrayContaining(['origin', 'createdBy', 'createdAt']));
  });

  it('EVM-099 AC8 origin and createdBy are not writable: the patch does not know them', () => {
    expect(Object.keys(zWorkOrderPatch.shape)).not.toEqual(expect.arrayContaining(['origin']));
    expect(Object.keys(zWorkOrderPatch.shape)).not.toEqual(expect.arrayContaining(['createdBy']));
  });
});
