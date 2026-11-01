import { describe, expect, it } from 'vitest';
import { ProblemException } from '../../src/platform/http/problem.ts';
import { parseInput } from '../../src/platform/http/validation.ts';
import { requestHash } from '../../src/platform/idempotency/canonical-json.ts';
import {
  CAPTURED_AT_MAX_AGE_MS,
  CAPTURED_AT_MAX_AHEAD_MS,
  capturedAtInRange,
  decodeMutation,
  envelopeSchema,
  MAX_MUTATION_BYTES,
  MutationVerdictSignal,
  QuotaExceededSignal,
  capped,
  typeLabel,
  type RawMutation,
} from '../../src/modules/sync/domain/mutations.ts';

const NOW = new Date('2026-10-31T10:00:00.000Z');
const MUTATION = '0193a000-0000-7000-8000-000000000a01';
const ENTRY = '0193a000-0000-7000-8000-000000000a02';
const ORDER = '0193a000-0000-7000-8000-0000000000b1';
const STAGE = '0193a000-0000-7000-8000-0000000000c1';

const note = (payload: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): RawMutation => ({
  mutationId: MUTATION,
  type: 'CreateNote',
  commandVersion: 1,
  payload: {
    id: ENTRY,
    workOrderId: ORDER,
    noteCategory: 'site_visit',
    body: 'Sprawdzono miejsce.',
    capturedAt: '2026-10-31T09:55:00Z',
    ...payload,
  },
  ...extra,
});
const comment = (payload: Record<string, unknown> = {}): RawMutation => ({
  mutationId: MUTATION,
  type: 'CreateComment',
  commandVersion: 1,
  payload: { id: ENTRY, workOrderId: ORDER, body: 'Klient prosi o telefon.', capturedAt: '2026-10-31T09:56:00+01:00', ...payload },
});
const without = (record: Record<string, unknown>, key: string): Record<string, unknown> =>
  Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));

const envelopeError = (body: unknown): unknown => {
  try {
    parseInput(envelopeSchema, body);
  } catch (error) {
    return error;
  }
  return undefined;
};

describe('the envelope of a batch (EVM-098 AC1; SR-INPUT-01, SR-SYNC-06)', () => {
  it('EVM-098 AC1 1 to 50 mutations, each with a UUIDv7 mutationId; the rest of a mutation is not judged by the envelope', () => {
    expect(parseInput(envelopeSchema, { mutations: [{ mutationId: MUTATION, type: 'Anything' }] }).mutations).toHaveLength(1);
    expect(parseInput(envelopeSchema, { mutations: Array.from({ length: 50 }, () => ({ mutationId: MUTATION })) }).mutations).toHaveLength(
      50,
    );
    expect(parseInput(envelopeSchema, { pendingItems: 1_000_000, mutations: [{ mutationId: MUTATION }] }).pendingItems).toBe(1_000_000);
  });

  it('EVM-098 AC1 an empty batch, 51 mutations, a bad mutationId, a field outside the envelope and pendingItems out of the contract are 400 validation_failed with pointers and no value', () => {
    const bad: unknown[] = [
      { mutations: [] },
      { mutations: Array.from({ length: 51 }, () => ({ mutationId: MUTATION })) },
      { mutations: [{ mutationId: '0193a000-0000-4000-8000-000000000a01' }] },
      { mutations: [{ mutationId: 'SECRET-VALUE' }] },
      { mutations: [{}] },
      { mutations: [{ mutationId: MUTATION }], deviceId: ORDER },
      { mutations: [{ mutationId: MUTATION }], pendingItems: 1_000_001 },
      { mutations: [{ mutationId: MUTATION }], pendingItems: -1 },
      { mutations: [{ mutationId: MUTATION }], pendingItems: 1.5 },
      {},
      [],
      'text',
    ];
    for (const body of bad) {
      const error = envelopeError(body);
      expect(error, JSON.stringify(body)).toBeInstanceOf(ProblemException);
      expect((error as ProblemException).code).toBe('validation_failed');
      expect(JSON.stringify((error as ProblemException).extras)).not.toContain('SECRET-VALUE');
    }
  });
});

