import type { Procedure, ProcedureList, ProcedureStage } from '@evia/contracts';
import { AlarmClock, Button, Card, InlineAlert, Skeleton, StatusBadge } from '@evia/ui-web';
import type { UseQueryResult } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { stageStatusLabels } from '../i18n/procedure-labels.ts';
import { ErrorBoundary } from '../shell/error-boundary.tsx';
import { formatDueDate, stageStatusKey } from './procedure-format.ts';
import { StageFacts } from './stage-facts.tsx';

/** At most this many processes are named in "Na jakim etapie"; the rest is "+ n procesów" (EVM-034 AC5). */
export const SUMMARY_PROCESSES = 3;

/** Stages that are not finished (`todo`, `in_progress`, `waiting`, `blocked`) — the "open" stages of the due dates and of the current stage. */
const isUnfinished = (stage: ProcedureStage): boolean => stage.status !== 'done' && stage.status !== 'not_applicable';

/**
 * The current stage of a process: `currentStageId` of the server (the first unfinished stage by `position`); an answer of an older
 * server without the field is read by the same rule. `undefined` — nothing is left to do in the process.
 */
export function currentStageOf(procedure: Procedure): ProcedureStage | undefined {
  if (procedure.currentStageId === undefined) return procedure.stages.find(isUnfinished);
  return procedure.currentStageId === null ? undefined : procedure.stages.find((stage) => stage.id === procedure.currentStageId);
}

/** "+ 6 procesów": the declension of § 6.3 (1 proces, 2–4 procesy, 5+ procesów; 12–14 are "procesów"). */
function moreText(t: TFunction, count: number): string {
  const last = count % 10;
  const tens = count % 100;
  if (count === 1) return t('workOrder.summary.moreOne', { count });
  if (last >= 2 && last <= 4 && (tens < 12 || tens > 14)) return t('workOrder.summary.moreFew', { count });
  return t('workOrder.summary.moreMany', { count });
}

/** The days of a wait, longest first; a wait without a counted number goes last, the order of the processes and stages is kept. */
const byLongestWait = (a: ProcedureStage, b: ProcedureStage): number => (b.waitingDays ?? -1) - (a.waitingDays ?? -1);

/**
 * The card "Podsumowanie" of W-06 (EVM-034 AC5; flows/03): three tiles put together from the processes of the order — "Na jakim
 * etapie" (the current stage of at most three processes and "+ n procesów"), "Na kogo czekamy" (every wait, the longest first, no
 * empty rows) and "Terminy" (the nearest due date and the stages after it). The tile "Płatności" arrives with EVM-056. The numbers
 * of days and the overdue flag are the server's; the panel only orders and words them. Every tile has its own state of an error:
 * one failing tile leaves the others working. Names are free text: React text only (SR-WEB-03).
 */
export function OrderSummary({
  query,
  onShowProcesses,
}: {
  readonly query: UseQueryResult<ProcedureList>;
  /** "+ 6 procesów" leads to the section "Procesy i etapy" (the page opens its tab and moves the focus there). */
  readonly onShowProcesses: () => void;
}) {
  const { t } = useTranslation();
  const headingId = useId();
  const items = query.data?.items;
  return (
    <Card labelledBy={headingId}>
      <h2 id={headingId} className="text-heading-3 text-text-primary">
        {t('workOrder.summary.title')}
        <span className="sr-only"> {t('workOrder.summary.titleSuffix')}</span>
      </h2>
      <div className="grid grid-cols-1 gap-stack-md expanded:grid-cols-3">
        <Tile title={t('workOrder.summary.stageTile')} query={query}>
          {items === undefined ? null : <StageTile items={items} onShowProcesses={onShowProcesses} />}
        </Tile>
        <Tile title={t('workOrder.summary.waitingTile')} query={query}>
          {items === undefined ? null : <WaitingTile items={items} />}
        </Tile>
        <Tile title={t('workOrder.summary.dueTile')} query={query}>
          {items === undefined ? null : <DueTile items={items} />}
        </Tile>
      </div>
    </Card>
  );
}

