import { createSiteSurvey, type WorkOrderDetails } from '@evia/contracts';
import { AlertDialog, Banner, Button, ErrorSummary, FieldError, InlineAlert, Select, TextField, WifiOff } from '@evia/ui-web';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, unwrap } from '../api/client.ts';
import { useApi } from '../api/api-context.tsx';
import { useAttempt } from '../forms/attempt.ts';
import { describeFailure, refusesAttempt, type SaveFailure } from '../forms/save-failure.ts';
import { WORK_ORDERS_PATH, workOrderPath } from '../paths.ts';
import { discardDraft, saveDraft } from '../session/draft-store.ts';
import { SESSION_KEY } from '../session/session.ts';
import { useToast } from '../shell/toast-context.tsx';
import { useOnline } from '../shell/use-online.ts';
import { LocationSection, locationStarted, type LocationState } from '../sites/location-section.tsx';
import { formatClock } from './format.ts';
import { newSurveyText as text } from './new-survey-labels.ts';
import {
  buildSurveyBody,
  NO_KEEPER,
  phoneValid,
  restoreSurveyDraft,
  SURVEY_DRAFT,
  SURVEY_FIELDS,
  surveyFieldOf,
  surveyFingerprint,
  type SurveyDraft,
  type SurveyField,
  type SurveyFieldErrors,
} from './site-survey-form.ts';
import { ASSIGNABLE_USERS_KEY, useAssignableUsers } from './use-order-lookups.ts';
import { WORK_ORDER_HEADER_KEY, WORK_ORDERS_KEY } from './query-keys.ts';

export interface NewSurveyFormProps {
  readonly userId: string;
  readonly userName: string;
  /** The choice "Rodzaj" (the page owns it: the form is replaced when the kind changes). */
  readonly kindChoice: ReactNode;
  /** A message of the page above the form (e.g. "wizje lokalne są teraz wyłączone"). */
  readonly notice: ReactNode;
  /** The server answered `404`: the function is off or the site is not available — the page tells it and refreshes the session. */
  readonly onUnavailable: () => void;
}

/**
 * W-05 "Nowe zlecenie" → "Wizja lokalna" (EVM-138 AC2, flows/17): the light form of a site survey — a location (an existing one or a
 * new one without the OSD, the manager, the power, the PPE and the notes), the optional phone of the requester and the optional
 * keeper — and "Załóż wizję lokalną" (`POST /site-surveys`, `id` and `Idempotency-Key` stable for a retry of the same content).
 * The draft (the location and the keeper) lives in the memory of the tab; the phone of the requester is personal data and lives in
 * this component only: never in the draft, the address, the title of the tab, a browser storage or a key of the cache.
 */
