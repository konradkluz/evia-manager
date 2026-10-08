import { createWorkOrder, type SiteType, type WorkOrder, type WorkOrderTemplate } from '@evia/contracts';
import {
  AlertDialog,
  Banner,
  Button,
  DateField,
  EmptyState,
  ErrorSummary,
  FieldError,
  InlineAlert,
  Lock,
  Select,
  TextArea,
  TextField,
  WifiOff,
} from '@evia/ui-web';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, unwrap } from '../api/client.ts';
import { useApi } from '../api/api-context.tsx';
import { AddCustomerDialog } from '../customers/add-customer-dialog.tsx';
import { CustomerPicker, type PickedCustomer } from '../customers/customer-picker.tsx';
import { useAttempt } from '../forms/attempt.ts';
import { fieldErrorText } from '../forms/field-error-text.ts';
import { describeFailure, refusesAttempt, type SaveFailure } from '../forms/save-failure.ts';
import { WORK_ORDERS_PATH, workOrderPath } from '../paths.ts';
import { discardDraft, readDraft, saveDraft } from '../session/draft-store.ts';
import { useSession } from '../session/session.ts';
import { useToast } from '../shell/toast-context.tsx';
import { ExpandedProbe, useExpanded } from '../shell/use-expanded.tsx';
import { useOnline } from '../shell/use-online.ts';
import { usePageTitle } from '../shell/use-page-title.ts';
import { EMPTY_LOCATION, LocationSection, locationStarted, type LocationState } from '../sites/location-section.tsx';
import { formatClock } from '../work-orders/format.ts';
import {
  buildOrderBody,
  defaultTitle,
  detailsStarted,
  EMPTY_CHOICE,
  EMPTY_DETAILS,
  missingFields,
  ORDER_FIELDS,
  orderFieldOf,
  orderFingerprint,
  PLANNED_DATE_MAX,
  PLANNED_DATE_MIN,
  type OrderDetails,
  type OrderField,
  type OrderFieldErrors,
} from '../work-orders/order-form.ts';
import { WORK_ORDER_HEADER_KEY, WORK_ORDERS_KEY } from '../work-orders/query-keys.ts';
import { headerOf } from '../work-orders/header-of.ts';
import { TemplatePreview, TemplateSection } from '../work-orders/template-section.tsx';
import { ASSIGNABLE_USERS_KEY, TEMPLATES_KEY, useAssignableUsers, useTemplates } from '../work-orders/use-order-lookups.ts';

/** Name of the draft of this form in the memory of the tab (`session/draft-store.ts`; never any other store, SR-WEB-05). */
const DRAFT = 'work-order-new';

