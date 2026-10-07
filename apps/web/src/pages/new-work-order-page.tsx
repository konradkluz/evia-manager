import { AlertDialog, Button, EmptyState, Lock } from '@evia/ui-web';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AddCustomerDialog } from '../customers/add-customer-dialog.tsx';
import { CustomerPicker, type PickedCustomer } from '../customers/customer-picker.tsx';
import { WORK_ORDERS_PATH } from '../paths.ts';
import { discardDraft, readDraft, saveDraft } from '../session/draft-store.ts';
import { useSession } from '../session/session.ts';
import { useToast } from '../shell/toast-context.tsx';
import { usePageTitle } from '../shell/use-page-title.ts';
import { formatClock } from '../work-orders/format.ts';

/** Name of the draft of this form in the memory of the tab (`session/draft-store.ts`; never any other store, SR-WEB-05). */
const DRAFT = 'work-order-new';

interface Draft {
  readonly customer: PickedCustomer | null;
  readonly savedAt: number;
}

/** The draft as it was saved; anything else (a broken text) is no draft. */
function restore(userId: string): Draft | null {
  const stored = readDraft(userId, DRAFT);
  if (stored === undefined) return null;
  try {
    const value = JSON.parse(stored) as Partial<Draft> | null;
    const customer = value?.customer;
    if (
      customer === null ||
      customer === undefined ||
      typeof customer.id !== 'string' ||
      typeof customer.displayName !== 'string' ||
      typeof customer.phone !== 'string' ||
      typeof value?.savedAt !== 'number'
    ) {
      return null;
    }
    return { customer, savedAt: value.savedAt };
  } catch {
    return null;
  }
}

/**
 * W-05 "Nowe zlecenie" (EVM-020): so far the section "1. Klient" — the search of customers and the dialog "Dodaj klienta";
 * the location (EVM-021) and the template with the save (EVM-022) come next. Only Administrator and Edytor create work orders:
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
  const [draft, setDraft] = useState<Draft | null>(() => restore(userId));
  const [adding, setAdding] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const customer = draft?.customer ?? null;

  // The draft lives in the memory of the tab, owned by this person; it is saved at every change (§ 4.1).
  const choose = (picked: PickedCustomer | null) => {
    if (picked === null) {
      discardDraft(DRAFT);
      setDraft(null);
      return;
    }
    const next = { customer: picked, savedAt: Date.now() };
    saveDraft(userId, DRAFT, JSON.stringify(next));
    setDraft(next);
  };

  const leave = () => {
    void navigate({ to: WORK_ORDERS_PATH });
  };

  return (
    <div className="flex max-w-form-max-width flex-col gap-stack-lg">
      <header className="flex flex-col gap-stack-xs">
        <h1 className="font-display text-heading-1 text-text-primary">{t('newWorkOrder.title')}</h1>
        <p className="text-body text-text-secondary">{t('newWorkOrder.numberHint')}</p>
        {draft === null ? null : (
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
      <div className="flex flex-wrap justify-start gap-inline-md">
        <Button
          variant="tertiary"
          onClick={() => {
            if (customer === null) leave();
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
