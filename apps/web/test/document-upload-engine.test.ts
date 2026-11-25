import { describe, expect, it } from 'vitest';
import { createApiClient } from '../src/api/client.ts';
import {
  canAddAgain,
  canRetry,
  DocumentUploadEngine,
  type DocumentFailure,
  type NewDocument,
} from '../src/work-orders/document-upload-engine.ts';
import { createFakeApi, json, problem, type Handler } from './api-fake.ts';

// The reasons a document was not sent and what the engine allows after each (EVM-148 AC2, AC4, AC5; K2-K5).
const ORDER = '01968f3e-0000-7000-8000-00000000d049';
const CREATE = `POST /api/v1/work-orders/${ORDER}/documents`;

const input = (over: Partial<NewDocument> = {}): NewDocument => ({
  file: new File([new Uint8Array(10)], 'oferta-testowa.pdf'),
  contentType: 'application/pdf',
  kindCode: 'quote',
  title: 'Oferta testowa',
  description: '',
  containsIdentityData: null,
  confidentialityOverride: null,
  ...over,
});

function setup(create: Handler) {
  let counter = 0;
  const api = createFakeApi({ [CREATE]: create });
  const engine = new DocumentUploadEngine({
    client: createApiClient(api.fetch),
    workOrderId: ORDER,
    hash: () => Promise.resolve('a'.repeat(64)),
    put: () => Promise.resolve({ ok: true } as never),
    isOnline: () => true,
    whenOnline: () => Promise.resolve(),
    newId: () => {
      counter += 1;
      return `00000000-0000-7000-8000-${String(counter).padStart(12, '0')}`;
    },
  });
  return { api, engine };
}

async function failureOf(answer: Response): Promise<{ failure: DocumentFailure | null; retryAfter: number | null }> {
  const { engine } = setup(() => answer);
  await engine.add(input());
  const [item] = engine.getSnapshot();
  return { failure: item?.failure ?? null, retryAfter: item?.retryAfter ?? null };
}

const fieldError = (pointer: string, code: string) => ({ errors: [{ pointer, code }] });

describe('EVM-148 AC4 AC5 the reason of a failure is decided by the status and the code', () => {
  it.each([
    ['409 customer_required', () => problem(409, 'customer_required'), 'customer'],
    ['409 id_conflict', () => problem(409, 'id_conflict'), 'conflict'],
    ['409 invalid_state_transition', () => problem(409, 'invalid_state_transition'), 'session'],
    ['409 work_order_closed', () => problem(409, 'work_order_closed'), 'closed'],
    ['409 with an unknown code', () => problem(409, 'something_new'), 'server'],
    ['409 without a code', () => json(409, {}), 'server'],
    ['400 requires_customer on /kindCode', () => problem(400, 'validation_failed', fieldError('/kindCode', 'requires_customer')), 'kind'],
    [
      '400 requires_customer on /confidentialityOverride',
      () => problem(400, 'validation_failed', fieldError('/confidentialityOverride', 'requires_customer')),
      'customer',
    ],
    ['400 another error on /kindCode', () => problem(400, 'validation_failed', fieldError('/kindCode', 'unknown_kind')), 'validation'],
    [
      '400 requires_customer on another field',
      () => problem(400, 'validation_failed', fieldError('/title', 'requires_customer')),
      'validation',
    ],
    ['400 on the stage', () => problem(400, 'validation_failed', fieldError('/procedureStageId', 'not_found')), 'stage'],
    ['403', () => problem(403, 'forbidden'), 'forbidden'],
    ['429', () => problem(429, 'rate_limited'), 'rate'],
    ['500', () => problem(500, 'internal_error'), 'server'],
  ] as const)('EVM-148 AC4 AC5 %s', async (_name, answer, expected) => {
    expect((await failureOf(answer())).failure).toBe(expected);
  });

  it('EVM-148 AC5 Retry-After of a 429 is kept as whole seconds, at most an hour; without it there is none', async () => {
    expect((await failureOf(problem(429, 'rate_limited', {}, { 'Retry-After': '30' }))).retryAfter).toBe(30);
    expect((await failureOf(problem(429, 'rate_limited', {}, { 'Retry-After': '999999' }))).retryAfter).toBe(3600);
    expect((await failureOf(problem(429, 'rate_limited'))).retryAfter).toBeNull();
    expect((await failureOf(problem(500, 'internal_error', {}, { 'Retry-After': '30' }))).retryAfter).toBeNull();
  });
});

