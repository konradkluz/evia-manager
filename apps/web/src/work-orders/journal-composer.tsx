import type { CreateTimelineEntryRequest } from '@evia/contracts';
import { Button, FilterChip, InlineAlert, RadioGroup, Select, TextArea, type SelectGroup, type SelectOption } from '@evia/ui-web';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAttempt } from '../forms/attempt.ts';
import { refusesAttempt } from '../forms/save-failure.ts';
import { NOTE_CATEGORIES, noteCategoryLabels } from '../i18n/journal-labels.ts';
import { useSession } from '../session/session.ts';
import { useToast } from '../shell/toast-context.tsx';
import { useOnline } from '../shell/use-online.ts';
import { ENTRY_BODY_MAX, codePointLength, dropDraft, loadDraft, storeDraft, type JournalDraft } from './journal-draft.ts';
import { isBodyFailure, journalFailureText } from './journal-failure.ts';
import { formatTimeOfDay } from './journal-format.ts';
import { describeJournalFailure, useCreateJournalEntry, type JournalFailure } from './use-journal.ts';

/** The stages of the order as the options of a Select: grouped by process, the first option is "none" (`noneLabel`). */
export type StageOptions = ReadonlyArray<SelectOption | SelectGroup>;

/**
 * The field of a new entry (W-08; EVM-037 AC1, AC2, AC5, AC8): the kind (Wpis / Komentarz), the category of a note as chips,
 * an optional stage of THIS order, the text with the reminder of SR-DATA-02 and a counter of characters.
 *
 * What was typed is a draft in the memory of the tab (`draft-store`: gone on a logout, never in a store of the browser —
 * SR-WEB-05) and stays there when the connection is lost or the save fails. A save sends the `id` and the `Idempotency-Key`
 * of the attempt; the same content keeps the same pair, so a retry after a lost answer never makes a second entry (AC5).
 * Offline the button is disabled with the reason; the text stays.
 */
export function JournalComposer({ workOrderId, stageOptions }: { readonly workOrderId: string; readonly stageOptions: StageOptions }) {
  const { t } = useTranslation();
  const userId = useSession().data?.user.id;
  const online = useOnline();
  const showToast = useToast();
  const attempt = useAttempt();
  const create = useCreateJournalEntry(workOrderId);
  const [draft, setDraft] = useState<JournalDraft>(() => loadDraft(userId, workOrderId));
  const [failure, setFailure] = useState<JournalFailure | null>(null);
  const [emptyTried, setEmptyTried] = useState(false);

  const stageKnown = stageOptions.some((entry) =>
    'options' in entry ? entry.options.some((option) => option.value === draft.stageId) : entry.value === draft.stageId,
  );
  const stageId = stageKnown ? draft.stageId : '';
  const length = codePointLength(draft.body.trim());
  const tooLong = length > ENTRY_BODY_MAX;

  const change = (patch: Partial<JournalDraft>) => {
    const next: JournalDraft = { ...draft, ...patch, savedAt: Date.now() };
    setDraft(next);
    storeDraft(userId, workOrderId, next);
    if (patch.body !== undefined) {
      setEmptyTried(false);
      if (failure !== null && isBodyFailure(failure)) setFailure(null);
    }
  };

  const submit = () => {
    if (length === 0) {
      setEmptyTried(true);
      return;
    }
    if (tooLong) return;
    const request: Omit<CreateTimelineEntryRequest, 'id'> = {
      kind: draft.kind,
      ...(draft.kind === 'note' ? { noteCategory: draft.category } : {}),
      body: draft.body,
      ...(stageId === '' ? {} : { procedureStageId: stageId }),
    };
    // The same content gets the same `id` and key on every retry; changed content is a new attempt.
    const { id, key } = attempt.next(JSON.stringify(request));
    setFailure(null);
    create.mutate(
      { body: { id, ...request }, key },
      {
        onSuccess: () => {
          attempt.forget();
          dropDraft(workOrderId);
          setDraft((current) => ({ ...current, body: '', savedAt: 0 }));
          showToast(draft.kind === 'note' ? t('workOrder.journal.composer.addedNote') : t('workOrder.journal.composer.addedComment'));
        },
        onError: (error) => {
          if (refusesAttempt(error)) attempt.forget();
          setFailure(describeJournalFailure(error));
        },
      },
    );
  };

  const bodyError = tooLong
    ? journalFailureText(t, { kind: 'tooLong' })
    : emptyTried
      ? journalFailureText(t, { kind: 'required' })
      : failure !== null && isBodyFailure(failure)
        ? journalFailureText(t, failure)
        : undefined;
  const alert = failure !== null && !isBodyFailure(failure) ? journalFailureText(t, failure) : undefined;
  const submitLabel = draft.kind === 'note' ? t('workOrder.journal.composer.submitNote') : t('workOrder.journal.composer.submitComment');

  return (
    <form
      noValidate
      className="flex flex-col gap-stack-md"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-inline-md">
        <h3 className="text-heading-4 text-text-primary">{t('workOrder.journal.composer.title')}</h3>
        {draft.body === '' || draft.savedAt === 0 ? null : (
          <p className="text-caption text-text-secondary">
            {t('workOrder.journal.composer.draft', { time: formatTimeOfDay(draft.savedAt) })}
          </p>
        )}
      </div>
      <RadioGroup
        legend={t('workOrder.journal.composer.kind')}
        options={[
          { value: 'note', label: t('workOrder.journal.composer.kindNote') },
          { value: 'comment', label: t('workOrder.journal.composer.kindComment') },
        ]}
        value={draft.kind}
        onChange={(value) => {
          change({ kind: value === 'comment' ? 'comment' : 'note' });
        }}
      />
      {draft.kind === 'note' ? (
        <fieldset className="flex flex-col gap-stack-xs">
          <legend className="text-label text-text-primary">{t('workOrder.journal.composer.category')}</legend>
          <div className="flex flex-wrap gap-inline-sm">
            {NOTE_CATEGORIES.map((category) => (
              <FilterChip
                key={category}
                variant="choice"
                label={noteCategoryLabels[category]}
                selected={draft.category === category}
                onClick={() => {
                  change({ category });
                }}
              />
            ))}
          </div>
        </fieldset>
      ) : null}
      <Select
        label={t('workOrder.journal.composer.stage')}
        value={stageId}
        options={[{ value: '', label: t('workOrder.journal.composer.stageNone') }, ...stageOptions]}
        onChange={(value) => {
          change({ stageId: value });
        }}
      />
      <TextArea
        label={t('workOrder.journal.composer.body')}
        rows={5}
        value={draft.body}
        hint={t('workOrder.journal.composer.hint')}
        {...(bodyError === undefined ? {} : { error: bodyError })}
        onChange={(event) => {
          change({ body: event.target.value });
        }}
      />
      <p className="text-body-sm text-text-tertiary">
        {t('workOrder.journal.composer.counter', { length: length.toLocaleString('pl-PL'), max: ENTRY_BODY_MAX.toLocaleString('pl-PL') })}
      </p>
      {alert === undefined ? null : <InlineAlert tone="error">{alert}</InlineAlert>}
      <div className="flex flex-wrap items-center justify-end gap-inline-md">
        {online ? null : <p className="text-body-sm text-text-secondary">{t('workOrder.journal.composer.offline')}</p>}
        <Button
          type="submit"
          loading={create.isPending}
          disabled={!online}
          {...(online ? {} : { title: t('workOrder.journal.composer.offline') })}
        >
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
