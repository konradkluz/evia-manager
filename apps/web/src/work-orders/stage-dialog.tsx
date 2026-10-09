import type { PartyKind, TransitionProcedureStageRequest, ProcedureStagePatch, ProcedureStage, WaitingOn } from '@evia/contracts';
import { Banner, Button, DateField, Dialog, Info, InlineAlert, RadioGroup, TextArea, WifiOff } from '@evia/ui-web';
import type { TFunction } from 'i18next';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { partyKindLabels } from '../i18n/catalog-labels.ts';
import { PartyPicker, type PickedParty } from '../parties/party-picker.tsx';
import { serverNow } from '../session/server-clock.ts';
import { BLOCKED_REASON_MAX, DATE_MIN, type StageAction, type StageFailure } from './stage-transitions.ts';
import { todayWarsaw } from './transition-actions.ts';

/** What a dialog hands over: a transition ("Czekamy na…", "Zakończ…", "Zablokuj…") or the edit "Zmień, na kogo czekamy…" (a PATCH). */
export type StageCommand =
  | { readonly kind: 'transition'; readonly request: TransitionProcedureStageRequest }
  | { readonly kind: 'patch'; readonly patch: ProcedureStagePatch };

export type DialogAction = Extract<StageAction, 'wait' | 'changeWaiting' | 'finish' | 'block'>;

/** Every kind of party can be waited for; the suggestions from the location and "Dodaj stronę" are EVM-033. */
const ALL_KINDS = Object.keys(partyKindLabels) as PartyKind[];

const normalize = (text: string): string => text.normalize('NFC').trim();

interface FieldErrors {
  waitingOn?: string;
  party?: string;
  date?: string;
  reason?: string;
}

/** The text of a failure that is not a field (also used under the badge when no dialog is open). */
export function stageFailureText(t: TFunction, failure: StageFailure, undo = false): string {
  switch (failure.kind) {
    case 'conflict':
      return undo ? t('workOrder.stage.failure.undoConflict') : t('workOrder.stage.failure.conflict');
    case 'closed':
      return t('workOrder.stage.failure.closed');
    case 'gone':
      return t('workOrder.stage.failure.gone');
    case 'forbidden':
      return t('workOrder.stage.failure.forbidden');
    case 'party':
      return t('workOrder.stage.failure.party');
    case 'rate':
      return t('workOrder.stage.failure.rateLimited', { seconds: failure.seconds });
    case 'server':
      return t('workOrder.stage.failure.server', { code: failure.code });
    case 'fields':
    case 'network':
      return t('workOrder.stage.failure.network');
  }
}

function reasonError(t: TFunction, code: string): string {
  if (code === 'too_long') return t('workOrder.stage.dialog.reasonTooLong', { max: BLOCKED_REASON_MAX });
  if (code === 'required') return t('workOrder.stage.dialog.reasonRequired');
  return t('workOrder.stage.dialog.reasonInvalid');
}

/**
 * The dialogs of W-07 (EVM-032 AC2, AC3, AC4): "Na kogo czekamy?" (also the edit "Zmień, na kogo czekamy…"), "Zakończ etap" and
 * "Dlaczego etap jest zablokowany?". The typed values live in this component only — the memory of the tab, not the address and not a
 * store of the browser — and stay when a request fails (`412`, offline, `429`). Client checks (a party chosen, the day not later than
 * today) tell the person before the request; the server decides again and its field errors land under the same fields. The reason
 * of a block is free text that may hold personal data: the hint says what not to type (SR-DATA-02), it is rendered as text only.
 */
