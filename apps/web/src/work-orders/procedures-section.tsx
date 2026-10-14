import type { Procedure, ProcedureList, ProcedureStage, WorkOrderDetails } from '@evia/contracts';
import {
  ActionMenu,
  AlarmClock,
  Button,
  Disclosure,
  EllipsisVertical,
  IconButton,
  List,
  ListItem,
  Plus,
  ProcedureProgress,
} from '@evia/ui-web';
import type { UseQueryResult } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../session/session.ts';
import { useOnline } from '../shell/use-online.ts';
import { DeletedProcedures } from './deleted-procedures.tsx';
import { ProcedureAddDialog } from './procedure-add-dialog.tsx';
import { formatDueDate } from './procedure-format.ts';
import { PROCEDURES_MAX, STAGES_MAX } from './procedure-manage.ts';
import { ProcedureRemoveDialog } from './procedure-remove-dialog.tsx';
import { SectionError, SectionLoading } from './section-states.tsx';
import { StageAddDialog } from './stage-add-dialog.tsx';
import { StageFacts } from './stage-facts.tsx';
import { StageEditDialog } from './stage-edit-dialog.tsx';
import { StageRemoveDialog } from './stage-remove-dialog.tsx';
import { StageStatusControl } from './stage-status-control.tsx';
import { isClosed } from './transition-actions.ts';
import { useDeletedProcedures } from './use-work-order.ts';

/** The heading of the section: the target of "+ 6 procesów" in the summary (EVM-034 AC5). */
export const PROCEDURES_HEADING_ID = 'order-procedures-heading';

/** What the person is doing with the section: one dialog at a time. The object is a snapshot, so a dialog survives a refresh. */
type Dialog =
  | { readonly kind: 'addProcedure' }
  | { readonly kind: 'addStage'; readonly procedure: Procedure }
  | { readonly kind: 'removeProcedure'; readonly procedure: Procedure; readonly index: number }
  | { readonly kind: 'removeStage'; readonly procedure: Procedure; readonly stage: ProcedureStage; readonly index: number };

/** Where the focus goes once the list shows the result of an operation (§ W-06 (d), "Fokus"). */
type FocusRequest =
  | { readonly kind: 'procedure'; readonly id: string }
  | { readonly kind: 'stage'; readonly id: string }
  | { readonly kind: 'afterStageRemoved'; readonly procedureId: string; readonly stageId: string; readonly index: number }
  | { readonly kind: 'afterProcedureRemoved'; readonly procedureId: string; readonly index: number };

const findByData = (root: ParentNode, attribute: 'procedureId' | 'stageId', value: string): HTMLElement | undefined =>
  Array.from(root.querySelectorAll<HTMLElement>(attribute === 'procedureId' ? '[data-procedure-id]' : '[data-stage-id]')).find(
    (element) => element.dataset[attribute] === value,
  );

/**
 * The section "Procesy i etapy (9)" of W-06 (EVM-031 AC2, AC3, AC5, AC8; EVM-042): every process is a Disclosure with its progress ("3 z 7
 * etapów", "Wszystkie zakończone") in the header, "Rozwiń wszystkie" opens or closes all of them, and a stage shows the name, the
 * status (the menu of transitions of W-07), the due date ("po terminie" with `alarm-clock` when the server says so) and "Osoba
 * odpowiedzialna". Administrator and Editor change the person and the date from the menu of the stage, add a process ("Dodaj
 * proces…") or a stage ("Dodaj etap…" in the menu of the process) and remove them ("Usuń proces…", "Usuń etap…"); the Administrator
 * restores them in "Usunięte procesy i etapy" at the end. Tylko odczyt gets no menu. The actions are disabled with a reason for a
 * closed order (PO-8), at the limit of 30 and offline — the server decides all the same. Names of processes, stages and people are
 * free text of the catalogue and of the accounts: React text only (SR-WEB-03).
 */
