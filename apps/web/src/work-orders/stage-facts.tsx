import type { ProcedureStage } from '@evia/contracts';
import { TriangleAlert } from '@evia/ui-web';
import { useTranslation } from 'react-i18next';
import { formatDueDate } from './procedure-format.ts';
import { LONG_WAIT_DAYS } from './stage-transitions.ts';

/**
 * What a status of a stage adds to its row (EVM-032 AC8): "Czekamy na: Stoen Operator (OSD) · od 15 dni" with `triangle-alert` and the
 * text colour of a warning above 14 days (the icon and a hidden sentence carry the meaning, the colour never alone), the reason of a
 * block and the day of completion. The days are counted by the server (`waitingDays`, `Europe/Warsaw`). The name of the party and the
 * reason are free text: rendered as React text only (SR-WEB-03).
 */
export function StageFacts({ stage }: { readonly stage: ProcedureStage }) {
  const { t } = useTranslation();
  const days = stage.waitingDays;
  const since =
    days === null || days <= 0
      ? t('workOrder.stage.sinceToday')
      : days === 1
        ? t('workOrder.stage.sinceYesterday')
        : t('workOrder.stage.sinceDays', { count: days });
  const who =
    stage.waitingParty?.displayName ?? (stage.waitingOn === 'customer' ? t('workOrder.stage.whoCustomer') : t('workOrder.stage.whoParty'));
  const longWait = days !== null && days > LONG_WAIT_DAYS;
  return (
    <>
      {stage.status !== 'waiting' || stage.waitingOn === null ? null : (
        <span
          className={`inline-flex flex-wrap items-center gap-inline-xs text-body-sm ${longWait ? 'text-text-warning' : 'text-text-secondary'}`}
        >
          {longWait ? <TriangleAlert aria-hidden="true" className="size-icon-sm shrink-0" /> : null}
          <span className="break-words">{t('workOrder.stage.waiting', { who, since })}</span>
          {longWait ? <span className="sr-only">{t('workOrder.stage.longWait')}</span> : null}
        </span>
      )}
      {stage.status !== 'blocked' || stage.blockedReason === null ? null : (
        <span className="break-words text-body-sm text-text-secondary">
          {t('workOrder.stage.blockedReason', { reason: stage.blockedReason })}
        </span>
      )}
      {stage.status !== 'done' || stage.completedOn === null ? null : (
        <span className="text-body-sm text-text-secondary">
          {t('workOrder.stage.completedOn', { date: formatDueDate(stage.completedOn) })}
        </span>
      )}
    </>
  );
}
