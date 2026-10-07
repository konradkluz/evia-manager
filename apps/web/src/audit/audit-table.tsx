import type { AuditEvent, AuditOutcome } from '@evia/contracts';
import { CircleAlert, CircleCheck, CircleHelp, DataTable, ShieldX, type DataTableColumn, type DataTableRow, type Icon } from '@evia/ui-web';
import { useTranslation } from 'react-i18next';
import { auditActionLabels, auditObjectTypeLabels, auditOutcomeLabels, SYSTEM_ACTIONS } from '../i18n/audit-labels.ts';
import { formatEventTime } from './period.ts';

/** Icon and colour role of an outcome (§ "Status konta, stan zaproszenia i wynik zdarzenia"): never the colour alone. */
const OUTCOME_ICONS: Readonly<Record<AuditOutcome, { readonly icon: Icon; readonly tone: string }>> = {
  success: { icon: CircleCheck, tone: 'text-icon-success' },
  denied: { icon: ShieldX, tone: 'text-icon-warning' },
  failed: { icon: CircleAlert, tone: 'text-icon-error' },
};

const has = <T extends object>(record: T, key: string): key is Extract<keyof T, string> => Object.hasOwn(record, key);

/**
 * The table of W-18 (EVM-029 AC5; docs/ux/flows/12-konto-i-administracja.md → "Zasady komórek"): time in Warsaw, the
 * person by `displayName` (never an e-mail), the action by its label, the outcome as icon + word, the object as type and
 * identifier, the address only as its prefix. A value an older panel does not know is shown as "Nieznana …", never raw.
 */
export function AuditTable({ items }: { readonly items: readonly AuditEvent[] }) {
  const { t } = useTranslation();
  const columns: DataTableColumn[] = [
    { id: 'time', header: t('audit.table.time'), numeric: true },
    { id: 'actor', header: t('audit.table.actor') },
    { id: 'action', header: t('audit.table.action') },
    { id: 'outcome', header: t('audit.table.outcome') },
    { id: 'object', header: t('audit.table.object') },
    { id: 'ip', header: t('audit.table.ip') },
  ];
  const rows: DataTableRow[] = items.map((event) => {
    const time = formatEventTime(event.occurredAt);
    const action = has(auditActionLabels, event.action) ? auditActionLabels[event.action] : t('audit.table.unknownAction');
    const known = has(OUTCOME_ICONS, event.outcome);
    const outcome = known ? auditOutcomeLabels[event.outcome] : t('audit.table.unknownOutcome');
    const marker = known ? OUTCOME_ICONS[event.outcome] : { icon: CircleHelp, tone: 'text-icon-secondary' };
    const OutcomeIcon = marker.icon;
    const actor =
      event.actor === null
        ? SYSTEM_ACTIONS.has(event.action)
          ? t('audit.table.system')
          : t('audit.table.anonymous')
        : (event.actor.displayName ?? t('audit.table.anonymized'));
    return {
      id: event.id,
      label: t('audit.table.row', { action, time, outcome }),
      cells: [
        time,
        actor,
        action,
        <span key="outcome" className="inline-flex items-center gap-inline-sm">
          <OutcomeIcon aria-hidden="true" className={`size-icon-sm shrink-0 ${marker.tone}`} />
          {outcome}
        </span>,
        <span key="object" className="flex flex-col">
          <span>
            {has(auditObjectTypeLabels, event.objectType) ? auditObjectTypeLabels[event.objectType] : t('audit.table.unknownObject')}
          </span>
          {event.objectId === null ? null : <span className="font-mono text-mono text-text-secondary break-all">{event.objectId}</span>}
        </span>,
        event.ipPrefix === null ? (
          t('audit.table.none')
        ) : (
          <span key="ip" className="font-mono text-mono">
            {event.ipPrefix}
          </span>
        ),
      ],
    };
  });
  return <DataTable caption={t('audit.table.caption')} columns={columns} rows={rows} />;
}