export function ProceduresSection({ order, query }: { readonly order: WorkOrderDetails; readonly query: UseQueryResult<ProcedureList> }) {
  const { t } = useTranslation();
  const online = useOnline();
  const role = useSession().data?.user.role;
  const headingId = PROCEDURES_HEADING_ID;
  const section = useRef<HTMLElement>(null);
  const items = query.data?.items;
  // Nothing is open by choice until the person chooses: the first process is, as in the mockup (the state is the memory of this tab).
  const [opened, setOpened] = useState<ReadonlySet<string> | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const expanded: ReadonlySet<string> = opened ?? new Set(items?.[0] === undefined ? [] : [items[0].id]);
  const allOpen = items !== undefined && items.length > 0 && items.every((procedure) => expanded.has(procedure.id));
  const editedStage = items?.flatMap((procedure) => procedure.stages).find((stage) => stage.id === editing);
  const canEdit = role === 'administrator' || role === 'editor';
  const deleted = useDeletedProcedures(order.id, role === 'administrator');

  const closed = isClosed(order.status);
  // The reason an action is not available, in the order of § 4.13: the closed order, then the connection.
  const reason = closed ? t('workOrder.procedures.closedHint') : online ? undefined : t('workOrder.procedures.offlineHint');
  const addProcedureReason =
    reason ??
    (items !== undefined && items.length >= PROCEDURES_MAX
      ? t('workOrder.procedureManage.limitProcedures', { max: PROCEDURES_MAX })
      : undefined);

  const open = (...ids: string[]) => {
    setOpened(new Set([...expanded, ...ids]));
  };

  // The focus follows the result once the list holds it (the answer of the reading may arrive before the list is drawn again).
  useEffect(() => {
    const root = section.current;
    if (focus === null || items === undefined || root === null) return;
    if (focus.kind === 'procedure') {
      const holder = findByData(root, 'procedureId', focus.id);
      if (holder === undefined) return;
      holder.querySelector<HTMLElement>('h3 button')?.focus();
    } else if (focus.kind === 'stage') {
      const holder = findByData(root, 'stageId', focus.id);
      if (holder === undefined) return;
      // The first button of the row is the badge of the status (a static badge, for a status this panel does not know, has none).
      holder.querySelector<HTMLElement>('button')?.focus();
    } else if (focus.kind === 'afterStageRemoved') {
      const procedure = items.find((entry) => entry.id === focus.procedureId);
      if (procedure?.stages.some((stage) => stage.id === focus.stageId) === true) return;
      const block = findByData(root, 'procedureId', focus.procedureId);
      const triggers = block?.querySelectorAll<HTMLElement>('[data-menu="stage"]');
      if (triggers !== undefined && triggers.length > 0) triggers.item(Math.min(focus.index, triggers.length - 1)).focus();
      else (block?.querySelector<HTMLElement>('h3 button') ?? document.getElementById(headingId))?.focus();
    } else {
      if (items.some((entry) => entry.id === focus.procedureId)) return;
      const triggers = root.querySelectorAll<HTMLElement>('[data-menu="procedure"]');
      if (triggers.length > 0) triggers.item(Math.min(focus.index, triggers.length - 1)).focus();
      else document.getElementById(headingId)?.focus();
    }
    setFocus(null);
  }, [focus, items, headingId]);

  return (
    <section ref={section} aria-labelledby={headingId} className="flex flex-col gap-stack-md">
      <div className="flex flex-wrap items-center justify-between gap-inline-md">
        <h2 id={headingId} tabIndex={-1} className="text-heading-3 text-text-primary focus-visible:focus-ring">
          {items === undefined ? t('workOrder.procedures.title') : t('workOrder.procedures.heading', { count: items.length })}
        </h2>
        {items === undefined ? null : (
          <div className="flex flex-wrap items-center gap-inline-sm">
            {canEdit ? (
              <Button
                variant="secondary"
                icon={Plus}
                disabled={addProcedureReason !== undefined}
                {...(addProcedureReason === undefined ? {} : { title: addProcedureReason })}
                onClick={() => {
                  setDialog({ kind: 'addProcedure' });
                }}
              >
                {t('workOrder.procedureManage.add')}
              </Button>
            ) : null}
            {items.length === 0 ? null : (
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
        )}
      </div>
      {items !== undefined ? (
        items.length === 0 ? (
          <p className="text-body text-text-secondary">{t('workOrder.procedures.empty')}</p>
        ) : (
          <div className="flex flex-col">
            {items.map((procedure, index) => (
              <ProcedureBlock
                key={procedure.id}
                procedure={procedure}
                expanded={expanded.has(procedure.id)}
                onExpandedChange={(isOpen) => {
                  const next = new Set(expanded);
                  if (isOpen) next.add(procedure.id);
                  else next.delete(procedure.id);
                  setOpened(next);
                }}
                order={order}
                reason={reason}
                onEdit={setEditing}
                onAddStage={() => {
                  setDialog({ kind: 'addStage', procedure });
                }}
                onRemoveProcedure={() => {
                  setDialog({ kind: 'removeProcedure', procedure, index });
                }}
                onRemoveStage={(stage, stageIndex) => {
                  setDialog({ kind: 'removeStage', procedure, stage, index: stageIndex });
                }}
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
      {role === 'administrator' && items !== undefined ? (
        <DeletedProcedures
          order={order}
          query={deleted}
          onRestored={(kind, id, parentId) => {
            if (parentId !== undefined) open(parentId);
            if (kind === 'procedure') open(id);
            setFocus({ kind: kind === 'procedure' ? 'procedure' : 'stage', id });
          }}
        />
      ) : null}
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
      {dialog?.kind === 'addProcedure' ? (
        <ProcedureAddDialog
          order={order}
          procedures={items ?? []}
          onClose={() => {
            setDialog(null);
          }}
          onAdded={(id) => {
            open(id);
            setFocus({ kind: 'procedure', id });
          }}
        />
      ) : null}
      {dialog?.kind === 'addStage' ? (
        <StageAddDialog
          order={order}
          procedure={items?.find((entry) => entry.id === dialog.procedure.id) ?? dialog.procedure}
          onClose={() => {
            setDialog(null);
          }}
          onAdded={(id) => {
            open(dialog.procedure.id);
            setFocus({ kind: 'stage', id });
          }}
        />
      ) : null}
      {dialog?.kind === 'removeProcedure' ? (
        <ProcedureRemoveDialog
          order={order}
          procedure={items?.find((entry) => entry.id === dialog.procedure.id) ?? dialog.procedure}
          onClose={() => {
            setDialog(null);
          }}
          onRemoved={() => {
            setFocus({ kind: 'afterProcedureRemoved', procedureId: dialog.procedure.id, index: dialog.index });
          }}
        />
      ) : null}
      {dialog?.kind === 'removeStage' ? (
        <StageRemoveDialog
          order={order}
          procedure={items?.find((entry) => entry.id === dialog.procedure.id) ?? dialog.procedure}
          stage={
            items?.find((entry) => entry.id === dialog.procedure.id)?.stages.find((entry) => entry.id === dialog.stage.id) ?? dialog.stage
          }
          onClose={() => {
            setDialog(null);
          }}
          onRemoved={() => {
            setFocus({ kind: 'afterStageRemoved', procedureId: dialog.procedure.id, stageId: dialog.stage.id, index: dialog.index });
          }}
          onMarked={(id) => {
            setFocus({ kind: 'stage', id });
          }}
        />
      ) : null}
    </section>
  );
}

function ProcedureBlock({
  procedure,
  expanded,
  onExpandedChange,
  order,
  reason,
  onEdit,
  onAddStage,
  onRemoveProcedure,
  onRemoveStage,
}: {
  readonly procedure: Procedure;
  readonly expanded: boolean;
  readonly onExpandedChange: (open: boolean) => void;
  readonly order: WorkOrderDetails;
  /** Why the actions are not available (closed order, offline) or `undefined`. */
  readonly reason: string | undefined;
  readonly onEdit: (stageId: string) => void;
  readonly onAddStage: () => void;
  readonly onRemoveProcedure: () => void;
  readonly onRemoveStage: (stage: ProcedureStage, index: number) => void;
}) {
  const { t } = useTranslation();
  const role = useSession().data?.user.role;
  const { done, total } = procedure.progress;
  let text: string = t('workOrder.procedures.notApplicable');
  if (total === 1) text = t('workOrder.procedures.progressOne', { done, total });
  else if (total > 1) text = t('workOrder.procedures.progressMany', { done, total });
  const addStageReason =
    reason ?? (procedure.stages.length >= STAGES_MAX ? t('workOrder.procedureManage.limitStages', { max: STAGES_MAX }) : undefined);
  const label = t('workOrder.procedureManage.menuLabel', { name: procedure.name });
  return (
    <div data-procedure-id={procedure.id}>
      <Disclosure
        title={procedure.name}
        expanded={expanded}
        onExpandedChange={onExpandedChange}
        summary={
          procedure.stages.length === 0 ? undefined : (
            <ProcedureProgress done={done} total={total} text={text} completeText={t('workOrder.procedures.allDone')} />
          )
        }
        {...(role === 'administrator' || role === 'editor'
          ? {
              actions: (
                <ActionMenu
                  label={label}
                  items={[
                    {
                      id: 'add-stage',
                      label: t('workOrder.procedureManage.menuAddStage'),
                      onSelect: onAddStage,
                      ...(addStageReason === undefined ? {} : { disabledHint: addStageReason }),
                    },
                    {
                      id: 'remove-procedure',
                      label: t('workOrder.procedureManage.menuRemoveProcedure'),
                      onSelect: onRemoveProcedure,
                      ...(reason === undefined ? {} : { disabledHint: reason }),
                    },
                  ]}
                  trigger={(props) => <IconButton {...props} data-menu="procedure" icon={EllipsisVertical} label={label} />}
                />
              ),
            }
          : {})}
      >
        {procedure.stages.length === 0 ? (
          <p className="text-body text-text-secondary">{t('workOrder.procedures.noStages')}</p>
        ) : (
          <List label={procedure.name}>
            {procedure.stages.map((stage, index) => (
              <ListItem key={stage.id}>
                <div data-stage-id={stage.id}>
                  <StageRow
                    stage={stage}
                    procedureCode={procedure.code}
                    order={order}
                    onEdit={onEdit}
                    onRemove={() => {
                      onRemoveStage(stage, index);
                    }}
                  />
                </div>
              </ListItem>
            ))}
          </List>
        )}
      </Disclosure>
    </div>
  );
}

function StageRow({
  stage,
  procedureCode,
  order,
  onEdit,
  onRemove,
}: {
  readonly stage: ProcedureStage;
  readonly procedureCode: string;
  readonly order: WorkOrderDetails;
  readonly onEdit: (stageId: string) => void;
  readonly onRemove: () => void;
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
          <StageStatusControl workOrderId={order.id} procedureCode={procedureCode} stage={stage} closed={closed} />
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
            {
              id: 'remove',
              label: t('workOrder.procedureManage.menuRemoveStage'),
              onSelect: onRemove,
              ...(disabledHint === undefined ? {} : { disabledHint }),
            },
          ]}
          trigger={(props) => (
            <IconButton
              {...props}
              data-menu="stage"
              icon={EllipsisVertical}
              label={t('workOrder.procedures.menuLabel', { name: stage.name })}
            />
          )}
        />
      ) : null}
    </div>
  );
}
