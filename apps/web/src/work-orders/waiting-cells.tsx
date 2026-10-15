import type { WorkOrderListItem, WorkOrderWaiting } from '@evia/contracts';
import { AlarmClock, TriangleAlert } from '@evia/ui-web';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { partyKindLabels } from '../i18n/catalog-labels.ts';
import { formatDueDate } from './procedure-format.ts';
import { isLongWait, sinceText } from './waiting-text.ts';

/**
 * Whom the order waits for, as one text (styleguide § 4.4): "Stoen Operator (OSD)" for a party of a known kind, the bare name
 * for a kind this panel does not know (never the raw code), "Klient" for the customer and "Strona" for a party that is not
 * visible to the caller (`party` = `null`). The name is free text: React text only (SR-WEB-03).
 */
export function waitingWho(t: TFunction, waiting: WorkOrderWaiting): string {
  const party = waiting.party;
  if (party !== null) {
    return Object.hasOwn(partyKindLabels, party.kind)
      ? t('workOrders.waiting.party', { name: party.displayName, kind: partyKindLabels[party.kind as keyof typeof partyKindLabels] })
      : party.displayName;
  }
  return waiting.waitingOn === 'customer' ? t('workOrders.waiting.customer') : t('workOrders.waiting.unknownParty');
}

/** "i jeszcze 2 oczekiwania": the hidden sentence behind the visible "+2" (the declension of § 6.3). */
function othersText(t: TFunction, count: number): string {
  const last = count % 10;
  const tens = count % 100;
  if (count === 1) return t('workOrders.waiting.othersOne', { count });
  if (last >= 2 && last <= 4 && (tens < 12 || tens > 14)) return t('workOrders.waiting.othersFew', { count });
  return t('workOrders.waiting.othersMany', { count });
}

/** The text of the row for assistive technology: "czekamy na: Stoen Operator (OSD), od 15 dni" — only when the order waits. */
export function waitingRowText(t: TFunction, waiting: WorkOrderWaiting | null | undefined): string | undefined {
  if (waiting === null || waiting === undefined) return undefined;
  return t('workOrders.table.rowWaiting', { who: waitingWho(t, waiting), since: sinceText(t, waiting.days) });
}

/** The text of the row for the due date: "termin: 30.09.2026, po terminie" — only when there is one. */
export function dueRowText(t: TFunction, item: Pick<WorkOrderListItem, 'nextDueDate' | 'hasOverdueStage'>): string | undefined {
  const day = item.nextDueDate;
  if (day === null || day === undefined) return undefined;
  const date = formatDueDate(day);
  return item.hasOverdueStage === true ? t('workOrders.table.rowDueOverdue', { date }) : t('workOrders.table.rowDue', { date });
}

/**
 * The cell "Czekamy na" (EVM-034 AC1): the longest wait — "Stoen Operator (OSD) · od 15 dni" — with `triangle-alert` and the
 * colour of a warning above 14 days (the icon and a hidden sentence carry the meaning), and "+n" for the other waits. An order
 * that waits for nobody shows a dash with a hidden "Brak oczekiwań".
 */
export function WaitingCell({ waiting }: { readonly waiting: WorkOrderWaiting | null | undefined }) {
  const { t } = useTranslation();
  if (waiting === null || waiting === undefined) return <Dash hidden={t('workOrders.waiting.none')} />;
  const long = isLongWait(waiting.days);
  // Inline flow, not flex: the text wraps and the icon and "+n" stay at the end of its last line.
  return (
    <span className={long ? 'text-text-warning' : ''}>
      <span className="medium:hidden">{t('workOrders.waiting.prefixWaiting')} </span>
      <span className="wrap-anywhere">
        {t('workOrders.waiting.line', { who: waitingWho(t, waiting), since: sinceText(t, waiting.days) })}
      </span>
      {long ? <TriangleAlert aria-hidden="true" className="ms-inline-xs inline-block size-icon-sm align-text-bottom" /> : null}
      {long ? <span className="sr-only">{t('workOrder.stage.longWait')}</span> : null}
      {waiting.otherCount > 0 ? (
        <span className="ms-inline-xs text-text-secondary">
          <span aria-hidden="true">{t('workOrders.waiting.others', { count: waiting.otherCount })}</span>
          <span className="sr-only">{othersText(t, waiting.otherCount)}</span>
        </span>
      ) : null}
    </span>
  );
}

/**
 * The cell "Termin" (EVM-034 AC4): the nearest due date of an unfinished stage; `alarm-clock` and the colour of an error when it
 * has passed (the server says so with `hasOverdueStage`, the panel never compares dates).
 */
export function DueCell({
  item,
  labelled = false,
}: {
  readonly item: Pick<WorkOrderListItem, 'nextDueDate' | 'hasOverdueStage'>;
  /** The line inside the first cell (below `expanded`): the prefix "Termin:" always shown, the text may wrap. */
  readonly labelled?: boolean;
}) {
  const { t } = useTranslation();
  const day = item.nextDueDate;
  if (day === null || day === undefined) return <Dash hidden={t('workOrders.waiting.noDue')} />;
  const prefix = <span className={labelled ? '' : 'medium:hidden'}>{t('workOrders.waiting.prefixDue')}</span>;
  const layout = labelled ? 'wrap-anywhere' : 'whitespace-nowrap';
  if (item.hasOverdueStage !== true) {
    return (
      <span className={`inline-flex items-center gap-inline-xs ${layout}`}>
        {prefix}
        <span>{formatDueDate(day)}</span>
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-inline-xs ${layout} text-text-error`}>
      {prefix}
      <AlarmClock aria-hidden="true" className="size-icon-sm shrink-0" />
      <span>{formatDueDate(day)}</span>
      <span className="sr-only">{t('workOrders.waiting.overdue')}</span>
    </span>
  );
}

function Dash({ hidden }: { readonly hidden: string }) {
  const { t } = useTranslation();
  return (
    <span className="text-text-secondary max-medium:hidden">
      <span aria-hidden="true">{t('workOrders.waiting.dash')}</span>
      <span className="sr-only">{hidden}</span>
    </span>
  );
}
