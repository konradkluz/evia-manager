import type { ProcedureList, ScopeItem, ScopeItemList, WorkOrderDetails } from '@evia/contracts';
import { ActionMenu, Button, EllipsisVertical, IconButton, List, ListItem, Plus, StatusBadge } from '@evia/ui-web';
import type { UseQueryResult } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { describeParameters } from '../i18n/parameter-labels.ts';
import { useSession } from '../session/session.ts';
import { useOnline } from '../shell/use-online.ts';
import { useStateWord } from './edit-failure.ts';
import { ScopeAddDialog, SCOPE_ITEMS_MAX } from './scope-add-dialog.tsx';
import { ScopeEditDialog, editVariantOf } from './scope-edit-dialog.tsx';
import { ScopeRemoveDialog } from './scope-remove-dialog.tsx';
import { SectionError, SectionLoading } from './section-states.tsx';
import { useItemsText } from './template-section.tsx';
import { isClosed } from './transition-actions.ts';

type Dialog = { readonly kind: 'add' } | { readonly kind: 'edit' | 'remove'; readonly itemId: string; readonly index: number };

/**
 * The section "Zakres (9 pozycji)" of W-06 (EVM-018 AC2, AC7; EVM-035 AC2–AC6, AC8): every item with its name and its technical
 * parameters in Polish ("AC, 11 kW, 3 fazy"). A set, a key or a value this panel does not know is the badge of an unknown value
 * (P-12) — the raw value is never shown. Names and notes are free text and are rendered as React text.
 *
 * "Edytuj zakres" (Administrator and Editor; Tylko odczyt does not see it) switches the section into the mode of editing: "Dodaj
 * pozycję…" and the menu of every item ("Edytuj parametry…", "Usuń pozycję…") open dialogs, every operation is saved at once with
 * its own request. The actions are disabled with a reason for a closed order (PO-8), at the limit of 50 items and offline; the
 * server decides all the same. The state of the mode lives in this tab only.
 */
