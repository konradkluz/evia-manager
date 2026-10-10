import type { Procedure, ProcedureList, ProcedureStage, WorkOrderDetails } from '@evia/contracts';
import { ActionMenu, AlarmClock, Button, Disclosure, EllipsisVertical, IconButton, List, ListItem, ProcedureProgress } from '@evia/ui-web';
import type { UseQueryResult } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../session/session.ts';
import { useOnline } from '../shell/use-online.ts';
import { formatDueDate } from './procedure-format.ts';
import { SectionError, SectionLoading } from './section-states.tsx';
import { StageFacts } from './stage-facts.tsx';
import { StageStatusControl } from './stage-status-control.tsx';
import { StageEditDialog } from './stage-edit-dialog.tsx';
import { isClosed } from './transition-actions.ts';

/**
 * The section "Procesy i etapy (9)" of W-06 (EVM-031 AC2, AC3, AC5, AC8): every process is a Disclosure with its progress ("3 z 7
 * etapów", "Wszystkie zakończone") in the header, "Rozwiń wszystkie" opens or closes all of them, and a stage shows the name, the
 * status (a static badge until EVM-032), the due date ("po terminie" with `alarm-clock` when the server says so) and "Osoba
 * odpowiedzialna". Administrator and Editor change the person and the date from the menu of the stage; Tylko odczyt gets no
 * menu. The menu is disabled with a reason for a closed order (PO-8) and offline — the server decides all the same. Names of
 * processes, stages and people are free text of the catalogue and of the accounts: React text only (SR-WEB-03).
 */
