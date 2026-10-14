import type { TFunction } from 'i18next';
import { PROCEDURES_MAX, STAGES_MAX, type ManageFailure } from './procedure-manage.ts';

/**
 * The sentence of a failure of an operation on a process or a stage (EVM-042 AC1, AC3, AC4, AC6, AC7), the same wording in every
 * dialog. The answers carry no values, so the texts name nothing but the object the person acted on. A closed order is told with the
 * word for its state ("rozliczone", "anulowane"), the Editor is told that an administrator restores the order.
 */
export function manageFailureText(
  t: TFunction,
  failure: ManageFailure,
  context: { readonly object: 'procedure' | 'stage'; readonly role: string | undefined; readonly state: string },
): string {
  const stage = context.object === 'stage';
  switch (failure.kind) {
    case 'conflict':
      return stage ? t('workOrder.procedureManage.conflictStage') : t('workOrder.procedureManage.conflict');
    case 'closed':
      return context.role === 'editor'
        ? t('workOrder.procedureManage.closedEditor', { state: context.state })
        : t('workOrder.procedureManage.closed', { state: context.state });
    case 'gone':
      return stage ? t('workOrder.procedureManage.goneStage') : t('workOrder.procedureManage.gone');
    case 'forbidden':
      return t('workOrder.procedureManage.forbidden');
    case 'rate':
      return t('workOrder.procedureManage.rateLimited', { seconds: failure.seconds });
    case 'server':
      return t('workOrder.procedureManage.server', { code: failure.code });
    case 'inProgress':
      return t('workOrder.procedureManage.inProgress');
    case 'tooManyProcedures':
      return t('workOrder.procedureManage.limitProcedures', { max: PROCEDURES_MAX });
    case 'tooManyStages':
      return t('workOrder.procedureManage.limitStages', { max: STAGES_MAX });
    case 'templateUnavailable':
      return t('workOrder.procedureManage.addProcedure.unavailable');
    case 'parentDeleted':
      return t('workOrder.procedureManage.deleted.parentDeleted');
    case 'active':
    case 'limit':
    case 'proceduresLimit':
    case 'invalid':
    case 'network':
      return t('workOrder.procedureManage.network');
  }
}