export function NewSurveyForm({ userId, userName, kindChoice, notice, onUnavailable }: NewSurveyFormProps) {
  const { t } = useTranslation();
  const client = useApi();
  const online = useOnline();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const attempt = useAttempt();
  const users = useAssignableUsers();
  const [draft, setDraft] = useState<SurveyDraft>(() => restoreSurveyDraft(userId));
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState<SurveyFieldErrors>({});
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const summary = useRef<HTMLDivElement>(null);
  const alert = useRef<HTMLDivElement>(null);
  const sections = useRef<Partial<Record<SurveyField, HTMLElement | null>>>({});
  const { location, keeper } = draft;
  const started = locationStarted(location) || keeper !== '' || phone !== '';

  const mutation = useMutation({
    mutationFn: (request: { readonly body: ReturnType<typeof buildSurveyBody>; readonly key: string }) =>
      unwrap(createSiteSurvey({ client, body: request.body, headers: { 'Idempotency-Key': request.key } })),
  });

  // The draft (never the phone) lives in the memory of the tab, owned by this person; it is saved at every change (§ 4.1).
  useEffect(() => {
    if (draft.savedAt === null) return;
    if (locationStarted(draft.location) || draft.keeper !== '') saveDraft(userId, SURVEY_DRAFT, JSON.stringify(draft));
    else discardDraft(SURVEY_DRAFT);
  }, [draft, userId]);

  // After a failed submit the focus goes to the summary of errors, or to the message when there are no field errors (§ 4.1).
  useEffect(() => {
    if (focusRequest === 0) return;
    (summary.current ?? alert.current)?.focus();
    // Only the request matters here: it is bumped together with the errors and the failure it concerns.
  }, [focusRequest]);

  const change = (update: (current: SurveyDraft) => SurveyDraft) => {
    setDraft((current) => ({ ...update(current), savedAt: Date.now() }));
  };
  const clearError = (field: SurveyField) => {
    setErrors((current) =>
      current[field] === undefined ? current : Object.fromEntries(Object.entries(current).filter(([name]) => name !== field)),
    );
  };
  const changeLocation = (update: (current: LocationState) => LocationState) => {
    change((current) => ({ ...current, location: update(current.location) }));
    clearError('site');
  };

  const leave = () => {
    void navigate({ to: WORK_ORDERS_PATH });
  };
  const focusField = (field: string) => {
    sections.current[field as SurveyField]?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
  };
  const section = (field: SurveyField) => (element: HTMLElement | null) => {
    sections.current[field] = element;
  };

  const submit = () => {
    const missing: SurveyFieldErrors = {
      ...(location.site === null ? { site: text.siteRequired } : {}),
      ...(phoneValid(phone) ? {} : { phone: text.phoneInvalid }),
    };
    if (Object.keys(missing).length > 0 || location.site === null) {
      setErrors(missing);
      setFailure(null);
      setFocusRequest((current) => current + 1);
      return;
    }
    const { id, key } = attempt.next(surveyFingerprint(buildSurveyBody('', location.site.id, phone, keeper, userId)));
    setErrors({});
    setFailure(null);
    mutation.mutate(
      { body: buildSurveyBody(id, location.site.id, phone, keeper, userId), key },
      {
        onSuccess: (order: WorkOrderDetails) => {
          attempt.forget();
          queryClient.setQueryData([WORK_ORDER_HEADER_KEY, order.id], order);
          void queryClient.invalidateQueries({ queryKey: [WORK_ORDERS_KEY] });
          discardDraft(SURVEY_DRAFT);
          toast(text.created(order.number));
          void navigate({ to: workOrderPath(order.id) });
        },
        onError: (error) => {
          const mapped: SurveyFieldErrors = {};
          if (error instanceof ApiError && error.status === 400) {
            for (const entry of error.errors) {
              const field = surveyFieldOf(entry);
              if (field === undefined || mapped[field] !== undefined) continue;
              mapped[field] = field === 'phone' ? text.phoneInvalid : field === 'keeper' ? text.keeperUnavailable : text.siteRequired;
            }
            if (mapped.keeper !== undefined) void queryClient.invalidateQueries({ queryKey: ASSIGNABLE_USERS_KEY });
          }
          if (error instanceof ApiError && error.status === 404) {
            // The function is off or the site is not available: the API answers alike (SR-AUTHZ-02), so the panel says both.
            attempt.forget();
            void queryClient.invalidateQueries({ queryKey: SESSION_KEY });
            onUnavailable();
            return;
          }
          if (refusesAttempt(error)) attempt.forget();
          const hasFields = Object.keys(mapped).length > 0;
          setErrors(mapped);
          setFailure(hasFields ? null : describeFailure(error, false));
          setFocusRequest((current) => current + 1);
        },
      },
    );
  };

  const failureText = (current: SaveFailure): string => {
    switch (current.kind) {
      case 'fields':
        return text.failure.fields;
      case 'network':
        return text.failure.network;
      case 'inProgress':
        return text.failure.inProgress;
      case 'forbidden':
        return text.failure.forbidden;
      case 'rate':
        return text.failure.rate(current.seconds);
      case 'server':
        return text.failure.server(current.code);
    }
  };

  const summaryItems = SURVEY_FIELDS.flatMap((field) => {
    const message = errors[field];
    return message === undefined ? [] : [{ field, message }];
  });

  const people = users.data ?? [];
  const keeperOptions = [
    ...(people.some((person) => person.id === userId) ? people : [{ id: userId, displayName: userName }, ...people]).map((person) => ({
      value: person.id,
      label: person.displayName,
    })),
    { value: NO_KEEPER, label: text.noKeeper },
  ];

  return (
    <div className="flex w-full max-w-form-max-width flex-col gap-stack-lg">
      <header className="flex flex-col gap-stack-xs">
        <h1 className="font-display text-heading-1 text-text-primary">{t('newWorkOrder.title')}</h1>
        <p className="text-body text-text-secondary">{t('newWorkOrder.numberHint')}</p>
        {draft.savedAt === null || !started ? null : (
          <p className="text-body-sm text-text-secondary">
            {t('newWorkOrder.draft', { time: formatClock(draft.savedAt) })}
            <span className="block text-text-tertiary">{t('newWorkOrder.draftInfo')}</span>
          </p>
        )}
      </header>
      {kindChoice}
      {notice}
      {online ? null : <Banner icon={WifiOff}>{text.offline}</Banner>}
      {summaryItems.length === 0 ? null : (
        <ErrorSummary title={text.summary} items={summaryItems} onSelect={focusField} summaryRef={summary} />
      )}
      {failure === null ? null : (
        <InlineAlert tone="error" alertRef={alert}>
          {failureText(failure)}
        </InlineAlert>
      )}
      <fieldset disabled={mutation.isPending} className="flex min-w-0 flex-col gap-stack-lg">
        <fieldset ref={section('site')} className="flex flex-col gap-stack-md">
          <legend className="mb-stack-sm text-heading-4 text-text-primary">{text.locationSection}</legend>
          <LocationSection lite value={location} onChange={changeLocation} />
          {errors.site === undefined ? null : <FieldError>{errors.site}</FieldError>}
        </fieldset>
        <fieldset ref={section('phone')} className="flex flex-col gap-stack-md">
          <legend className="mb-stack-sm text-heading-4 text-text-primary">{text.requesterSection}</legend>
          <TextField
            label={text.phoneLabel}
            type="tel"
            inputMode="tel"
            autoComplete="off"
            value={phone}
            hint={text.phoneHint}
            {...(errors.phone === undefined ? {} : { error: errors.phone })}
            onChange={(event) => {
              setPhone(event.target.value);
              clearError('phone');
            }}
          />
        </fieldset>
        <fieldset ref={section('keeper')} className="flex flex-col gap-stack-md">
          <legend className="mb-stack-sm text-heading-4 text-text-primary">{text.keeperSection}</legend>
          <Select
            label={text.keeperLabel}
            value={keeper === '' ? userId : keeper}
            options={keeperOptions}
            {...(errors.keeper === undefined ? {} : { error: errors.keeper })}
            onChange={(value) => {
              change((current) => ({ ...current, keeper: value === userId ? '' : value }));
              clearError('keeper');
            }}
          />
          <div role="status">
            <InlineAlert tone="info">{keeper === NO_KEEPER ? text.noKeeperHint : text.keeperHint}</InlineAlert>
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center justify-between gap-inline-md">
          <Button
            variant="tertiary"
            onClick={() => {
              if (!started) leave();
              else setConfirmingCancel(true);
            }}
          >
            {t('newWorkOrder.cancel')}
          </Button>
          <div className="flex flex-col items-end gap-stack-xs">
            <Button
              loading={mutation.isPending}
              disabled={!online}
              {...(online ? {} : { 'aria-describedby': 'survey-offline-hint' })}
              onClick={submit}
            >
              {text.submit}
            </Button>
            {online ? null : (
              <p id="survey-offline-hint" className="text-body-sm text-text-secondary">
                {text.offlineHint}
              </p>
            )}
          </div>
        </div>
      </fieldset>
      <AlertDialog
        open={confirmingCancel}
        title={text.discardTitle}
        onDismiss={() => {
          setConfirmingCancel(false);
        }}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                discardDraft(SURVEY_DRAFT);
                setConfirmingCancel(false);
                leave();
              }}
            >
              {t('newWorkOrder.discard.confirm')}
            </Button>
            <Button
              data-initial-focus
              onClick={() => {
                setConfirmingCancel(false);
              }}
            >
              {t('newWorkOrder.discard.back')}
            </Button>
          </>
        }
      >
        {t('newWorkOrder.discard.description')}
      </AlertDialog>
    </div>
  );
}