export function StageDialog({
  action,
  stage,
  online,
  run,
  onClose,
}: {
  readonly action: DialogAction;
  readonly stage: ProcedureStage;
  readonly online: boolean;
  /** Sends the command; `null` when the server accepted it, else why not. */
  readonly run: (command: StageCommand) => Promise<StageFailure | null>;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation();
  const formId = useId();
  const [waitingOn, setWaitingOn] = useState<WaitingOn | ''>(action === 'changeWaiting' ? (stage.waitingOn ?? '') : '');
  const [party, setParty] = useState<PickedParty | null>(
    action === 'changeWaiting' && stage.waitingParty !== null
      ? { id: stage.waitingParty.id, displayName: stage.waitingParty.displayName }
      : null,
  );
  const [day, setDay] = useState(() => todayWarsaw(serverNow()));
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<StageFailure | null>(null);
  const [pending, setPending] = useState(false);

  const dateError = (): string | undefined => {
    if (day === '') return t('workOrder.stage.dialog.dateRequired');
    return day > todayWarsaw(serverNow()) || day < DATE_MIN ? t('workOrder.stage.dialog.dateOutOfRange') : undefined;
  };

  const submit = async () => {
    const found: FieldErrors = {};
    let command: StageCommand | undefined;
    if (action === 'wait' || action === 'changeWaiting') {
      if (waitingOn === '') found.waitingOn = t('workOrder.stage.dialog.waitingOnRequired');
      else if (waitingOn === 'party' && party === null) found.party = t('workOrder.stage.dialog.partyRequired');
      const date = dateError();
      if (date !== undefined) found.date = date;
      if (Object.keys(found).length === 0 && waitingOn !== '') {
        const fields = { waitingOn, ...(waitingOn === 'party' && party !== null ? { waitingOnPartyId: party.id } : {}), waitingSince: day };
        command = action === 'wait' ? { kind: 'transition', request: { to: 'waiting', ...fields } } : { kind: 'patch', patch: fields };
      }
    } else if (action === 'finish') {
      const date = dateError();
      if (date !== undefined) found.date = date;
      else command = { kind: 'transition', request: { to: 'done', completedOn: day } };
    } else {
      const text = normalize(reason);
      if (text === '') found.reason = t('workOrder.stage.dialog.reasonRequired');
      else if (text.length > BLOCKED_REASON_MAX) found.reason = t('workOrder.stage.dialog.reasonTooLong', { max: BLOCKED_REASON_MAX });
      else command = { kind: 'transition', request: { to: 'blocked', blockedReason: text } };
    }
    setErrors(found);
    setFailure(null);
    if (command === undefined) return;
    setPending(true);
    const result = await run(command);
    setPending(false);
    if (result === null) return;
    if (result.kind === 'fields') {
      const mapped: FieldErrors = {};
      const pointers = result.pointers;
      if (pointers.has('/waitingOn')) mapped.waitingOn = t('workOrder.stage.dialog.waitingOnRequired');
      if (pointers.has('/waitingOnPartyId')) mapped.party = t('workOrder.stage.dialog.partyRequired');
      if (pointers.has('/waitingSince') || pointers.has('/completedOn')) mapped.date = t('workOrder.stage.dialog.dateOutOfRange');
      const reasonCode = pointers.get('/blockedReason');
      if (reasonCode !== undefined) mapped.reason = reasonError(t, reasonCode);
      setErrors(mapped);
      if (Object.keys(mapped).length > 0) return;
    }
    if (result.kind === 'party') {
      setParty(null);
      setErrors({ party: t('workOrder.stage.failure.party') });
      return;
    }
    setFailure(result);
  };

  const title =
    action === 'finish'
      ? t('workOrder.stage.dialog.finishTitle')
      : action === 'block'
        ? t('workOrder.stage.dialog.blockTitle')
        : t('workOrder.stage.dialog.waitTitle');
  const submitLabel =
    action === 'finish'
      ? t('workOrder.stage.dialog.finishSubmit')
      : action === 'block'
        ? t('workOrder.stage.dialog.blockSubmit')
        : t('workOrder.stage.dialog.waitSubmit');

  return (
    <Dialog
      open
      title={title}
      closeLabel={t('workOrder.stage.dialog.close')}
      onDismiss={onClose}
      actions={
        <>
          <Button variant="tertiary" onClick={onClose}>
            {t('workOrder.stage.dialog.cancel')}
          </Button>
          <Button
            type="submit"
            form={formId}
            loading={pending}
            disabled={!online}
            {...(online ? {} : { title: t('workOrder.stage.dialog.offline') })}
          >
            {submitLabel}
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
          void submit();
        }}
      >
        {online ? null : <Banner icon={WifiOff}>{t('workOrder.stage.dialog.offline')}</Banner>}
        {failure === null ? null : <InlineAlert tone="error">{stageFailureText(t, failure)}</InlineAlert>}
        <p className="text-body text-text-secondary">{t('workOrder.stage.dialog.stage', { name: stage.name })}</p>
        {action === 'changeWaiting' ? <Banner icon={Info}>{t('workOrder.stage.dialog.changeNote')}</Banner> : null}
        {action === 'wait' || action === 'changeWaiting' ? (
          <>
            <RadioGroup
              legend={t('workOrder.stage.dialog.waitingOn')}
              options={[
                { value: 'customer', label: t('workOrder.stage.dialog.onCustomer') },
                { value: 'party', label: t('workOrder.stage.dialog.onParty') },
              ]}
              value={waitingOn}
              {...(errors.waitingOn === undefined ? {} : { error: errors.waitingOn })}
              onChange={(value) => {
                setWaitingOn(value as WaitingOn);
                setErrors({});
              }}
            />
            {waitingOn === 'party' ? (
              <PartyPicker
                label={t('workOrder.stage.dialog.party')}
                changeLabel={t('workOrder.stage.dialog.changeParty')}
                kinds={ALL_KINDS}
                selected={party}
                error={errors.party}
                onSelect={(picked) => {
                  setParty(picked);
                  setErrors({});
                }}
                onClear={() => {
                  setParty(null);
                }}
              />
            ) : null}
            <DateField
              label={t('workOrder.stage.dialog.since')}
              value={day}
              min={DATE_MIN}
              max={todayWarsaw(serverNow())}
              hint={t('workOrder.stage.dialog.dateHint')}
              {...(errors.date === undefined ? {} : { error: errors.date })}
              onChange={(value) => {
                setDay(value);
                setErrors({});
              }}
            />
          </>
        ) : action === 'finish' ? (
          <DateField
            label={t('workOrder.stage.dialog.completedOn')}
            value={day}
            min={DATE_MIN}
            max={todayWarsaw(serverNow())}
            hint={t('workOrder.stage.dialog.dateHint')}
            {...(errors.date === undefined ? {} : { error: errors.date })}
            onChange={(value) => {
              setDay(value);
              setErrors({});
            }}
          />
        ) : (
          <TextArea
            label={t('workOrder.stage.dialog.reason')}
            value={reason}
            hint={t('workOrder.stage.dialog.reasonHint')}
            {...(errors.reason === undefined ? {} : { error: errors.reason })}
            onChange={(event) => {
              setReason(event.target.value);
              setErrors({});
            }}
          />
        )}
      </form>
    </Dialog>
  );
}