export function ScopeSection({
  order,
  query,
  procedures,
}: {
  readonly order: WorkOrderDetails;
  readonly query: UseQueryResult<ScopeItemList>;
  readonly procedures: UseQueryResult<ProcedureList>;
}) {
  const { t } = useTranslation();
  const itemsText = useItemsText();
  const online = useOnline();
  const role = useSession().data?.user.role;
  const stateWord = useStateWord();
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [removed, setRemoved] = useState<{ readonly index: number; readonly itemId: string } | null>(null);
  const [leaving, setLeaving] = useState(false);
  const items = query.data?.items;
  const canEdit = role === 'administrator' || role === 'editor';
  const closed = isClosed(order.status);
  const atLimit = items !== undefined && items.length >= SCOPE_ITEMS_MAX;
  const state = stateWord(order.status);
  const closedHint = role === 'editor' ? t('workOrder.scope.closedHintEditor', { state }) : t('workOrder.scope.closedHint', { state });
  // A reason, in the order of § 4.13: the closed order first, then the connection, then the limit.
  const reason = closed ? closedHint : online ? undefined : t('workOrder.scope.offlineHint');
  const addReason = reason ?? (atLimit ? t('workOrder.scope.limit', { max: SCOPE_ITEMS_MAX }) : undefined);

  // The focus follows the mode: the heading "Zakres — edycja" when it opens, "Edytuj zakres" when it closes (WCAG 2.4.3).
  useEffect(() => {
    if (editing) heading.current?.focus();
  }, [editing]);
  useEffect(() => {
    if (!leaving) return;
    setLeaving(false);
    editButton.current?.focus();
  }, [leaving, editing]);
  // After an item was removed the focus goes to the menu of the item that took its place, or to the heading — once the list
  // no longer holds the removed item (the answer of the reading may arrive before the list is drawn again).
  useEffect(() => {
    if (removed === null || items === undefined || items.some((entry) => entry.id === removed.itemId)) return;
    const triggers = list.current?.querySelectorAll<HTMLElement>('button[aria-haspopup="menu"]');
    if (triggers === undefined || triggers.length === 0) heading.current?.focus();
    else triggers.item(Math.min(removed.index, triggers.length - 1)).focus();
    setRemoved(null);
  }, [removed, items]);

  const edited = dialog?.kind === 'add' || dialog === null ? undefined : items?.find((entry) => entry.id === dialog.itemId);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-stack-md">
      <div className="flex flex-wrap items-center justify-between gap-inline-md">
        <h2
          id={headingId}
          ref={heading}
          tabIndex={editing ? -1 : undefined}
          className="text-heading-3 text-text-primary focus-visible:focus-ring"
        >
          {items === undefined
            ? t('workOrder.scope.title')
            : editing
              ? t('workOrder.scope.editHeading', { items: itemsText(items.length) })
              : t('workOrder.scope.heading', { items: itemsText(items.length) })}
        </h2>
        {!canEdit || items === undefined ? null : editing ? (
          <div className="flex flex-wrap items-center gap-inline-sm">
            <Button
              variant="secondary"
              icon={Plus}
              disabled={addReason !== undefined}
              {...(addReason === undefined ? {} : { title: addReason })}
              onClick={() => {
                setDialog({ kind: 'add' });
              }}
            >
              {t('workOrder.scope.add')}
            </Button>
            <Button
              variant="tertiary"
              onClick={() => {
                setEditing(false);
                setLeaving(true);
              }}
            >
              {t('workOrder.scope.finish')}
            </Button>
          </div>
        ) : (
          <Button
            ref={editButton}
            variant="secondary"
            disabled={reason !== undefined}
            {...(reason === undefined ? {} : { title: reason })}
            onClick={() => {
              setEditing(true);
            }}
          >
            {t('workOrder.scope.edit')}
          </Button>
        )}
      </div>
      {editing && items !== undefined ? <p className="text-body-sm text-text-secondary">{t('workOrder.scope.editInfo')}</p> : null}
      {items !== undefined ? (
        items.length === 0 ? (
          <p className="text-body text-text-secondary">{t('workOrder.scope.empty')}</p>
        ) : (
          <div ref={list}>
            <List labelledBy={headingId}>
              {items.map((item, index) => (
                <ListItem key={item.id}>
                  <div className="flex flex-wrap items-start justify-between gap-inline-md">
                    <div className="flex min-w-0 flex-col gap-stack-xs">
                      <ScopeLine item={item} editing={editing} />
                    </div>
                    {editing ? (
                      <ActionMenu
                        label={t('workOrder.scope.menuLabel', { name: item.name })}
                        items={[
                          {
                            id: 'edit',
                            label: itemEditLabel(t, item),
                            onSelect: () => {
                              setDialog({ kind: 'edit', itemId: item.id, index });
                            },
                            ...(reason === undefined ? {} : { disabledHint: reason }),
                          },
                          {
                            id: 'remove',
                            label: t('workOrder.scope.remove'),
                            onSelect: () => {
                              setDialog({ kind: 'remove', itemId: item.id, index });
                            },
                            ...(reason === undefined ? {} : { disabledHint: reason }),
                          },
                        ]}
                        trigger={(props) => (
                          <IconButton {...props} icon={EllipsisVertical} label={t('workOrder.scope.menuLabel', { name: item.name })} />
                        )}
                      />
                    ) : null}
                  </div>
                </ListItem>
              ))}
            </List>
          </div>
        )
      ) : query.isError ? (
        <SectionError
          message={t('workOrder.scope.error')}
          retryLabel={t('workOrder.scope.retry')}
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : (
        <SectionLoading lines={4} />
      )}
      {dialog?.kind === 'add' ? (
        <ScopeAddDialog
          order={order}
          onClose={() => {
            setDialog(null);
          }}
        />
      ) : null}
      {dialog?.kind === 'edit' && edited !== undefined ? (
        <ScopeEditDialog
          key={edited.id}
          order={order}
          item={edited}
          onClose={() => {
            setDialog(null);
          }}
        />
      ) : null}
      {dialog?.kind === 'remove' && edited !== undefined ? (
        <ScopeRemoveDialog
          key={edited.id}
          order={order}
          item={edited}
          procedures={procedures.data}
          onClose={() => {
            setDialog(null);
          }}
          onRemoved={() => {
            setRemoved({ index: dialog.index, itemId: dialog.itemId });
          }}
        />
      ) : null}
    </section>
  );
}

function itemEditLabel(t: TFunction, item: ScopeItem): string {
  switch (editVariantOf(item)) {
    case 'parameters':
      return t('workOrder.scope.editParameters');
    case 'notes':
      return t('workOrder.scope.editNotes');
    case 'description':
      return t('workOrder.scope.editDescription');
  }
}

function ScopeLine({ item, editing }: { readonly item: ScopeItem; readonly editing: boolean }) {
  const { t } = useTranslation();
  const parts = describeParameters(item.parameterSetCode, item.parameters);
  const text = parts.flatMap((part) => (part.kind === 'text' ? [part.text] : [])).join(', ');
  const unknown = parts.some((part) => part.kind === 'unknown');
  const bare = parts.length === 0 && item.quantity === 1;
  return (
    <>
      <span className="break-words text-body text-text-primary">{item.name}</span>
      {bare && !editing ? null : (
        <span className="flex flex-wrap items-center gap-inline-sm text-body-sm text-text-secondary">
          {text === '' ? null : <span className="break-words">{text}</span>}
          {bare && text === '' ? <span>{t('workOrder.scope.noParameters')}</span> : null}
          {unknown ? (
            <StatusBadge status="unknown" label={t('workOrders.status.unknown')} hint={t('workOrders.status.unknownHint')} />
          ) : null}
          {item.quantity === 1 ? null : <span>{t('workOrder.scope.quantity', { value: item.quantity })}</span>}
        </span>
      )}
      {item.notes === undefined ? null : (
        <span className="whitespace-pre-line break-words text-body-sm text-text-secondary">
          {t('workOrder.scope.notes', { notes: item.notes })}
        </span>
      )}
    </>
  );
}