interface Draft {
  readonly customer: PickedCustomer | null;
  readonly location: LocationState;
  readonly details: OrderDetails;
  /** When the draft last changed; `null` until the first change (a form that was never touched has no draft). */
  readonly savedAt: number | null;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
const hasId = (value: unknown): boolean => value === null || (isObject(value) && typeof value.id === 'string');

function restoreCustomer(value: unknown): PickedCustomer | null | undefined {
  if (value === null) return null;
  if (!isObject(value) || typeof value.id !== 'string' || typeof value.displayName !== 'string' || typeof value.phone !== 'string') {
    return undefined;
  }
  return { id: value.id, displayName: value.displayName, phone: value.phone };
}

/** The section "2. Lokalizacja" as it was saved; a draft from before the section existed has none, a broken one is dropped. */
function restoreLocation(value: unknown): LocationState | undefined {
  if (value === undefined) return EMPTY_LOCATION;
  if (!isObject(value) || (value.mode !== 'existing' && value.mode !== 'new') || !isObject(value.form)) return undefined;
  const form = value.form;
  if (!Object.keys(EMPTY_LOCATION.form).every((key) => typeof form[key] === 'string')) return undefined;
  if (!hasId(value.site) || !hasId(value.osd) || !hasId(value.manager)) return undefined;
  return value as unknown as LocationState;
}

/** The sections "3. Szablon" and "4. Zlecenie" as they were saved; a draft from before them has none, a broken one is dropped. */
function restoreDetails(value: unknown): OrderDetails | undefined {
  if (value === undefined) return EMPTY_DETAILS;
  if (!isObject(value)) return undefined;
  const texts = ['choice', 'title', 'assigneeId', 'plannedDate', 'description'] as const;
  if (
    !texts.every((key) => typeof value[key] === 'string') ||
    typeof value.showAll !== 'boolean' ||
    typeof value.titleEdited !== 'boolean'
  ) {
    return undefined;
  }
  return value as unknown as OrderDetails;
}

/** The draft as it was saved; anything else (a broken text) is no draft. */
function restore(userId: string): Draft | null {
  const stored = readDraft(userId, DRAFT);
  if (stored === undefined) return null;
  try {
    const value = JSON.parse(stored) as unknown;
    if (!isObject(value) || typeof value.savedAt !== 'number') return null;
    const customer = restoreCustomer(value.customer);
    const location = restoreLocation(value.location);
    const details = restoreDetails(value.details);
    return customer === undefined || location === undefined || details === undefined
      ? null
      : { customer, location, details, savedAt: value.savedAt };
  } catch {
    return null;
  }
}

/**
 * W-05 "Nowe zlecenie" (EVM-020, EVM-021, EVM-022): the sections "1. Klient", "2. Lokalizacja", "3. Szablon" (cards of templates
 * with the preview) and "4. Zlecenie" (title, coordinator, planned date, description), and "Utwórz zlecenie". Only Administrator
 * and Edytor create work orders: Tylko odczyt gets the state "Nie możesz tworzyć zleceń." — the UI is a convenience, the server
 * decides (`403`).
 */
export function NewWorkOrderPage() {
  const { t } = useTranslation();
  const session = useSession();
  const role = session.data?.user.role;
  const allowed = role === 'administrator' || role === 'editor';
  usePageTitle(allowed ? t('newWorkOrder.title') : t('newWorkOrder.denied.pageTitle'));
  const user = session.data?.user;
  return allowed && user !== undefined ? <NewWorkOrderForm userId={user.id} userName={user.displayName} /> : <Denied />;
}

function Denied() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <EmptyState
      icon={Lock}
      headingLevel={1}
      title={t('newWorkOrder.denied.title')}
      description={t('newWorkOrder.denied.description')}
      action={
        <Button
          onClick={() => {
            void navigate({ to: WORK_ORDERS_PATH });
          }}
        >
          {t('newWorkOrder.denied.action')}
        </Button>
      }
    />
  );
}

/** The type of the object the order is for: the chosen site, or the type picked in the form of a new one. */
function siteTypeOf(location: LocationState): SiteType | undefined {
  if (location.site !== null) return location.site.siteType;
  return location.mode === 'new' && location.form.siteType !== '' ? location.form.siteType : undefined;
}

type RequiredField = 'customer' | 'site' | 'template';