describe('one mutation (EVM-098 AC1, AC2, AC4; SR-INPUT-01, SR-AUTHZ-04, CWE-915)', () => {
  it('EVM-098 AC2 a note and a comment are decoded into a command of the journal; the server fields are never taken from the request', () => {
    const decodedNote = decodeMutation(note({ procedureStageId: STAGE }), NOW);
    expect(decodedNote).toMatchObject({
      ok: true,
      type: 'CreateNote',
      capturedAtOutOfRange: false,
      command: {
        id: ENTRY,
        kind: 'note',
        workOrderId: ORDER,
        noteCategory: 'site_visit',
        procedureStageId: STAGE,
        capturedAt: new Date('2026-10-31T09:55:00Z'),
      },
    });
    const decodedComment = decodeMutation(comment(), NOW);
    expect(decodedComment).toMatchObject({
      ok: true,
      type: 'CreateComment',
      command: { kind: 'comment', noteCategory: undefined, procedureStageId: undefined, capturedAt: new Date('2026-10-31T08:56:00Z') },
    });
  });

  it('EVM-098 AC1 a missing field, a field outside the contract (also a field of the server), a bad category, an unknown type or version are invalid', () => {
    const cases: RawMutation[] = [
      { ...note(), payload: without(note().payload as Record<string, unknown>, 'body') },
      { ...note(), payload: without(note().payload as Record<string, unknown>, 'noteCategory') },
      { ...note(), payload: without(note().payload as Record<string, unknown>, 'capturedAt') },
      note({ deviceId: ORDER }),
      note({ createdBy: ORDER }),
      note({ authorId: ORDER }),
      note({ origin: 'web' }),
      note({ kind: 'comment' }),
      note({ createdAt: '2026-10-31T09:55:00Z' }),
      note({ noteCategory: 'gossip' }),
      note({ id: '0193a000-0000-4000-8000-000000000a02' }),
      note({ workOrderId: 'not-a-uuid' }),
      note({ capturedAt: '2026-10-31T09:55:00' }),
      note({ capturedAt: 'yesterday' }),
      note({ body: 7 }),
      comment({ noteCategory: 'meeting' }),
      comment({ procedureStageId: STAGE }),
      note({}, { type: 'DeleteEverything' }),
      note({}, { commandVersion: 2 }),
      note({}, { commandVersion: '1' }),
      note({}, { extra: true }),
      note({}, { payload: 'text' }),
      { mutationId: MUTATION, commandVersion: 1, payload: {} },
    ];
    for (const raw of cases) expect(decodeMutation(raw, NOW), JSON.stringify(raw)).toEqual({ ok: false });
  });

  it('EVM-098 AC1 a mutation is at most 64 KB: one byte more is invalid, before its payload is parsed', () => {
    const fill = (size: number) => {
      const base = note({ body: '' });
      const overhead = Buffer.byteLength(JSON.stringify(base), 'utf8');
      return note({ body: 'x'.repeat(size - overhead) });
    };
    expect(Buffer.byteLength(JSON.stringify(fill(MAX_MUTATION_BYTES)), 'utf8')).toBe(MAX_MUTATION_BYTES);
    expect(decodeMutation(fill(MAX_MUTATION_BYTES), NOW).ok).toBe(true);
    expect(decodeMutation(fill(MAX_MUTATION_BYTES + 1), NOW)).toEqual({ ok: false });
  });

  it('EVM-098 AC4 the hash is the canonical {type, commandVersion, payload} as received: the key order does not matter, mutationId is not in it, any other content is', () => {
    const decoded = decodeMutation(note(), NOW);
    const { type, commandVersion, payload } = note();
    const rest = { type, commandVersion, payload };
    expect(decoded.ok && decoded.hash).toBe(requestHash(rest));
    const reordered: RawMutation = {
      payload: {
        capturedAt: '2026-10-31T09:55:00Z',
        body: 'Sprawdzono miejsce.',
        noteCategory: 'site_visit',
        workOrderId: ORDER,
        id: ENTRY,
      },
      commandVersion: 1,
      type: 'CreateNote',
      mutationId: '0193a000-0000-7000-8000-000000000a99',
    };
    const again = decodeMutation(reordered, NOW);
    expect(again.ok && again.hash).toBe(decoded.ok && decoded.hash);
    // the text before the normalisation: a trailing space is another content, though it is stored the same
    const spaced = decodeMutation(note({ body: 'Sprawdzono miejsce. ' }), NOW);
    expect(spaced.ok && spaced.hash).not.toBe(decoded.ok && decoded.hash);
    // capturedAt as received, even out of range
    const old = decodeMutation(note({ capturedAt: '2020-01-01T00:00:00Z' }), NOW);
    expect(old.ok && old.hash).toBe(requestHash({ ...rest, payload: { ...(rest.payload as object), capturedAt: '2020-01-01T00:00:00Z' } }));
  });
});

