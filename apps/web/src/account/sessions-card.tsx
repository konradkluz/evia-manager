import type { AccountSession } from '@evia/contracts';
import { Banner, Button, Card, DataTable, Info, Skeleton, type DataTableColumn, type DataTableRow } from '@evia/ui-web';
import { useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { relativeTime } from '../work-orders/journal-entry.tsx';
import { formatClock } from '../work-orders/format.ts';
import { AccountFailureAlert } from './account-failure-alert.tsx';
import { browserLabel, type AccountSessionsState } from './use-account-sessions.ts';

/**
 * W-15 "Moje sesje" (EVM-028 AC6, AC8; SR-SESS-07, SR-SESS-04, P9): "Pokaż sesje" loads the own sessions of the web (the server asks for
 * a step-up first — W-04 — and decides again for each change); the table shows the browser and the system from a closed dictionary,
 * the FULL IP address (own sessions only), the last activity and "Ta sesja" instead of a button for the current one (it is ended by
 * "Wyloguj"). One session is "Konto jest zalogowane tylko w tej przeglądarce." — no table and no "Zakończ pozostałe sesje". Offline the
 * loaded list stays under a banner with its time and the buttons are off. The sessions live in the memory of the tab only.
 */
export function SessionsCard({
  state,
  online,
  now,
}: {
  readonly state: AccountSessionsState;
  readonly online: boolean;
  readonly now: number;
}) {
  const { t } = useTranslation();
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const { sessions, justLoaded } = state;

  // After the list is shown the focus goes to the heading of the table (flows/12 → W-15 "Dostępność").
  useEffect(() => {
    if (justLoaded > 0) heading.current?.focus();
  }, [justLoaded]);

  const columns: DataTableColumn[] = [
    { id: 'browser', header: t('account.sessions.browser'), card: 'primary' },
    { id: 'ip', header: t('account.sessions.ip'), card: 'detail', cardLabel: true },
    { id: 'seen', header: t('account.sessions.seen'), card: 'detail', cardLabel: true },
    { id: 'action', header: t('account.sessions.action'), card: 'detail' },
  ];
  const lastSeen = (session: AccountSession): string => {
    const at = Date.parse(session.lastSeenAt);
    return session.current && now - at < 60_000 ? t('account.sessions.now') : relativeTime(t, session.lastSeenAt, now);
  };
  const rows: DataTableRow[] =
    sessions?.items.map((session) => ({
      id: session.id,
      label: `${browserLabel(session)}${session.current ? `, ${t('account.sessions.current')}` : ''}`,
      cells: [
        browserLabel(session),
        // The address is plain text of the server; a session without one shows a dash.
        <span key="ip" className="font-mono text-mono">
          {session.ipAddress ?? t('account.sessions.noIp')}
        </span>,
        lastSeen(session),
        session.current ? (
          <span key="current" className="text-label">
            {t('account.sessions.current')}
          </span>
        ) : (
          <Button
            key="end"
            variant="secondary"
            className="max-medium:w-full max-medium:min-h-touch-target-min max-medium:whitespace-nowrap"
            aria-label={t('account.sessions.endLabel', {
              name: browserLabel(session),
              ip: session.ipAddress ?? t('account.sessions.noIp'),
            })}
            loading={state.endingOne === session.id}
            disabled={!online || state.endingOne !== null || state.endingOthers}
            onClick={() => {
              state.endOne(session);
            }}
          >
            {t('account.sessions.end')}
          </Button>
        ),
      ],
    })) ?? [];
  const alone = sessions !== null && sessions.items.length <= 1;

  return (
    <Card labelledBy={`${id}-title`}>
      <h2 id={`${id}-title`} className="text-heading-3">
        {t('account.sessions.title')}
      </h2>
      <p className="text-body text-text-secondary">{t('account.sessions.intro')}</p>
      {state.failure === null ? null : <AccountFailureAlert failure={state.failure} notFound={t('account.sessions.notFound')} />}
      {sessions === null ? (
        <>
          {state.loading ? (
            <div aria-busy="true" className="flex flex-col gap-stack-sm">
              <p role="status" className="text-body text-text-secondary">
                {t('account.sessions.loading')}
              </p>
              <Skeleton />
              <Skeleton />
              <Skeleton className="w-1/2" />
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-inline-md">
            <Button variant="secondary" aria-expanded={false} loading={state.loading} disabled={!online} onClick={state.load}>
              {t('account.sessions.show')}
            </Button>
            {online ? null : <p className="text-body-sm text-text-tertiary">{t('account.offlineHint')}</p>}
          </div>
        </>
      ) : (
        <>
          {online ? null : (
            <Banner icon={Info} tone="info">
              {t('account.sessions.stale', { time: formatClock(sessions.at) })}
            </Banner>
          )}
          {alone ? (
            <p className="text-body">{t('account.sessions.alone')}</p>
          ) : (
            <>
              <h3 ref={heading} tabIndex={-1} className="text-label focus-visible:focus-ring">
                {t('account.sessions.tableHeading', { count: sessions.items.length })}
              </h3>
              <DataTable caption={t('account.sessions.caption')} columns={columns} rows={rows} />
              <div>
                <Button
                  variant="secondary"
                  loading={state.endingOthers}
                  disabled={!online || state.endingOne !== null}
                  onClick={state.endOthers}
                >
                  {t('account.sessions.endOthers')}
                </Button>
              </div>
            </>
          )}
          <p className="text-body-sm text-text-secondary">{t('account.sessions.limit')}</p>
        </>
      )}
    </Card>
  );
}
