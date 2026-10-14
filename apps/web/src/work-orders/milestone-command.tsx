import {
  listPaymentMilestones,
  transitionPaymentMilestone,
  updatePaymentMilestone,
  type PaymentMilestone,
  type PaymentMilestoneList,
  type PaymentMilestonePatch,
  type PaymentMilestoneTransition,
} from '@evia/contracts';
import { Button, InlineAlert } from '@evia/ui-web';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import { useAttempt } from '../forms/attempt.ts';
import { refusesAttempt } from '../forms/save-failure.ts';
import { paymentStatusLabels } from '../i18n/payment-labels.ts';
import { useSession } from '../session/session.ts';
import { useStateWord } from './edit-failure.ts';
import { etagOf, normalizeName } from './milestone-form.ts';
import {
  UNPAID_PAYMENTS_KEY,
  WORK_ORDER_HEADER_KEY,
  WORK_ORDER_JOURNAL_KEY,
  WORK_ORDER_PAYMENTS_KEY,
  WORK_ORDERS_KEY,
} from './query-keys.ts';

/** The range of the days the API accepts for the invoice, the due date and the payment (Q3a; `out_of_range` otherwise). */
export const DAY_MIN = '2000-01-01';
export const DAY_MAX = '2100-12-31';
/** The longest invoice number the API accepts (code points after NFC and trimming). */
export const INVOICE_NUMBER_MAX = 60;
/** The longest reason of a cancellation the API accepts. */
export const MILESTONE_REASON_MAX = 500;

const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** What is wrong with a free text (the invoice number, the reason) in the codes of the API — or `undefined` when it may be sent. */
export function plainTextProblem(text: string, max: number): 'required' | 'too_long' | 'invalid_characters' | undefined {
  const value = normalizeName(text);
  if (value === '') return 'required';
  if (CONTROL_CHARACTERS.test(value)) return 'invalid_characters';
  if ((value.match(/./gsu) ?? []).length > max) return 'too_long';
  return undefined;
}

/** A calendar day `YYYY-MM-DD` within 2000–2100. */
export const isDayInRange = (day: string): boolean => DAY.test(day) && day >= DAY_MIN && day <= DAY_MAX;

const dayMs = (day: string): number => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));