/** One tile: a heading, and the content, a skeleton while it loads or an alert with its own retry; a rendering fault stays in the tile. */
function Tile({
  title,
  query,
  children,
}: {
  readonly title: string;
  readonly query: UseQueryResult<ProcedureList>;
  readonly children: ReactNode;
}) {
  const { t } = useTranslation();
  const headingId = useId();
  const failedAlert = (
    <InlineAlert
      tone="error"
      action={
        <Button
          variant="secondary"
          onClick={() => {
            void query.refetch();
          }}
        >
          {t('workOrder.summary.retry')}
        </Button>
      }
    >
      {t('workOrder.summary.error')}
    </InlineAlert>
  );
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-stack-sm p-inset-md rounded-card bg-bg-surface-subtle">
      <h3 id={headingId} className="text-heading-4 text-text-primary">
        {title}
      </h3>
      {query.data !== undefined ? (
        <ErrorBoundary fallback={failedAlert}>{children}</ErrorBoundary>
      ) : query.isError ? (
        failedAlert
      ) : (
        <div aria-busy="true" className="flex flex-col gap-stack-xs">
          <p role="status" className="sr-only">
            {t('workOrder.loading.section')}
          </p>
          <Skeleton />
        </div>
      )}
    </section>
  );
}

/** "Na jakim etapie": the current stage with its badge for each process that has one, three processes at most. */
function StageTile({ items, onShowProcesses }: { readonly items: readonly Procedure[]; readonly onShowProcesses: () => void }) {
  const { t } = useTranslation();
  if (items.length === 0) return <p className="text-body text-text-secondary">{t('workOrder.summary.noProcesses')}</p>;
  const current = items.flatMap((procedure) => {
    const stage = currentStageOf(procedure);
    return stage === undefined ? [] : [{ procedure, stage }];
  });
  if (current.length === 0) return <p className="text-body text-text-secondary">{t('workOrder.summary.allDone')}</p>;
  const shown = current.slice(0, SUMMARY_PROCESSES);
  const rest = current.length - shown.length;
  return (
    <>
      <ul className="flex flex-col gap-stack-sm">
        {shown.map(({ procedure, stage }) => {
          const key = stageStatusKey(stage.status);
          return (
            <li key={procedure.id} className="flex flex-col gap-stack-xs">
              <span className="break-words text-label text-text-secondary">{procedure.name}</span>
              <span className="flex flex-wrap items-center gap-inline-sm">
                <span className="break-words text-body text-text-primary">{stage.name}</span>
                {key === undefined ? (
                  <StatusBadge status="unknown" label={t('workOrders.status.unknown')} hint={t('workOrders.status.unknownHint')} />
                ) : (
                  <StatusBadge status={key} group="stage" label={stageStatusLabels[stage.status]} />
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {rest > 0 ? (
        <Button variant="tertiary" onClick={onShowProcesses}>
          {moreText(t, rest)}
        </Button>
      ) : null}
    </>
  );
}

/** "Na kogo czekamy": only the waits that exist, the longest first; nobody — "Piłka po naszej stronie…". */
function WaitingTile({ items }: { readonly items: readonly Procedure[] }) {
  const { t } = useTranslation();
  const waits = items
    .flatMap((procedure) => procedure.stages)
    .filter((stage) => stage.status === 'waiting' && stage.waitingOn !== null)
    .toSorted(byLongestWait);
  if (waits.length === 0) return <p className="text-body text-text-secondary">{t('workOrder.summary.nobody')}</p>;
  return (
    <ul className="flex flex-col gap-stack-xs">
      {waits.map((stage) => (
        <li key={stage.id}>
          <StageFacts stage={stage} />
        </li>
      ))}
    </ul>
  );
}

/** "Terminy": the nearest due date of an unfinished stage and the stages whose date has passed (`alarm-clock`, never colour alone). */
function DueTile({ items }: { readonly items: readonly Procedure[] }) {
  const { t } = useTranslation();
  const open = items.flatMap((procedure) => procedure.stages).filter((stage) => isUnfinished(stage) && stage.dueDate !== null);
  const overdue = open.filter((stage) => stage.overdue);
  const coming = open.filter((stage) => !stage.overdue).toSorted((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  const next = coming[0];
  return (
    <div className="flex flex-col gap-stack-sm">
      <p className="text-body text-text-primary">
        {next?.dueDate == null
          ? t('workOrder.summary.nextNone')
          : t('workOrder.summary.next', { date: formatDueDate(next.dueDate), stage: next.name })}
      </p>
      {overdue.length === 0 ? (
        <p className="text-body text-text-primary">{t('workOrder.summary.overdueNone')}</p>
      ) : (
        <>
          <p className="text-label text-text-secondary">{t('workOrder.summary.overdueLabel')}</p>
          <ul className="flex flex-col gap-stack-xs">
            {overdue.map((stage) => (
              <li key={stage.id} className="inline-flex items-start gap-inline-xs text-body text-text-error">
                <AlarmClock aria-hidden="true" className="size-icon-sm shrink-0" />
                <span className="break-words">
                  {t('workOrder.summary.overdueItem', { stage: stage.name, date: formatDueDate(stage.dueDate ?? '') })}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