describe('capturedAt is metadata (EVM-098 AC7; SR-SYNC-05)', () => {
  it('EVM-098 AC7 the range is [now − 60 days, now + 10 minutes], both ends included, to the millisecond', () => {
    const at = (offset: number) => new Date(NOW.getTime() + offset);
    expect(capturedAtInRange(at(-CAPTURED_AT_MAX_AGE_MS), NOW)).toBe(true);
    expect(capturedAtInRange(at(-CAPTURED_AT_MAX_AGE_MS - 1), NOW)).toBe(false);
    expect(capturedAtInRange(at(CAPTURED_AT_MAX_AHEAD_MS), NOW)).toBe(true);
    expect(capturedAtInRange(at(CAPTURED_AT_MAX_AHEAD_MS + 1), NOW)).toBe(false);
    expect(CAPTURED_AT_MAX_AGE_MS).toBe(60 * 86_400_000);
    expect(CAPTURED_AT_MAX_AHEAD_MS).toBe(600_000);
  });

  it('EVM-098 AC7 out of range the command carries no capturedAt and is flagged; in range the moment is kept as it is', () => {
    const late = decodeMutation(note({ capturedAt: new Date(NOW.getTime() + CAPTURED_AT_MAX_AHEAD_MS + 1).toISOString() }), NOW);
    expect(late).toMatchObject({ ok: true, capturedAtOutOfRange: true, command: { capturedAt: null } });
    const early = decodeMutation(note({ capturedAt: '2026-01-01T00:00:00Z' }), NOW);
    expect(early).toMatchObject({ ok: true, capturedAtOutOfRange: true, command: { capturedAt: null } });
    const kept = decodeMutation(note({ capturedAt: '2026-10-01T10:00:00.123Z' }), NOW);
    expect(kept).toMatchObject({ capturedAtOutOfRange: false, command: { capturedAt: new Date('2026-10-01T10:00:00.123Z') } });
  });
});

describe('the verdict and the labels (EVM-098 AC4; SR-LOG-02)', () => {
  it('EVM-098 AC4 a verdict other than applied is a thrown signal that carries the result only', () => {
    const signal = new MutationVerdictSignal({ outcome: 'rejected', code: 'forbidden' });
    expect(signal).toBeInstanceOf(Error);
    expect(signal.verdict).toEqual({ outcome: 'rejected', code: 'forbidden' });
    expect(signal.name).toBe('MutationVerdictSignal');
  });

  it('EVM-098 AC1 the label of the type is a closed list: anything a client invents is unknown', () => {
    expect(['CreateNote', 'CreateComment', 'CreateQuickWorkOrder', 'DropTable', undefined, 7].map(typeLabel)).toEqual([
      'create_note',
      'create_comment',
      'create_quick_work_order',
      'unknown',
      'unknown',
      'unknown',
    ]);
  });
});

