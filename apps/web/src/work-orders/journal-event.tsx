import type { PaymentMilestoneStatus, TimelineEntry as Entry, TimelineEvent, WorkOrderStatus, StageStatus } from '@evia/contracts';
import { StatusBadge, type OrderStatusKey, type PaymentStatusKey, type StageStatusKey } from '@evia/ui-web';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { partyKindLabels, waitingOnLabels } from '../i18n/catalog-labels.ts';
import { paymentStatusLabels } from '../i18n/payment-labels.ts';
import { stageStatusLabels } from '../i18n/procedure-labels.ts';
import { workOrderStatusLabels } from '../i18n/work-order-labels.ts';
import { useProcedureTemplates, useServiceItems } from './use-order-lookups.ts';

/** A status the panel knows: a code of the contract with a label. Anything else is "Nieznany status" (P-12) — never the raw code. */
const knownOrder = (code: string | null): code is WorkOrderStatus => code !== null && Object.hasOwn(workOrderStatusLabels, code);
const knownStage = (code: string | null): code is StageStatus => code !== null && Object.hasOwn(stageStatusLabels, code);
const knownPayment = (code: string | null): code is PaymentMilestoneStatus => code !== null && Object.hasOwn(paymentStatusLabels, code);

interface Status {
  readonly label: string;
  readonly badge: {
    readonly status: OrderStatusKey | StageStatusKey | PaymentStatusKey;
    readonly group: 'order' | 'stage' | 'payment';
    readonly hint?: string;
  };
}

function statusOf(t: TFunction, group: 'order' | 'stage' | 'payment', code: string | null): Status {
  // EVM-054 AC3: the status of an instalment — "Po terminie" is not a status, the journal shows the status of the model only
  if (group === 'payment' && knownPayment(code)) return { label: paymentStatusLabels[code], badge: { status: code, group } };
  if (group === 'order' && knownOrder(code)) {
    return { label: workOrderStatusLabels[code], badge: { status: code.replaceAll('_', '-') as OrderStatusKey, group } };
  }
  if (group === 'stage' && knownStage(code)) {
    return { label: stageStatusLabels[code], badge: { status: code.replaceAll('_', '-') as StageStatusKey, group } };
  }
  return {
    label: t('workOrders.status.unknown'),
    badge: { status: 'unknown', group, hint: t('workOrders.status.unknownHint') },
  };
}

/** "Czekamy na: Stoen Operator (OSD)": the name and the kind are the CURRENT data of the party; hidden or removed — told neutrally. */
function waitingOnText(t: TFunction, event: TimelineEvent): string | undefined {
  const party = event.waitingOnParty;
  if (party !== null) {
    if (party.name === null) return t('workOrder.journal.event.waitingOn', { party: t('workOrder.journal.event.partyHidden') });
    const kind =
      party.kind !== null && Object.hasOwn(partyKindLabels, party.kind)
        ? partyKindLabels[party.kind as keyof typeof partyKindLabels]
        : undefined;
    const text = kind === undefined ? party.name : t('workOrder.journal.event.partyWithKind', { name: party.name, kind });
    return t('workOrder.journal.event.waitingOn', { party: text });
  }
  if (event.waitingOn === 'customer') return t('workOrder.journal.event.waitingOn', { party: waitingOnLabels.customer });
  return undefined;
}

function fieldsText(t: TFunction, fields: readonly string[]): string {
  const responsible = fields.includes('responsibleUserId');
  const dueDate = fields.includes('dueDate');
  if (responsible && dueDate) return t('workOrder.journal.event.fieldsBoth');
  if (responsible) return t('workOrder.journal.event.fieldResponsible');
  if (dueDate) return t('workOrder.journal.event.fieldDueDate');
  return t('workOrder.journal.event.fieldsOther');
}

/** The names of the catalogue for the events of the scope: the event keeps codes only (SR-LOG-03), the names come from the catalogue. */
interface Names {
  readonly item: (code: string | undefined) => string | undefined;
  readonly process: (code: string) => string | undefined;
}

const NO_NAMES: Names = { item: () => undefined, process: () => undefined };

const SCOPE_CODES: ReadonlySet<string> = new Set(['scope_item_added', 'scope_item_updated', 'scope_item_removed']);

function orderFieldsText(t: TFunction, fields: readonly string[]): string {
  const known: ReadonlyArray<readonly [string, string]> = [
    ['title', t('workOrder.journal.event.fieldTitle')],
    ['description', t('workOrder.journal.event.fieldDescription')],
    ['coordinator', t('workOrder.journal.event.fieldCoordinator')],
    ['plannedDate', t('workOrder.journal.event.fieldPlannedDate')],
  ];
  const named = known.filter(([code]) => fields.includes(code)).map(([, label]) => label);
  return named.length === 0 ? t('workOrder.journal.event.fieldsOther') : named.join(', ');
}

interface Composed {
  readonly text: string;
  readonly badge?: Status;
}