export function ProceduresSection({ order, query }: { readonly order: WorkOrderDetails; readonly query: UseQueryResult<ProcedureList> }) {
  const { t } = useTranslation();
  const headingId = useId();
  const items = query.data?.items;
  // Nothing is open by choice until the person chooses: the first process is, as in the mockup (the state is the memory of this tab).
  const [opened, setOpened] = useState<ReadonlySet<string> | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const expanded: ReadonlySet<string> = opened ?? new Set(items?.[0] === undefined ? [] : [items[0].id]);
  const allOpen = items !== undefined && items.length > 0 && items.every((procedure) => expanded.has(procedure.id));
  const editedStage = items?.flatMap((procedure) => procedure.stages).find((stage) => stage.id === editing);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-stack-md">
      <div className="flex flex-wrap items-center justify-between gap-inline-md">
        <h2 id={headingId} className="text-heading-3 text-text-primary">
          {items === undefined ? t('workOrder.procedures.title') : t('workOrder.procedures.heading', { count: items.length })}
        </h2>
        {items === undefined || items.length === 0 ? null : (
          <Button
            variant="tertiary"
            onClick={() => {
              setOpened(allOpen ? new Set() : new Set(items.map((procedure) => procedure.id)));
            }}
          >
            {allOpen ? t('workOrder.procedures.collapseAll') : t('workOrder.procedures.expandAll')}
          </Button>
        )}
      </div>
      {items !== undefined ? (
        items.length === 0 ? (
          <p className="text-body text-text-secondary">{t('workOrder.procedures.empty')}</p>
        ) : (
          <div className="flex flex-col">
            {items.map((procedure) => (
              <ProcedureBlock
                key={procedure.id}
                procedure={procedure}
                expanded={expanded.has(procedure.id)}
                onExpandedChange={(open) => {
                  const next = new Set(expanded);
                  if (open) next.add(procedure.id);
                  else next.delete(procedure.id);
                  setOpened(next);
                }}
                order={order}
                onEdit={setEditing}
              />
            ))}
          </div>
        )
      ) : query.isError ? (
        <SectionError
          message={t('workOrder.procedures.error')}
          retryLabel={t('workOrder.procedures.retry')}
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : (
        <SectionLoading lines={4} />
      )}
      {editedStage === undefined ? null : (
        <StageEditDialog
          key={editedStage.id}
          workOrderId={order.id}
          stage={editedStage}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}

function ProcedureBlock({
  procedure,
  expanded,
  onExpandedChange,
  order,
  onEdit,
}: {
  readonly procedure: Procedure;
  readonly expanded: boolean;
  readonly onExpandedChange: (open: boolean) => void;
  readonly order: WorkOrderDetails;
  readonly onEdit: (stageId: string) => void;
}) {
  const { t } = useTranslation();
  const { done, total } = procedure.progress;
  let text: string = t('workOrder.procedures.notApplicable');
  if (total === 1) text = t('workOrder.procedures.progressOne', { done, total });
  else if (total > 1) text = t('workOrder.procedures.progressMany', { done, total });
  return (
    <Disclosure
      title={procedure.name}
      expanded={expanded}
      onExpandedChange={onExpandedChange}
      summary={
        procedure.stages.length === 0 ? undefined : (
          <ProcedureProgress done={done} total={total} text={text} completeText={t('workOrder.procedures.allDone')} />
        )
      }
    >
      {procedure.stages.length === 0 ? (
        <p className="text-body text-text-secondary">{t('workOrder.procedures.noStages')}</p>
      ) : (
        <List label={procedure.name}>
          {procedure.stages.map((stage) => (
            <ListItem key={stage.id}>
              <StageRow stage={stage} order={order} onEdit={onEdit} />
            </ListItem>
          ))}
        </List>
      )}
    </Disclosure>
  );
}

function StageRow({
  stage,
  order,
  onEdit,
}: {
  readonly stage: ProcedureStage;
  readonly order: WorkOrderDetails;
  readonly onEdit: (stageId: string) => void;
}) {
  const { t } = useTranslation();
  const online = useOnline();
  const role = useSession().data?.user.role;
  const closed = isClosed(order.status);
  // The disabled item explains why (§ 3.20, § 4.13): a closed order first, then the connection.
  const disabledHint = closed ? t('workOrder.procedures.closedHint') : online ? undefined : t('workOrder.procedures.offlineHint');
  return (
    <div className="flex flex-wrap items-start justify-between gap-inline-md">
      <div className="flex min-w-0 flex-col gap-stack-xs">
        <div className="flex flex-wrap items-center gap-inline-sm">
          <span className="text-text-secondary">{t('workOrder.procedures.stageNumber', { position: stage.position })}</span>
          <span className="break-words text-body text-text-primary">{stage.name}</span>
          <StageStatusControl workOrderId={order.id} stage={stage} closed={closed} />
        </div>
        <StageFacts stage={stage} />
        {stage.dueDate === null && stage.responsibleUser === null ? null : (
          <span className="flex flex-wrap items-center gap-inline-md text-body-sm text-text-secondary">
            {stage.dueDate === null ? null : stage.overdue ? (
              <span className="inline-flex items-center gap-inline-xs text-text-error">
                <AlarmClock aria-hidden="true" className="size-icon-sm shrink-0" />
                <span>{t('workOrder.procedures.dueDate', { date: formatDueDate(stage.dueDate) })}</span>
                <span>{t('workOrder.procedures.overdue')}</span>
              </span>
            ) : (
              <span>{t('workOrder.procedures.dueDate', { date: formatDueDate(stage.dueDate) })}</span>
            )}
            {stage.responsibleUser === null ? null : (
              <span className="break-words">{t('workOrder.procedures.responsible', { name: stage.responsibleUser.displayName })}</span>
            )}
          </span>
        )}
      </div>
      {role === 'administrator' || role === 'editor' ? (
        <ActionMenu
          label={t('workOrder.procedures.menuLabel', { name: stage.name })}
          items={[
            {
              id: 'edit',
              label: t('workOrder.procedures.edit'),
              onSelect: () => {
                onEdit(stage.id);
              },
              ...(disabledHint === undefined ? {} : { disabledHint }),
            },
          ]}
          trigger={(props) => (
            <IconButton {...props} icon={EllipsisVertical} label={t('workOrder.procedures.menuLabel', { name: stage.name })} />
          )}
        />
      ) : null}
    </div>
  );
}
