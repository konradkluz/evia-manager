import type { CreateTimelineEntryRequest, TimelineEntry } from '@evia/contracts';
import { Banner, Button, Dialog, InlineAlert, TextArea, WifiOff } from '@evia/ui-web';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAttempt } from '../forms/attempt.ts';
import { DiscardDialog } from '../forms/discard-dialog.tsx';
import { refusesAttempt } from '../forms/save-failure.ts';
import { useToast } from '../shell/toast-context.tsx';
import { useOnline } from '../shell/use-online.ts';
import { ENTRY_BODY_MAX, codePointLength } from './journal-draft.ts';
import { isBodyFailure, journalFailureText } from './journal-failure.ts';
import { describeJournalFailure, useCreateJournalEntry, type JournalFailure } from './use-journal.ts';

/**
 * "Popraw wpis" (W-08, EVM-037 AC3): the text of an entry is never edited — a correction is a NEW entry that points at the
 * old one (`supersedesEntryId`), and the old one stays in the journal, collapsed. The new entry keeps the kind, the category
 * and the stage of the old one. Same rules as a new entry: the text is plain text, a retry keeps the `id` and the key,
 * and a refusal (`409 entry_superseded`: somebody corrected it first) is told in words.
 */
export function JournalCorrectionDialog({
  workOrderId,
  entry,
  onClose,
}: {
  readonly workOrderId: string;
  readonly entry: TimelineEntry;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation();
  const online = useOnline();
  const showToast = useToast();
  const attempt = useAttempt();
  const create = useCreateJournalEntry(workOrderId);
  const formId = useId();
  const original = entry.body ?? '';
  const [body, setBody] = useState(original);
  const [failure, setFailure] = useState<JournalFailure | null>(null);
  const [emptyTried, setEmptyTried] = useState(false);
  const [discarding, setDiscarding] = useState(false);

  const length = codePointLength(body.trim());
  const tooLong = length > ENTRY_BODY_MAX;
  const dirty = body !== original;

  const dismiss = () => {
    if (dirty && !create.isPending) setDiscarding(true);
    else onClose();
  };

  const submit = () => {
    if (!dirty) {
      onClose();
      return;
    }
    if (length === 0) {
      setEmptyTried(true);
      return;
    }
    if (tooLong) return;
    const request: Omit<CreateTimelineEntryRequest, 'id'> = {
      kind: entry.kind === 'comment' ? 'comment' : 'note',
      ...(entry.kind === 'comment' ? {} : { noteCategory: entry.noteCategory ?? 'other' }),
      body,
      supersedesEntryId: entry.id,
    };
    const { id, key } = attempt.next(JSON.stringify(request));
    setFailure(null);
    create.mutate(
      { body: { id, ...request }, key },
      {
        onSuccess: () => {
          attempt.forget();
          showToast(t('workOrder.journal.correction.added'));
          onClose();
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

  return (
    <>
      <Dialog
        open={!discarding}
        title={t('workOrder.journal.correction.title')}
        closeLabel={t('workOrder.journal.correction.close')}
        onDismiss={dismiss}
        actions={
          <>
            <Button variant="tertiary" onClick={dismiss}>
              {t('workOrder.journal.correction.cancel')}
            </Button>
            <Button
              type="submit"
              form={formId}
              loading={create.isPending}
              disabled={!online}
              {...(online ? {} : { title: t('workOrder.journal.correction.offline') })}
            >
              {t('workOrder.journal.correction.submit')}
            </Button>
          </>
        }
      >
        <form
          id={formId}
          noValidate
          className="flex flex-col gap-stack-md"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {online ? null : <Banner icon={WifiOff}>{t('workOrder.journal.correction.offline')}</Banner>}
          {alert === undefined ? null : <InlineAlert tone="error">{alert}</InlineAlert>}
          <p className="text-body text-text-secondary">{t('workOrder.journal.correction.info')}</p>
          <TextArea
            label={t('workOrder.journal.correction.body')}
            rows={6}
            value={body}
            hint={t('workOrder.journal.composer.hint')}
            {...(bodyError === undefined ? {} : { error: bodyError })}
            onChange={(event) => {
              setBody(event.target.value);
              setEmptyTried(false);
              if (failure !== null && isBodyFailure(failure)) setFailure(null);
            }}
          />
          <p className="text-body-sm text-text-tertiary">
            {t('workOrder.journal.composer.counter', {
              length: length.toLocaleString('pl-PL'),
              max: ENTRY_BODY_MAX.toLocaleString('pl-PL'),
            })}
          </p>
        </form>
      </Dialog>
      <DiscardDialog
        open={discarding}
        onConfirm={onClose}
        onBack={() => {
          setDiscarding(false);
        }}
      />
    </>
  );
}