/** The impersonal sentence of an event and its compact status badge; the stage and the party come from the current data (AC3). */
function compose(t: TFunction, event: TimelineEvent, stageName: string | null, names: Names): Composed {
  const named = stageName !== null && stageName !== '';
  switch (event.code) {
    case 'work_order_created':
      return { text: t('workOrder.journal.event.created') };
    case 'work_order_status_changed': {
      const status = statusOf(t, 'order', event.toStatus);
      return { text: t('workOrder.journal.event.orderStatus', { status: status.label }), badge: status };
    }
    case 'stage_status_changed': {
      const status = statusOf(t, 'stage', event.toStatus);
      const head = named
        ? t('workOrder.journal.event.stageStatus', { stage: stageName, status: status.label })
        : t('workOrder.journal.event.stageStatusNoName', { status: status.label });
      const waiting = event.toStatus === 'waiting' ? waitingOnText(t, event) : undefined;
      return { text: waiting === undefined ? head : `${head} · ${waiting}`, badge: status };
    }
    case 'stage_waiting_on_changed': {
      const head = named
        ? t('workOrder.journal.event.waitingOnChanged', { stage: stageName })
        : t('workOrder.journal.event.waitingOnChangedNoName');
      const waiting = waitingOnText(t, event);
      return { text: waiting === undefined ? head : `${head} · ${waiting}` };
    }
    case 'stage_updated': {
      const what = fieldsText(t, event.changedFields);
      return {
        text: named
          ? t('workOrder.journal.event.updated', { what, stage: stageName })
          : t('workOrder.journal.event.updatedNoName', { what }),
      };
    }
    case 'payment_milestone_status_changed': {
      // EVM-054 AC3: the codes of the statuses and the name of NOW (the event carries no amount, no number, no reason)
      const status = statusOf(t, 'payment', event.toStatus);
      const name = event.paymentMilestone?.name ?? null;
      return {
        text:
          name === null || name === ''
            ? t('workOrder.journal.event.milestoneStatusNoName', { status: status.label })
            : t('workOrder.journal.event.milestoneStatus', { name, status: status.label }),
        badge: status,
      };
    }
    case 'payment_milestone_deleted':
      // EVM-057 AC4: the soft delete of an instalment by a correction — no amount, no number, no name (the instalment is gone)
      return { text: t('workOrder.journal.event.milestoneDeleted') };
    case 'work_order_fields_changed':
      return { text: t('workOrder.journal.event.orderFields', { fields: orderFieldsText(t, event.changedFields) }) };
    case 'scope_item_added': {
      const name = names.item(event.itemCode);
      const head = name === undefined ? t('workOrder.journal.event.scopeAddedNoName') : t('workOrder.journal.event.scopeAdded', { name });
      const processes = (event.procedureCodes ?? []).flatMap((code) => {
        const processName = names.process(code);
        return processName === undefined ? [] : [processName];
      });
      return {
        text: processes.length === 0 ? head : t('workOrder.journal.event.scopeAddedWith', { head, processes: processes.join(', ') }),
      };
    }
    case 'scope_item_updated': {
      const parameters = event.changedFields.includes('parameters');
      const notes = event.changedFields.includes('notes');
      const what =
        parameters && notes
          ? t('workOrder.journal.event.scopeBoth')
          : notes
            ? t('workOrder.journal.event.scopeNotes')
            : parameters
              ? t('workOrder.journal.event.scopeParameters')
              : t('workOrder.journal.event.fieldsOther');
      const name = names.item(event.itemCode);
      return {
        text:
          name === undefined
            ? t('workOrder.journal.event.scopeUpdatedNoName', { what })
            : t('workOrder.journal.event.scopeUpdated', { what, name }),
      };
    }
    case 'scope_item_removed': {
      const name = names.item(event.itemCode);
      return {
        text: name === undefined ? t('workOrder.journal.event.scopeRemovedNoName') : t('workOrder.journal.event.scopeRemoved', { name }),
      };
    }
    default:
      return { text: t('workOrder.journal.event.unknown') };
  }
}

/**
 * The content of an automatic entry (EVM-038 AC3; W-08): an impersonal sentence built from the code and the structured data of the
 * event, with the compact badge of the status. The author stands in the header of the entry. Everything is React text — a name of a
 * party is data of users (CWE-79). The badge repeats the status of the sentence, so it is hidden from assistive technology.
 */
export function JournalEventContent({ entry }: { readonly entry: Entry & { readonly event: TimelineEvent } }) {
  const { t } = useTranslation();
  const scoped = SCOPE_CODES.has(entry.event.code);
  const items = useServiceItems(scoped);
  const templates = useProcedureTemplates(scoped && (entry.event.procedureCodes?.length ?? 0) > 0);
  const names: Names = scoped
    ? {
        item: (code) => items.data?.find((item) => item.code === code)?.name,
        process: (code) => templates.data?.find((template) => template.code === code)?.name,
      }
    : NO_NAMES;
  const { text, badge } = compose(t, entry.event, entry.procedureStageName, names);
  return (
    <div className="flex flex-wrap items-center gap-x-inline-sm gap-y-stack-xs">
      {badge === undefined ? null : (
        <span aria-hidden="true">
          <StatusBadge
            status={badge.badge.status}
            group={badge.badge.group}
            label={badge.label}
            {...(badge.badge.hint === undefined ? {} : { hint: badge.badge.hint })}
          />
        </span>
      )}
      <p dir="auto" className="min-w-0 break-words">
        {text}
      </p>
    </div>
  );
}