/** `2026-10-03` + 7 → `2026-10-10`: calendar arithmetic, never through a time zone (the server counts the default the same way). */
export function addDays(day: string, days: number): string {
  return new Date(dayMs(day) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (both calendar days). */
export const daysBetween = (from: string, to: string): number => Math.round((dayMs(to) - dayMs(from)) / DAY_MS);

/** The label of a status for the sentences of the dialogs; a status the panel does not know is "Nieznany status" (P-12). */
export function useMilestoneStatusLabel(): (status: string) => string {
  const { t } = useTranslation();
  return (status) =>
    Object.hasOwn(paymentStatusLabels, status)
      ? paymentStatusLabels[status as keyof typeof paymentStatusLabels]
      : t('workOrders.status.unknown');
}

export type MilestoneField = 'amount' | 'invoiceNumber' | 'invoicedOn' | 'dueDate' | 'paidOn' | 'reason';
export type MilestoneFieldErrors = Partial<Record<MilestoneField, string>>;
const FIELDS: readonly MilestoneField[] = ['amount', 'invoiceNumber', 'invoicedOn', 'dueDate', 'paidOn', 'reason'];

/** The message under a field for a code of the API or of the check before sending (flows/08, EVM-054 → "Walidacja"). */
export function useFieldMessage(): (field: MilestoneField, code: string) => string {
  const { t } = useTranslation();
  return (field, code) => {
    switch (field) {
      case 'amount':
        return code === 'precision' ? t('workOrder.paymentDialog.amountPrecision') : t('workOrder.paymentDialog.amountRequired');
      case 'invoiceNumber':
        if (code === 'too_long') return t('workOrder.milestoneDialog.invoiceNumberTooLong', { max: INVOICE_NUMBER_MAX });
        if (code === 'invalid_characters') return t('workOrder.milestoneDialog.invoiceNumberInvalid');
        return t('workOrder.milestoneDialog.invoiceNumberRequired');
      case 'reason':
        if (code === 'too_long') return t('workOrder.milestoneDialog.reasonTooLong', { max: MILESTONE_REASON_MAX });
        if (code === 'invalid_characters') return t('workOrder.milestoneDialog.reasonInvalid');
        return t('workOrder.milestoneDialog.reasonRequired');
      case 'invoicedOn':
      case 'dueDate':
      case 'paidOn':
        if (code === 'before_invoiced_on') return t('workOrder.milestoneDialog.dueBeforeInvoiced');
        if (code === 'in_future') return t('workOrder.milestoneDialog.paidOnFuture');
        if (code === 'required' && field === 'dueDate') return t('workOrder.milestoneDialog.dueDateRequired');
        return t('workOrder.milestoneDialog.dateRange');
    }
  };
}

/** Why a command did not go through, as the dialog tells it; the answers carry no values (SR-ERR-02), the texts come from i18n. */
export type CommandFailure =
  /** `412` or `409 invalid_state_transition`: the instalment as it is now (read again), "Odśwież" takes its version. */
  | { readonly kind: 'changed'; readonly status: string; readonly version: number }
  | { readonly kind: 'closed' | 'gone' | 'forbidden' | 'failed' | 'inProgress' }
  | { readonly kind: 'rate'; readonly seconds: number };

/**
 * The order a command is about, as much as the dialogs need: W-06 has the whole order, W-11 only the reference of the row (the
 * identifier, the number and the title; EVM-055). `status` is unknown in W-11 — the alert of a closed order then says it without the state.
 */
export interface MilestoneOrder {
  readonly id: string;
  readonly number: string;
  readonly title: string;
  readonly status?: string;
}

/** What a command needs of the instalment it was opened for (the row of W-11 carries no more than this). */
export type OpenedMilestone = Pick<PaymentMilestone, 'id' | 'name' | 'invoiceNumber' | 'amount' | 'dueDate' | 'status' | 'version'>;

export type CommandRequest =
  | { readonly kind: 'transition'; readonly body: PaymentMilestoneTransition }
  | { readonly kind: 'patch'; readonly body: PaymentMilestonePatch };

/**
 * One command on an instalment (EVM-054): the transition (`POST …/transitions`) or the correction of the data (`PATCH`), always with
 * `If-Match` of the version the dialog was opened with and an `Idempotency-Key` that stays the same for a retry of the same content
 * (a lost answer never makes a second change — § 6.4). The typed data lives only in the dialog (memory of the tab).
 * - success: the list shows the saved instalment at once and is read again (the totals), the journal and the list of orders too;
 * - `412` / `409 invalid_state_transition`: the list is read again and the alert names the status of now;
 * - `409 work_order_closed`, `404`, `403`, `429`, `409 idempotency_in_progress`, `428` and the failures of the network — the alert;
 * - `400` (and `422 transition_condition_not_met` of a day of the payment in the future) — the messages under the fields.
 */
export function useMilestoneCommand(order: MilestoneOrder, opened: OpenedMilestone) {
  const client = useApi();
  const queryClient = useQueryClient();
  const attempt = useAttempt();
  const message = useFieldMessage();
  const [version, setVersion] = useState(opened.version);
  const [failure, setFailure] = useState<CommandFailure | null>(null);
  const [fieldErrors, setFieldErrors] = useState<MilestoneFieldErrors>({});
  const paymentsKey = [WORK_ORDER_PAYMENTS_KEY, order.id];

  const mutation = useMutation({
    mutationFn: ({ request, key, base }: { readonly request: CommandRequest; readonly key: string; readonly base: number }) => {
      const options = {
        client,
        path: { workOrderId: order.id, milestoneId: opened.id },
        headers: { 'If-Match': etagOf(base), 'Idempotency-Key': key },
      };
      return unwrap(
        request.kind === 'transition'
          ? transitionPaymentMilestone({ ...options, body: request.body })
          : updatePaymentMilestone({ ...options, body: request.body }),
      );
    },
  });

  /**
   * Reads the instalments of the order again and returns this one as the server has it now (`undefined` — gone). The read is made
   * here, not only refreshed: in W-11 nothing else holds the instalments of the order (the list shows invoiced ones only, so a paid
   * one is gone from it). A failed read leaves what the cache had. The unpaid list is read again too (EVM-055).
   */
  const reread = async (): Promise<PaymentMilestone | undefined> => {
    void queryClient.invalidateQueries({ queryKey: [UNPAID_PAYMENTS_KEY] });
    let list: PaymentMilestoneList | undefined;
    try {
      list = await queryClient.query({
        queryKey: paymentsKey,
        queryFn: ({ signal }) => unwrap(listPaymentMilestones({ client, signal, path: { workOrderId: order.id } })),
        staleTime: 0,
        gcTime: 0,
      });
    } catch {
      list = queryClient.getQueryData<PaymentMilestoneList>(paymentsKey);
    }
    return list?.items.find((entry) => entry.id === opened.id);
  };

  const fieldsOf = (error: ApiError): MilestoneFieldErrors => {
    const found: MilestoneFieldErrors = {};
    for (const entry of error.errors) {
      const field = FIELDS.find((name) => entry.pointer === `/${name}` || entry.pointer.startsWith(`/${name}/`));
      if (field !== undefined && found[field] === undefined) found[field] = message(field, entry.code);
    }
    return found;
  };

  const onError = (error: unknown) => {
    if (refusesAttempt(error)) attempt.forget();
    if (!(error instanceof ApiError) || error.status === 0 || error.status >= 500) {
      setFailure({ kind: 'failed' });
      return;
    }
    if (error.status === 412 || (error.status === 409 && error.code === 'invalid_state_transition')) {
      void reread().then((fresh) => {
        setFailure(fresh === undefined ? { kind: 'gone' } : { kind: 'changed', status: fresh.status, version: fresh.version });
      });
      return;
    }
    if (error.status === 409 && error.code === 'work_order_closed') {
      setFailure({ kind: 'closed' });
      void queryClient.refetchQueries({ queryKey: [WORK_ORDER_HEADER_KEY, order.id] });
      return;
    }
    if (error.status === 409 && error.code === 'idempotency_in_progress') {
      setFailure({ kind: 'inProgress' });
      return;
    }
    if (error.status === 404) {
      setFailure({ kind: 'gone' });
      void queryClient.refetchQueries({ queryKey: paymentsKey });
      return;
    }
    if (error.status === 403) {
      setFailure({ kind: 'forbidden' });
      return;
    }
    if (error.status === 429) {
      setFailure({ kind: 'rate', seconds: error.retryAfterSeconds ?? 60 });
      return;
    }
    const fields = error.status === 400 || error.status === 422 ? fieldsOf(error) : {};
    if (Object.keys(fields).length > 0) {
      setFieldErrors(fields);
      return;
    }
    setFailure({ kind: 'failed' });
  };

  return {
    version,
    failure,
    fieldErrors,
    setFieldErrors,
    pending: mutation.isPending,
    /** Sends the command; `onSaved` gets the instalment as the server saved it. */
    run(request: CommandRequest, onSaved: (saved: PaymentMilestone) => void) {
      const { key } = attempt.next(JSON.stringify({ milestone: opened.id, version, request }));
      setFailure(null);
      mutation.mutate(
        { request, key, base: version },
        {
          onSuccess: (saved) => {
            attempt.forget();
            queryClient.setQueryData<PaymentMilestoneList>(paymentsKey, (list) =>
              list === undefined ? list : { ...list, items: list.items.map((entry) => (entry.id === saved.id ? saved : entry)) },
            );
            void queryClient.invalidateQueries({ queryKey: paymentsKey });
            // EVM-054 AC3: a change of the status wrote an event of the journal; an open "Dziennik" shows it without a reload.
            void queryClient.invalidateQueries({ queryKey: [WORK_ORDER_JOURNAL_KEY, order.id] });
            void queryClient.invalidateQueries({ queryKey: [WORK_ORDERS_KEY] });
            // EVM-055: the unpaid list (W-11) is the same fact: a paid or corrected instalment changes its rows, tiles and sum.
            void queryClient.invalidateQueries({ queryKey: [UNPAID_PAYMENTS_KEY] });
            onSaved(saved);
          },
          onError,
        },
      );
    },
    /**
     * "Odśwież" of the alert of a change in the meantime: the instalment still in the status the dialog was opened in — the next save
     * uses its version and the typed data stays; in another status the dialog has nothing to do (`false` — the caller closes it).
     */
    adopt(): boolean {
      if (failure?.kind !== 'changed' || failure.status !== opened.status) return false;
      setVersion(failure.version);
      setFailure(null);
      return true;
    },
  };
}

/** The alert of a failed command in the dialog (`role="alert"` of InlineAlert error; README → zasada wspólna 16, § 6.4). */
export function CommandAlert({
  failure,
  orderStatus,
  onRefresh,
}: {
  readonly failure: CommandFailure | null;
  readonly orderStatus: string | undefined;
  readonly onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const role = useSession().data?.user.role;
  const stateWord = useStateWord();
  const statusLabel = useMilestoneStatusLabel();
  if (failure === null) return null;
  const text = (() => {
    switch (failure.kind) {
      case 'changed':
        return t('workOrder.milestoneDialog.changed', { status: statusLabel(failure.status) });
      case 'closed': {
        if (orderStatus === undefined) {
          return role === 'editor' ? t('workOrder.paymentDialog.closedUnknownEditor') : t('workOrder.paymentDialog.closedUnknown');
        }
        const state = stateWord(orderStatus);
        return role === 'editor' ? t('workOrder.paymentDialog.closedEditor', { state }) : t('workOrder.paymentDialog.closed', { state });
      }
      case 'gone':
        return t('workOrder.paymentDialog.milestoneGone');
      case 'forbidden':
        return t('workOrder.milestoneDialog.forbidden');
      case 'inProgress':
        return t('workOrder.paymentDialog.inProgress');
      case 'rate':
        return t('workOrder.paymentDialog.rateLimited', { seconds: failure.seconds });
      case 'failed':
        return t('workOrder.milestoneDialog.failed');
    }
  })();
  return (
    <InlineAlert
      tone="error"
      {...(failure.kind === 'changed'
        ? {
            action: (
              <Button variant="tertiary" onClick={onRefresh}>
                {t('workOrder.milestoneDialog.refresh')}
              </Button>
            ),
          }
        : {})}
    >
      {text}
    </InlineAlert>
  );
}