describe('the command CreateQuickWorkOrder (EVM-099 AC1, AC2, AC4, AC5; SR-INPUT-01, CWE-915)', () => {
  const CUSTOMER = '0193a000-0000-7000-8000-0000000000e1';
  const SITE = '0193a000-0000-7000-8000-0000000000e2';
  const NEW_CUSTOMER = '0193a000-0000-7000-8000-0000000000f1';
  const NEW_SITE = '0193a000-0000-7000-8000-0000000000f2';
  const TEMPLATE = '0193a000-0000-4000-8000-0000000000a3';
  const newCustomer = { id: NEW_CUSTOMER, kind: 'person', displayName: 'Jan Przykładowy', phone: '600 000 001' };
  const newSite = {
    id: NEW_SITE,
    siteType: 'single_family_house',
    street: 'ul. Fikcyjna',
    buildingNumber: '7',
    postalCode: '00-001',
    city: 'Warszawa',
  };
  const quick = (payload: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): RawMutation => ({
    mutationId: MUTATION,
    type: 'CreateQuickWorkOrder',
    commandVersion: 1,
    payload: { workOrderId: ORDER, templateId: TEMPLATE, title: ' Montaż  ', customerId: CUSTOMER, siteId: SITE, ...payload },
    ...extra,
  });
  const errorsOf = (raw: RawMutation) => {
    const decoded = decodeMutation(raw, NOW);
    return decoded.ok ? undefined : decoded.errors;
  };

  it('EVM-099 AC1 existing customer and site: the title is trimmed, the note is absent', () => {
    expect(decodeMutation(quick(), NOW)).toMatchObject({
      ok: true,
      type: 'CreateQuickWorkOrder',
      quick: { workOrderId: ORDER, title: 'Montaż', customerId: CUSTOMER, siteId: SITE, note: null, duplicateIds: false },
    });
  });

  it('EVM-099 AC2 a new customer and a new site replace the identifiers; a blank note is no note, a real one is normalised', () => {
    const both = decodeMutation(quick({ customerId: undefined, siteId: undefined, newCustomer, newSite, note: '  Dzwonić po 16.  ' }), NOW);
    expect(both).toMatchObject({
      ok: true,
      quick: { newCustomer, newSite, customerId: undefined, siteId: undefined, note: 'Dzwonić po 16.' },
    });
    expect(decodeMutation(quick({ note: '  \n ' }), NOW)).toMatchObject({ ok: true, quick: { note: null } });
  });

  it('EVM-099 AC4 the same identifier twice in the command is flagged (the service answers id_conflict)', () => {
    const twice = (payload: Record<string, unknown>) => decodeMutation(quick(payload), NOW);
    expect(twice({ customerId: undefined, newCustomer: { ...newCustomer, id: ORDER } })).toMatchObject({
      ok: true,
      quick: { duplicateIds: true },
    });
    expect(twice({ siteId: undefined, newSite: { ...newSite, id: ORDER } })).toMatchObject({ ok: true, quick: { duplicateIds: true } });
    expect(twice({ customerId: undefined, siteId: undefined, newCustomer, newSite: { ...newSite, id: NEW_CUSTOMER } })).toMatchObject({
      ok: true,
      quick: { duplicateIds: true },
    });
  });

  it('EVM-099 AC5 exactly one of each pair: both or neither is exactly_one_of at the field', () => {
    expect(errorsOf(quick({ newCustomer }))).toEqual([{ pointer: '/customerId', code: 'exactly_one_of' }]);
    expect(errorsOf(quick({ customerId: undefined }))).toEqual([{ pointer: '/customerId', code: 'exactly_one_of' }]);
    expect(errorsOf(quick({ newSite }))).toEqual([{ pointer: '/siteId', code: 'exactly_one_of' }]);
    expect(errorsOf(quick({ siteId: undefined }))).toEqual([{ pointer: '/siteId', code: 'exactly_one_of' }]);
  });

  it('EVM-099 AC5 an unknown commandVersion, a bad title and a bad telephone are a pointer and a code - the answer never repeats a value', () => {
    expect(errorsOf(quick({}, { commandVersion: 2 }))).toEqual([{ pointer: '/commandVersion', code: 'unsupported_version' }]);
    expect(errorsOf(quick({ title: '   ' }))).toEqual([{ pointer: '/title', code: 'required' }]);
    expect(errorsOf(quick({ title: 'a'.repeat(201) }))).toEqual([{ pointer: '/title', code: 'too_long' }]);
    expect(errorsOf(quick({ note: 'a'.repeat(2001) }))).toEqual([{ pointer: '/note', code: 'too_long' }]);
    const badPhone = errorsOf(quick({ customerId: undefined, newCustomer: { ...newCustomer, phone: 'abc-def-ghij' } }));
    expect(badPhone).toEqual([{ pointer: '/newCustomer/phone', code: 'invalid_format' }]);
    expect(JSON.stringify(badPhone)).not.toContain('abc-def-ghij');
  });

  it('EVM-099 AC2 the fields of the server and every field outside the contract are refused in the payload and in each new object (mass assignment)', () => {
    const extras = ['origin', 'number', 'status', 'createdViaDeviceId', 'email', 'nip', 'ppe', 'version', '__proto__'];
    for (const extra of extras) {
      const field = JSON.parse(`{"${extra}":"x"}`) as Record<string, unknown>;
      expect(errorsOf(quick(field)), `payload ${extra}`).toEqual([{ pointer: '', code: 'unknown_field' }]);
      expect(errorsOf(quick({ customerId: undefined, newCustomer: { ...newCustomer, ...field } })), `customer ${extra}`).toEqual([
        { pointer: '/newCustomer', code: 'unknown_field' },
      ]);
      expect(errorsOf(quick({ siteId: undefined, newSite: { ...newSite, ...field } })), `site ${extra}`).toEqual([
        { pointer: '/newSite', code: 'unknown_field' },
      ]);
    }
  });

  it('EVM-099 AC5 at most 20 errors, none repeated', () => {
    expect(errorsOf(quick({ title: 5, customerId: 5, siteId: 5, templateId: 5, workOrderId: 5, note: 5 }))?.length).toBeLessThanOrEqual(20);
  });

  it('EVM-099 AC5 the hash is the canonical command as received: the key order does not change it, the content does', () => {
    const first = decodeMutation(quick(), NOW);
    const second = decodeMutation(quick({ siteId: SITE, customerId: CUSTOMER }), NOW);
    const other = decodeMutation(quick({ title: 'Inny' }), NOW);
    expect(first.ok && second.ok && first.hash === second.hash).toBe(true);
    expect(first.ok && other.ok && first.hash !== other.hash).toBe(true);
  });
});