function NewWorkOrderForm({ userId, userName }: { readonly userId: string; readonly userName: string }) {
  const { t } = useTranslation();
  const client = useApi();
  const online = useOnline();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const attempt = useAttempt();
  const templates = useTemplates();
  const users = useAssignableUsers();
  const { probe, expanded } = useExpanded();
  const [draft, setDraft] = useState<Draft>(
    () => restore(userId) ?? { customer: null, location: EMPTY_LOCATION, details: EMPTY_DETAILS, savedAt: null },
  );
  const [adding, setAdding] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [errors, setErrors] = useState<OrderFieldErrors>({});
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const summary = useRef<HTMLDivElement>(null);
  const alert = useRef<HTMLDivElement>(null);
  const unavailableAlert = useRef<HTMLDivElement>(null);
  const firstTemplate = useRef<HTMLInputElement>(null);
  const sections = useRef<Partial<Record<OrderField, HTMLElement | null>>>({});
  const { customer, location, details } = draft;
  const started = customer !== null || locationStarted(location) || detailsStarted(details);
  const siteType = siteTypeOf(location);
  const chosen: WorkOrderTemplate | undefined = templates.data?.find((entry) => entry.id === details.choice);

  const mutation = useMutation({
    mutationFn: (request: { readonly body: ReturnType<typeof buildOrderBody>; readonly key: string }) =>
      unwrap(createWorkOrder({ client, body: request.body, headers: { 'Idempotency-Key': request.key } })),
  });

  // The draft lives in the memory of the tab, owned by this person; it is saved at every change (§ 4.1).
  useEffect(() => {
    if (draft.savedAt === null) return;
    if (started) saveDraft(userId, DRAFT, JSON.stringify(draft));
    else discardDraft(DRAFT);
  }, [draft, started, userId]);

  // After a failed submit the focus goes to the summary of errors, or to the message when there are no field errors (§ 4.1).
  useEffect(() => {
    if (focusRequest === 0) return;
    const target = summary.current ?? unavailableAlert.current ?? alert.current;
    target?.focus();
    // Only the request matters here: it is bumped together with the errors and the failure it concerns.
  }, [focusRequest]);

  const clearError = (...fields: OrderField[]) => {
    setErrors((current) =>
      fields.every((field) => current[field] === undefined)
        ? current
        : Object.fromEntries(Object.entries(current).filter(([name]) => !fields.some((field) => field === name))),
    );
  };

  const change = (update: (current: Draft) => Draft) => {
    setDraft((current) => ({ ...update(current), savedAt: Date.now() }));
  };
  const changeDetails = (patch: Partial<OrderDetails>, ...cleared: OrderField[]) => {
    change((current) => ({ ...current, details: { ...current.details, ...patch } }));
    clearError(...cleared);
  };
  const choose = (picked: PickedCustomer | null) => {
    change((current) => ({ ...current, customer: picked }));
    clearError('customer');
  };
  const changeLocation = (update: (current: LocationState) => LocationState) => {
    change((current) => ({ ...current, location: update(current.location) }));
    clearError('site');
  };

  const leave = () => {
    void navigate({ to: WORK_ORDERS_PATH });
  };

  const focusField = (field: string) => {
    if (field === 'template') firstTemplate.current?.focus();
    else sections.current[field as OrderField]?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
  };

  const required: Readonly<Record<RequiredField, string>> = {
    customer: t('newWorkOrder.errors.customerRequired'),
    site: t('newWorkOrder.errors.siteRequired'),
    template: t('newWorkOrder.template.required'),
  };

  const submit = () => {
    const missing = missingFields(customer, location, details);
    if (missing.length > 0 || customer === null || location.site === null) {
      setErrors(Object.fromEntries(missing.map((field) => [field, required[field as RequiredField]])));
      setFailure(null);
      setUnavailable(null);
      setFocusRequest((current) => current + 1);
      return;
    }
    const siteId = location.site.id;
    const { id, key } = attempt.next(orderFingerprint(buildOrderBody('', customer, siteId, details)));
    setErrors({});
    setFailure(null);
    setUnavailable(null);
    mutation.mutate(
      { body: buildOrderBody(id, customer, siteId, details), key },
      {
        onSuccess: (order: WorkOrder) => {
          attempt.forget();
          queryClient.setQueryData([WORK_ORDER_HEADER_KEY, order.id], headerOf(order));
          void queryClient.invalidateQueries({ queryKey: [WORK_ORDERS_KEY] });
          discardDraft(DRAFT);
          toast(t('newWorkOrder.created', { number: order.number }));
          void navigate({ to: workOrderPath(order.id) });
        },
        onError: (error) => {
          const mapped: OrderFieldErrors = {};
          let retired: string | null = null;
          if (error instanceof ApiError && error.status === 400) {
            for (const entry of error.errors) {
              const field = orderFieldOf(entry);
              if (field === undefined || mapped[field] !== undefined) continue;
              mapped[field] =
                entry.code === 'assignee_unavailable' ? t('newWorkOrder.errors.assigneeUnavailable') : fieldErrorText(t, field, entry.code);
            }
            if (mapped.assignee !== undefined) void queryClient.invalidateQueries({ queryKey: ASSIGNABLE_USERS_KEY });
          } else if (error instanceof ApiError && error.status === 404) {
            // The API answers alike for a missing customer and a missing site (SR-AUTHZ-02): the panel cannot tell which, so it says both.
            mapped.customer = t('newWorkOrder.errors.customerNotFound');
            mapped.site = t('newWorkOrder.errors.siteNotFound');
          } else if (error instanceof ApiError && error.status === 422 && error.code === 'template_unavailable') {
            retired =
              chosen === undefined
                ? t('newWorkOrder.template.unavailableGeneric')
                : t('newWorkOrder.template.unavailable', { name: chosen.name });
            changeDetails({ choice: '' });
            void queryClient.invalidateQueries({ queryKey: TEMPLATES_KEY });
          }
          if (refusesAttempt(error)) attempt.forget();
          const hasFields = Object.keys(mapped).length > 0;
          setErrors(mapped);
          setUnavailable(retired);
          setFailure(hasFields || retired !== null ? null : describeFailure(error, false));
          setFocusRequest((current) => current + 1);
        },
      },
    );
  };

  const failureText = (current: SaveFailure): string => {
    switch (current.kind) {
      case 'fields':
        return t('newWorkOrder.failure.fields');
      case 'network':
        return t('newWorkOrder.failure.network');
      case 'inProgress':
        return t('newWorkOrder.failure.inProgress');
      case 'forbidden':
        return t('newWorkOrder.failure.forbidden');
      case 'rate':
        return t('newWorkOrder.failure.rateLimited', { seconds: current.seconds });
      case 'server':
        return t('newWorkOrder.failure.server', { code: current.code });
    }
  };

  const summaryItems = ORDER_FIELDS.flatMap((field) => {
    const message = errors[field];
    return message === undefined ? [] : [{ field, message }];
  });

  let shownTitle = defaultTitle(chosen);
  if (details.titleEdited) shownTitle = details.title;
  else if (details.choice === EMPTY_CHOICE) shownTitle = t('newWorkOrder.order.defaultTitle');
  const people = users.data ?? [];
  const assignee = details.assigneeId === '' ? userId : details.assigneeId;
  const assigneeOptions = people.some((person) => person.id === userId) ? people : [{ id: userId, displayName: userName }, ...people];

  const section = (field: OrderField) => (element: HTMLElement | null) => {
    sections.current[field] = element;
  };

  return (
    <div className="flex flex-col gap-inline-lg expanded:flex-row">
      <div className="flex w-full max-w-form-max-width flex-col gap-stack-lg">
        <header className="flex flex-col gap-stack-xs">
          <ExpandedProbe probeRef={probe} />
          <h1 className="font-display text-heading-1 text-text-primary">{t('newWorkOrder.title')}</h1>
          <p className="text-body text-text-secondary">{t('newWorkOrder.numberHint')}</p>
          {draft.savedAt === null || !started ? null : (
            <p className="text-body-sm text-text-secondary">
              {t('newWorkOrder.draft', { time: formatClock(draft.savedAt) })}
              <span className="block text-text-tertiary">{t('newWorkOrder.draftInfo')}</span>
            </p>
          )}
        </header>
        {online ? null : <Banner icon={WifiOff}>{t('newWorkOrder.offline')}</Banner>}
        {summaryItems.length === 0 ? null : (
          <ErrorSummary title={t('newWorkOrder.summary')} items={summaryItems} onSelect={focusField} summaryRef={summary} />
        )}
        {failure === null ? null : (
          <InlineAlert tone="error" alertRef={alert}>
            {failureText(failure)}
          </InlineAlert>
        )}
        <fieldset disabled={mutation.isPending} className="flex min-w-0 flex-col gap-stack-lg">
          <fieldset ref={section('customer')} className="flex flex-col gap-stack-md">
            <legend className="mb-stack-sm text-heading-4 text-text-primary">{t('customers.section')}</legend>
            <CustomerPicker
              selected={customer}
              onSelect={choose}
              onClear={() => {
                choose(null);
              }}
              onAdd={() => {
                setAdding(true);
              }}
            />
            {errors.customer === undefined ? null : <FieldError>{errors.customer}</FieldError>}
          </fieldset>
          <fieldset ref={section('site')} className="flex flex-col gap-stack-md">
            <legend className="mb-stack-sm text-heading-4 text-text-primary">{t('sites.section')}</legend>
            <LocationSection value={location} onChange={changeLocation} />
            {errors.site === undefined ? null : <FieldError>{errors.site}</FieldError>}
          </fieldset>
          <section aria-labelledby="work-order-template" className="flex flex-col gap-stack-md">
            <h2 id="work-order-template" className="text-heading-4 text-text-primary">
              {t('newWorkOrder.template.section')}
            </h2>
            <TemplateSection
              templates={templates}
              siteType={siteType}
              showAll={details.showAll}
              onShowAll={(showAll) => {
                changeDetails({ showAll });
              }}
              choice={details.choice}
              onChoose={(choice) => {
                changeDetails({ choice }, 'template');
                setUnavailable(null);
              }}
              error={errors.template}
              unavailable={unavailable}
              unavailableRef={unavailableAlert}
              firstRadioRef={firstTemplate}
              expanded={expanded}
            />
          </section>
          <fieldset className="flex flex-col gap-stack-md">
            <legend className="mb-stack-sm text-heading-4 text-text-primary">{t('newWorkOrder.order.section')}</legend>
            <div ref={section('title')}>
              <TextField
                label={t('newWorkOrder.order.title')}
                value={shownTitle}
                autoComplete="off"
                {...(errors.title === undefined ? {} : { error: errors.title })}
                onChange={(event) => {
                  changeDetails({ title: event.target.value, titleEdited: true }, 'title');
                }}
              />
            </div>
            <div ref={section('assignee')}>
              <Select
                label={t('newWorkOrder.order.assignee')}
                value={assignee}
                options={assigneeOptions.map((person) => ({ value: person.id, label: person.displayName }))}
                {...(errors.assignee === undefined ? {} : { error: errors.assignee })}
                onChange={(value) => {
                  changeDetails({ assigneeId: value }, 'assignee');
                }}
              />
            </div>
            <div ref={section('plannedDate')}>
              <DateField
                label={t('newWorkOrder.order.plannedDate')}
                value={details.plannedDate}
                min={PLANNED_DATE_MIN}
                max={PLANNED_DATE_MAX}
                {...(errors.plannedDate === undefined ? {} : { error: errors.plannedDate })}
                onChange={(plannedDate) => {
                  changeDetails({ plannedDate }, 'plannedDate');
                }}
              />
            </div>
            <div ref={section('description')}>
              <TextArea
                label={t('newWorkOrder.order.description')}
                value={details.description}
                hint={t('newWorkOrder.order.descriptionHint')}
                {...(errors.description === undefined ? {} : { error: errors.description })}
                onChange={(event) => {
                  changeDetails({ description: event.target.value }, 'description');
                }}
              />
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
                {...(online ? {} : { 'aria-describedby': 'work-order-offline-hint' })}
                onClick={submit}
              >
                {t('newWorkOrder.submit')}
              </Button>
              {online ? null : (
                <p id="work-order-offline-hint" className="text-body-sm text-text-secondary">
                  {t('newWorkOrder.offlineHint')}
                </p>
              )}
            </div>
          </div>
        </fieldset>
        <AddCustomerDialog
          open={adding}
          onClose={() => {
            setAdding(false);
          }}
          onCreated={(created) => {
            setAdding(false);
            choose(created);
            toast(t('customers.dialog.added'));
          }}
          onPick={(picked) => {
            setAdding(false);
            choose(picked);
          }}
        />
        <AlertDialog
          open={confirmingCancel}
          title={t('newWorkOrder.discard.title')}
          onDismiss={() => {
            setConfirmingCancel(false);
          }}
          actions={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  discardDraft(DRAFT);
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
      {expanded ? (
        <aside
          aria-label={t('newWorkOrder.template.previewTitle')}
          aria-live="polite"
          className="sticky top-stack-lg min-w-0 flex-1 self-start"
        >
          {chosen === undefined ? null : <TemplatePreview template={chosen} card />}
        </aside>
      ) : null}
    </div>
  );
}