describe('EVM-148 AC4 AC5 what the engine allows after a failure (K4, K5)', () => {
  it('EVM-148 AC4 "Ponów" and "Dodaj ponownie" are decided by the reason', () => {
    for (const failure of ['network', 'rate', 'validation', 'server', 'session'] as const) {
      expect(canRetry(failure)).toBe(true);
      expect(canAddAgain(failure)).toBe(false);
    }
    for (const failure of ['customer', 'kind', 'closed', 'forbidden', 'conflict', 'stage'] as const) expect(canRetry(failure)).toBe(false);
    expect(canAddAgain('customer')).toBe(true);
    expect(canAddAgain('kind')).toBe(true);
    expect(canAddAgain('closed')).toBe(false);
    expect(canRetry(null)).toBe(false);
  });

  it.each([
    ['customer', () => problem(409, 'customer_required')],
    ['kind', () => problem(400, 'validation_failed', fieldError('/kindCode', 'requires_customer'))],
    ['closed', () => problem(409, 'work_order_closed')],
    ['forbidden', () => problem(403, 'forbidden')],
    ['conflict', () => problem(409, 'id_conflict')],
  ] as const)(
    'EVM-148 AC4 K4 retry() of a "%s" failure sends nothing (the block is in the engine, not only in the button)',
    async (_name, answer) => {
      const { api, engine } = setup(() => answer());
      const key = await engine.add(input());
      expect(api.calls(CREATE)).toHaveLength(1);
      engine.retry(key);
      await Promise.resolve();
      expect(api.calls(CREATE)).toHaveLength(1);
      expect(engine.getSnapshot()[0]?.status).toBe('failed');
    },
  );

  it('EVM-148 AC5 K5 "Dodaj ponownie" is a new document with a new id and a new Idempotency-Key; the old line stays until "Ukryj" and is not sent again', async () => {
    const { api, engine } = setup(() => problem(409, 'customer_required'));
    const first = await engine.add(input());
    const kept = engine.inputOf(first);
    expect(kept?.title).toBe('Oferta testowa');
    const second = await engine.add(kept ?? input());
    const [one, two] = api.calls(CREATE);
    expect(second).not.toBe(first);
    expect((JSON.parse(one?.body ?? '{}') as { id: string }).id).toBe(first);
    expect((JSON.parse(two?.body ?? '{}') as { id: string }).id).toBe(second);
    expect(two?.headers.get('Idempotency-Key')).not.toBe(one?.headers.get('Idempotency-Key'));
    expect(api.calls(CREATE)).toHaveLength(2);
    expect(engine.getSnapshot().map((entry) => entry.key)).toEqual([first, second]);
    engine.dismiss(first);
    expect(engine.inputOf(first)).toBeUndefined();
    expect(engine.getSnapshot().map((entry) => entry.key)).toEqual([second]);
  });

  it('EVM-148 AC2 K2 the survey form sends the kind "quote" for the order and none of the fields that a survey refuses', async () => {
    const { api, engine } = setup(() => problem(500, 'internal_error'));
    await engine.add(input());
    const body = JSON.parse(api.calls(CREATE)[0]?.body ?? '{}') as Record<string, unknown>;
    expect(body.kindCode).toBe('quote');
    for (const field of ['anchor', 'confidentialityOverride', 'procedureStageId', 'containsIdentityData'])
      expect(body).not.toHaveProperty(field);
  });

  it('EVM-148 AC5 K6 nothing of the document is kept in the storage of the browser', async () => {
    const { engine } = setup(() => problem(409, 'customer_required'));
    await engine.add(input());
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
