import type { TimelineEntry as Entry, TimelineEvent, WorkOrderStatus, StageStatus } from '@evia/contracts';
import { StatusBadge, type OrderStatusKey, type StageStatusKey } from '@evia/ui-web';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { partyKindLabels, waitingOnLabels } from '../i18n/catalog-labels.ts';
import { stageStatusLabels } from '../i18n/procedure-labels.ts';
import { workOrderStatusLabels } from '../i18n/work-order-labels.ts';

/** A status the panel knows: a code of the contract with a label. Anything else is "Nieznany status" (P-12) — never the raw code. */
const knownOrder = (code: string | null): code is WorkOrderStatus => code !== null && Object.hasOwn(workOrderStatusLabels, code);
const knownStage = (code: string | null): code is StageStatus => code !== null && Object.hasOwn(stageStatusLabels, code);

interface Status {
  readonly label: string;
  readonly badge: { readonly status: OrderStatusKey | StageStatusKey; readonly group: 'order' | 'stage'; readonly hint?: string };
}

function statusOf(t: TFunction, group: 'order' | 'stage', code: string | null): Status {
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

interface Composed {
  readonly text: string;
  readonly badge?: Status;
}

/** The impersonal sentence of an event and its compact status badge; the stage and the party come from the current data (AC3). */
function compose(t: TFunction, event: TimelineEvent, stageName: string | null): Composed {
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
  const { text, badge } = compose(t, entry.event, entry.procedureStageName);
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
