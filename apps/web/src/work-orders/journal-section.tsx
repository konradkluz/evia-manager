import type { ProcedureList, TimelineEntry, TimelineEntryInputKind, TimelineEventGroup, WorkOrderDetails } from '@evia/contracts';
import { Button, Card, FilterChip, InlineAlert, Select, Timeline, TimelineDay, type SelectGroup } from '@evia/ui-web';
import { useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../session/session.ts';
import { useNow } from '../shell/use-now.ts';
import { useOnline } from '../shell/use-online.ts';
import { JournalComposer } from './journal-composer.tsx';
import { JournalCorrectionDialog } from './journal-correction-dialog.tsx';
import { JournalEntry } from './journal-entry.tsx';
import { formatEntryDate, groupByDay, relationOf } from './journal-format.ts';
import { SectionError, SectionLoading } from './section-states.tsx';
import { WORK_ORDER_JOURNAL_KEY } from './query-keys.ts';
import { isBadJournalCursor, useJournal, type JournalFilters } from './use-journal.ts';

type KindFilter = TimelineEntryInputKind | null;

/** The stages of the order as groups of a Select, one group per process (the names are free text of the catalogue — React text only). */
function stageGroups(procedures: ProcedureList | undefined): SelectGroup[] {
  return (procedures?.items ?? [])
    .filter((procedure) => procedure.stages.length > 0)
    .map((procedure) => ({
      label: procedure.name,
      options: procedure.stages.map((stage) => ({ value: stage.id, label: stage.name })),
    }));
}

/**
 * The tab "Dziennik" of W-06 (W-08; EVM-037 AC1–AC8): the field of a new entry (Administrator and Editor only — Tylko odczyt
 * sees the timeline and the filters), the filters "Wszystko / Wpisy / Komentarze" and the stage, and the timeline: newest
 * first, grouped by the day of `Europe/Warsaw`, a page at a time ("Pokaż starsze"). The states of the section: loading (a
 * skeleton of three entries), an error with "Spróbuj ponownie", empty ("Brak wpisów. Dodaj pierwszą notatkę."), an empty
 * filter result with "Pokaż wszystko", offline (the field stays, the button is disabled with the reason).
 *
 * The journal is free text with personal data: the entries are read into the memory of the tab (`gcTime: 0`), the draft is
 * in `draft-store` and neither is ever in a store of the browser or in the address (SR-WEB-05, TM-10). The server decides
 * on permissions — hiding the field for Tylko odczyt is only convenience.
 */
export function JournalSection({
  order,
  procedures,
}: {
  readonly order: WorkOrderDetails;
  readonly procedures: UseQueryResult<ProcedureList>;
}) {
  const { t } = useTranslation();
  const headingId = useId();
  const role = useSession().data?.user.role;
  const canWrite = role === 'administrator' || role === 'editor';
  const online = useOnline();
  const nowMs = useNow(60_000);
  const [kind, setKind] = useState<KindFilter>(null);
  const [eventGroup, setEventGroup] = useState<TimelineEventGroup | null>(null);
  const [stageId, setStageId] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState<TimelineEntry | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [cursorReset, setCursorReset] = useState(false);
  const queryClient = useQueryClient();
  const filters: JournalFilters = { kind, stageId, eventGroup };
  const journal = useJournal(order.id, filters, true);
  const groups = useMemo(() => stageGroups(procedures.data), [procedures.data]);

  const entries = useMemo(() => journal.data?.pages.flatMap((page) => page.items) ?? [], [journal.data]);
  const byId = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);
  const days = useMemo(() => groupByDay(entries), [entries]);
  const filtered = kind !== null || stageId !== null || eventGroup !== null;

  // "Pokaż starsze" keeps the place of the reader and the focus: the button stays where it is (busy while it loads). Only when
  // the last page came and the button goes, the focus moves to the first entry that was loaded, which stands right below it.
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusId === null) return;
    list.current?.querySelector<HTMLElement>(`[data-entry-id="${CSS.escape(focusId)}"]`)?.focus({ preventScroll: true });
    setFocusId(null);
  }, [focusId, entries]);

  const loadOlder = () => {
    void journal.fetchNextPage().then((result) => {
      if (result.isError && isBadJournalCursor(result.error)) {
        // The cursor expired (30 minutes) or no longer fits: read the journal again from the first page and say so.
        setCursorReset(true);
        void queryClient.resetQueries({ queryKey: [WORK_ORDER_JOURNAL_KEY, order.id, kind, stageId, eventGroup] });
        return;
      }
      setCursorReset(false);
      const page = result.data?.pages.at(-1);
      if (result.isSuccess && !result.hasNextPage && page !== undefined) setFocusId(page.items[0]?.id ?? null);
    });
  };

  const resetFilters = () => {
    setKind(null);
    setEventGroup(null);
    setStageId(null);
  };

  // The kinds and the groups of automatic entries exclude each other (the server refuses both): one chip is chosen at a time.
  const choose = (nextKind: KindFilter, nextGroup: TimelineEventGroup | null) => {
    setKind(nextKind);
    setEventGroup(nextGroup);
  };

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-stack-md">
      <h2 id={headingId} className="text-heading-3 text-text-primary">
        {t('workOrder.journal.title')}
      </h2>
      {canWrite ? (
        <Card>
          <JournalComposer workOrderId={order.id} stageOptions={groups} />
        </Card>
      ) : null}
      <div className="flex flex-wrap items-end gap-x-inline-md gap-y-stack-sm">
        <div role="group" aria-label={t('workOrder.journal.filters.label')} className="flex flex-wrap items-center gap-inline-sm">
          <span aria-hidden="true" className="text-label text-text-primary">
            {t('workOrder.journal.filters.label')}
          </span>
          <FilterChip
            variant="choice"
            label={t('workOrder.journal.filters.all')}
            selected={kind === null && eventGroup === null}
            onClick={() => {
              choose(null, null);
            }}
          />
          <FilterChip
            variant="choice"
            label={t('workOrder.journal.filters.notes')}
            selected={kind === 'note' && eventGroup === null}
            onClick={() => {
              choose('note', null);
            }}
          />
          <FilterChip
            variant="choice"
            label={t('workOrder.journal.filters.comments')}
            selected={kind === 'comment' && eventGroup === null}
            onClick={() => {
              choose('comment', null);
            }}
          />
          <FilterChip
            variant="choice"
            label={t('workOrder.journal.filters.statusChanges')}
            selected={eventGroup === 'status_changes'}
            onClick={() => {
              choose(null, 'status_changes');
            }}
          />
          {/* EVM-054 AC3: the status changes of the instalments — a group of its own, disjoint from "Zmiany statusów" */}
          <FilterChip
            variant="choice"
            label={t('workOrder.journal.filters.payments')}
            selected={eventGroup === 'payments'}
            onClick={() => {
              choose(null, 'payments');
            }}
          />
        </div>
        <Select
          label={t('workOrder.journal.filters.stage')}
          value={stageId ?? ''}
          options={[{ value: '', label: t('workOrder.journal.filters.stageAll') }, ...groups]}
          onChange={(value) => {
            setStageId(value === '' ? null : value);
          }}
        />
      </div>
      {cursorReset ? <InlineAlert tone="info">{t('workOrder.journal.cursorReset')}</InlineAlert> : null}
      {journal.isPending ? (
        <SectionLoading lines={3} />
      ) : journal.isError && entries.length === 0 ? (
        <SectionError
          message={t('workOrder.journal.error')}
          retryLabel={t('workOrder.journal.retry')}
          onRetry={() => {
            void journal.refetch();
          }}
        />
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-start gap-stack-sm">
          <p className="text-body text-text-secondary">
            {filtered ? t('workOrder.journal.emptyFilter') : canWrite ? t('workOrder.journal.empty') : t('workOrder.journal.emptyReadOnly')}
          </p>
          {filtered ? (
            <Button variant="secondary" onClick={resetFilters}>
              {t('workOrder.journal.showAll')}
            </Button>
          ) : null}
        </div>
      ) : (
        <div ref={list} className="flex flex-col gap-stack-md">
          <Timeline>
            {days.map((day) => {
              const relation = relationOf(day.day, nowMs);
              const heading =
                relation === 'today'
                  ? t('workOrder.journal.day.today')
                  : relation === 'yesterday'
                    ? t('workOrder.journal.day.yesterday')
                    : formatEntryDate(day.items[0]?.createdAt ?? day.day);
              return (
                <TimelineDay key={day.day} heading={heading}>
                  {day.items.map((entry) => (
                    <JournalEntry
                      key={entry.id}
                      entry={entry}
                      byId={byId}
                      nowMs={nowMs}
                      online={online}
                      itemRef={undefined}
                      onCorrect={
                        canWrite &&
                        (entry.kind === 'note' || entry.kind === 'comment') &&
                        entry.supersededByEntryId === null &&
                        entry.redactedAt === null
                          ? setCorrecting
                          : undefined
                      }
                    />
                  ))}
                </TimelineDay>
              );
            })}
          </Timeline>
          {journal.isFetchNextPageError && !cursorReset ? (
            <InlineAlert
              tone="error"
              action={
                <Button variant="secondary" onClick={loadOlder}>
                  {t('workOrder.journal.retry')}
                </Button>
              }
            >
              {t('workOrder.journal.olderError')}
            </InlineAlert>
          ) : null}
          {journal.isFetchingNextPage ? <SectionLoading lines={3} /> : null}
          {journal.hasNextPage ? (
            <div>
              <Button variant="secondary" loading={journal.isFetchingNextPage} onClick={loadOlder}>
                {t('workOrder.journal.older')}
              </Button>
            </div>
          ) : null}
        </div>
      )}
      {correcting === null ? null : (
        <JournalCorrectionDialog
          key={correcting.id}
          workOrderId={order.id}
          entry={correcting}
          onClose={() => {
            setCorrecting(null);
          }}
        />
      )}
    </section>
  );
}
