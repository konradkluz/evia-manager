import type { Kysely } from 'kysely';
import { describe, expect, it, vi } from 'vitest';
import type { TemplateDirectory, TemplatePaymentMilestoneForCopy } from '../../src/modules/catalog/index.ts';
import { PaymentsCompositionContributor } from '../../src/modules/payments/application/payments-contributor.ts';
import { PaymentsTransitionParticipant } from '../../src/modules/payments/application/payments-transition-participant.ts';
import { amountFromDatabase } from '../../src/modules/payments/infrastructure/milestone-store.ts';
import {
  CompositionRejectedError,
  WorkOrderCompositionRegistry,
  WorkOrderTransitionRegistry,
  type CompositionContext,
  type TransitionContext,
} from '../../src/modules/work-orders/index.ts';
import type { Database } from '../../src/platform/database/database.ts';
import { EventBus } from '../../src/platform/events/event-bus.ts';
import { principal } from '../support/principals.ts';
import { uuidv7 } from '../support/uuid.ts';

// The ports with FAKES: every refusal and every "nothing to do" comes BEFORE the first query, so the fake transaction has no query
// methods at all — a call to one would fail the test (the writes themselves are proved against PostgreSQL in test/integration).
const TRANSACTION = { marker: 'the transaction of the command' } as unknown as Kysely<Database>;

const plan = (count: number): TemplatePaymentMilestoneForCopy[] =>
  Array.from({ length: count }, (_, index) => ({
    sourceTemplateId: uuidv7(),
    code: `milestone_${index}`,
    name: `Transza ${index}`,
    sharePercent: 5,
    paymentTermDays: 7,
  }));

function contributorWith(answer: TemplatePaymentMilestoneForCopy[]) {
  const find = vi.fn(() => Promise.resolve(answer));
  const registry = new WorkOrderCompositionRegistry();
  const contributor = new PaymentsCompositionContributor({ findPaymentPlanForCopy: find } as unknown as TemplateDirectory, registry);
  const context = (templateId: string | null): CompositionContext => ({
    workOrderId: uuidv7(),
    templateId,
    scopeItems: [],
    principal: principal({ role: 'editor' }),
    now: new Date('2026-10-13T08:00:00Z'),
  });
  return { find, registry, contributor, context };
}

describe('the contributor of the payment milestones (EVM-053 AC1; SR-API-06)', () => {
  it('EVM-053 AC1 it registers itself under the name "payments" AFTER the processes (order 200 > 100), when the module starts', () => {
    const { registry, contributor } = contributorWith([]);
    contributor.onModuleInit();
    expect(registry.ordered().map((item) => [item.name, item.order])).toEqual([['payments', 200]]);
    expect(() => {
      contributor.onModuleInit();
    }).toThrow(/already registered/);
  });

  it('EVM-053 AC1 an order without a template asks the catalog for nothing; a template without a plan writes nothing', async () => {
    const { find, contributor, context } = contributorWith([]);
    await contributor.contribute(TRANSACTION, context(null));
    expect(find).not.toHaveBeenCalled();
    const templateId = uuidv7();
    await contributor.contribute(TRANSACTION, context(templateId));
    expect(find).toHaveBeenCalledWith(TRANSACTION, templateId);
  });

  it('EVM-053 AC1 fail closed: a plan of 21 milestones fails the creation before any write; nothing is cut off', async () => {
    const { contributor, context } = contributorWith(plan(21));
    await expect(contributor.contribute(TRANSACTION, context(uuidv7()))).rejects.toThrow(/more than 20 milestones/);
  });

  it('EVM-099 AC5 the plan of 21 milestones is told to work-orders as CompositionRejectedError (the phone gets template_unavailable, not a 500), with the cause kept', async () => {
    const { contributor, context } = contributorWith(plan(21));
    const error = await contributor.contribute(TRANSACTION, context(uuidv7())).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(CompositionRejectedError);
    expect((error as Error).cause).toBeInstanceOf(Error);
  });
});

describe('the participant of the transitions of an order (EVM-053 AC6; SR-API-06)', () => {
  const context = (to: TransitionContext['to']): TransitionContext => ({
    workOrderId: uuidv7(),
    from: 'completed',
    to,
    principal: principal({ role: 'editor' }),
    now: new Date('2026-10-13T08:00:00Z'),
    request: { origin: 'web', traceId: '4bf92f3577b34da6a3ce929d0e0e4736' },
  });

  it('EVM-053 AC6 EVM-054 AC6 it registers itself under the name "payments"; a target other than settled and cancelled has no condition and other than cancelled no effect (no query at all)', async () => {
    const registry = new WorkOrderTransitionRegistry();
    const participant = new PaymentsTransitionParticipant(registry, new EventBus());
    participant.onModuleInit();
    expect(registry.ordered().map((item) => item.name)).toEqual(['payments']);
    for (const to of ['accepted', 'in_progress', 'on_hold', 'completed'] as const) {
      expect(await participant.check(TRANSACTION, context(to)), to).toBeUndefined();
    }
    for (const to of ['accepted', 'in_progress', 'on_hold', 'completed', 'settled'] as const) {
      await participant.apply(TRANSACTION, context(to));
    }
  });
});

describe('an amount read from the database (EVM-053 AC2; bigint without a global parser)', () => {
  it('EVM-053 AC2 the text of a bigint becomes a safe integer; null stays null; a value outside the safe integers is an error', () => {
    expect(amountFromDatabase('360000')).toBe(360000);
    expect(amountFromDatabase(null)).toBeNull();
    expect(() => amountFromDatabase('9007199254740993')).toThrow(RangeError);
  });
});
