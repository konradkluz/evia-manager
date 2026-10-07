import { AlertDialog, Button, EmptyState, Lock } from '@evia/ui-web';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AddCustomerDialog } from '../customers/add-customer-dialog.tsx';
import { CustomerPicker, type PickedCustomer } from '../customers/customer-picker.tsx';
import { WORK_ORDERS_PATH } from '../paths.ts';
import { discardDraft, readDraft, saveDraft } from '../session/draft-store.ts';
import { useSession } from '../session/session.ts';
import { useToast } from '../shell/toast-context.tsx';
import { usePageTitle } from '../shell/use-page-title.ts';
import { EMPTY_LOCATION, LocationSection, locationStarted, type LocationState } from '../sites/location-section.tsx';
import { formatClock } from '../work-orders/format.ts';

/** Name of the draft of this form in the memory of the tab (`session/draft-store.ts`; never any other store, SR-WEB-05). */
const DRAFT = 'work-order-new';

interface Draft {
  readonly customer: PickedCustomer | null;
  readonly location: LocationState;
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

/** The draft as it was saved; anything else (a broken text) is no draft. */
function restore(userId: string): Draft | null {
  const stored = readDraft(userId, DRAFT);
  if (stored === undefined) return null;
  try {
    const value = JSON.parse(stored) as unknown;
    if (!isObject(value) || typeof value.savedAt !== 'number') return null;
    const customer = restoreCustomer(value.customer);
    const location = restoreLocation(value.location);
    return customer === undefined || location === undefined ? null : { customer, location, savedAt: value.savedAt };
  } catch {
    return null;
  }
}

/**
 * W-05 "Nowe zlecenie" (EVM-020): so far the section "1. Klient" — the search of customers and the dialog "Dodaj klienta";
 * the section "2. Lokalizacja" (EVM-021) comes with it; the template with the save (EVM-022) come next. Only Administrator and Edytor create work orders:
 * Tylko odczyt gets the state "Nie możesz tworzyć zleceń." — the UI is a convenience, the server decides (`403`).
 */
export function NewWorkOrderPage() {
  const { t } = useTranslation();
  const session = useSession();
  const role = session.data?.user.role;
  const allowed = role === 'administrator' || role === 'editor';
  usePageTitle(allowed ? t('newWorkOrder.title') : t('newWorkOrder.denied.pageTitle'));
  const userId = session.data?.user.id;
  return allowed && userId !== undefined ? <NewWorkOrderForm userId={userId} /> : <Denied />;
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

function NewWorkOrderForm({ userId }: { readonly userId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(() => restore(userId) ?? { customer: null, location: EMPTY_LOCATION, savedAt: null });
  const [adding, setAdding] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const { customer, location } = draft;
  const started = customer !== null || locationStarted(location);

  // The draft lives in the memory of the tab, owned by this person; it is saved at every change (§ 4.1).
  useEffect(() => {
    if (draft.savedAt === null) return;
    if (started) saveDraft(userId, DRAFT, JSON.stringify(draft));
    else discardDraft(DRAFT);
  }, [draft, started, userId]);

  const choose = (picked: PickedCustomer | null) => {
    setDraft((current) => ({ ...current, customer: picked, savedAt: Date.now() }));
  };
  const changeLocation = (update: (current: LocationState) => LocationState) => {
    setDraft((current) => ({ ...current, location: update(current.location), savedAt: Date.now() }));
  };

  const leave = () => {
    void navigate({ to: WORK_ORDERS_PATH });
  };

  return (
    <div className="flex max-w-form-max-width flex-col gap-stack-lg">
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
      <fieldset className="flex flex-col gap-stack-md">
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
      </fieldset>
      <fieldset className="flex flex-col gap-stack-md">
        <legend className="mb-stack-sm text-heading-4 text-text-primary">{t('sites.section')}</legend>
        <LocationSection value={location} onChange={changeLocation} />
      </fieldset>
      <div className="flex flex-wrap justify-start gap-inline-md">
        <Button
          variant="tertiary"
          onClick={() => {
            if (!started) leave();
            else setConfirmingCancel(true);
          }}
        >
          {t('newWorkOrder.cancel')}
        </Button>
      </div>
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
  );
}
