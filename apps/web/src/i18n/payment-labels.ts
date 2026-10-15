import type { PaymentMilestoneStatus } from '@evia/contracts';

/**
 * Labels of the statuses of an instalment (styleguide § 4.4, `color.status.payment.*`), kept as a map like the other status
 * labels of the panel: the label is chosen by the status. "Po terminie" is the computed mark of an `invoiced` instalment whose due
 * date has passed (`isOverdue`) — shown instead of "Wystawiona", never a status of the model.
 */
export const paymentStatusLabels: Readonly<Record<PaymentMilestoneStatus, string>> = {
  planned: 'Planowana',
  invoiced: 'Wystawiona',
  paid: 'Opłacona',
  cancelled: 'Anulowana',
};