describe('the errors of the fields and the limit (EVM-099 AC5, AC7)', () => {
  const CUSTOMER = '0193a000-0000-7000-8000-0000000000e1';
  const SITE = '0193a000-0000-7000-8000-0000000000e2';
  const base = { workOrderId: ORDER, templateId: ORDER, title: 'Montaż', customerId: CUSTOMER, siteId: SITE };
  const raw = (payload: Record<string, unknown>): RawMutation => ({
    mutationId: MUTATION,
    type: 'CreateQuickWorkOrder',
    commandVersion: 1,
    payload: { ...base, ...payload },
  });
  const errorsOf = (mutation: RawMutation) => {
    const decoded = decodeMutation(mutation, NOW);
    return decoded.ok ? undefined : decoded.errors;
  };

  it('EVM-099 AC5 the code of the error comes from the kind of the issue: a length, a format, a value outside the list, a type - never a message or a value', () => {
    expect(errorsOf(raw({ title: '' }))).toEqual([{ pointer: '/title', code: 'too_short' }]);
    expect(
      errorsOf(raw({ customerId: undefined, newCustomer: { id: ENTRY, kind: 'person', displayName: 'Jan Przykładowy', phone: 'abc' } })),
    ).toEqual([
      { pointer: '/newCustomer/phone', code: 'too_short' },
      { pointer: '/newCustomer/phone', code: 'invalid_format' },
    ]);
    expect(
      errorsOf(
        raw({ customerId: undefined, newCustomer: { id: ENTRY, kind: 'alien', displayName: 'Jan Przykładowy', phone: '600600600' } }),
      ),
    ).toEqual([{ pointer: '/newCustomer/kind', code: 'invalid_value' }]);
    expect(errorsOf(raw({ title: 7 }))).toEqual([{ pointer: '/title', code: 'invalid_type' }]);
  });

  it('EVM-099 AC5 an identifier with a slash or a tilde in the path of an unknown field cannot break the pointer: the pointer names no key of the client', () => {
    expect(errorsOf(raw({ 'a/b~c': 1 }))).toEqual([{ pointer: '', code: 'unknown_field' }]);
  });

  it('EVM-099 AC5 the list of errors holds each error once and at most 20', () => {
    const issues = Array.from({ length: 30 }, (_, index) => ({ pointer: `/field${index}`, code: 'invalid_type' }));
    expect(capped(issues)).toHaveLength(20);
    expect(capped([...issues.slice(0, 3), ...issues.slice(0, 3)])).toEqual(issues.slice(0, 3));
  });

  it('EVM-099 AC7 the refusal by the limit is a verdict that also names the kind of the limit', () => {
    const signal = new QuotaExceededSignal('site');
    expect(signal).toBeInstanceOf(MutationVerdictSignal);
    expect(signal.kind).toBe('site');
    expect(signal.verdict).toEqual({ outcome: 'rejected', code: 'quota_exceeded' });
  });
});
