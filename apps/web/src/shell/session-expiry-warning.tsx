import { extendSession, type CurrentSession } from '@evia/contracts';
import { AlertDialog, Button, InlineAlert } from '@evia/ui-web';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { unwrap } from '../api/client.ts';
import { serverNow } from '../session/server-clock.ts';
import { SESSION_KEY, sessionQueryOptions } from '../session/session.ts';
import { useLogout } from '../session/use-logout.ts';
import { useNow } from './use-now.ts';
import { useOnline } from './use-online.ts';

const MINUTE = 60_000;
/** The warning comes 2 min before the end of inactivity, or 10 min before the 12 h limit — whichever is earlier (§ 4.17). */
const IDLE_WARNING_MS = 2 * MINUTE;
const LIMIT_WARNING_MS = 10 * MINUTE;
/** A local clock tick (no request): it only decides when to ask the server. */
const TICK_MS = 15_000;

const clock = new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw' });

/**
 * P-11 "Sesja wygasa" (EVM-067 AC6, AC5; styleguide § 4.17; WCAG 2.2.1, SR-SESS-03, TM-10, SR-WEB-05). The deadlines come
 * from the server (`idleExpiresAt`, `absoluteExpiresAt`); the clock of the tab only schedules a question. Before the
 * dialog shows — and again when the end is reached, after waking up or returning to the tab — the tab asks the server
 * with the passive read of the session, which never moves the end of inactivity. If the server says the session is gone
 * (`401`), the cache handler clears the data and the gate leaves for W-01 at once. The tab never keeps a session alive by
 * itself: there is no interval query and no ping; only "Przedłuż sesję" extends it, and only the inactivity.
 */
export function SessionExpiryWarning({ session }: { readonly session: CurrentSession }) {
  const { t } = useTranslation();
  const client = useApi();
  const queryClient = useQueryClient();
  const online = useOnline();
  const { logout, pending: loggingOut } = useLogout();
  const localNow = useNow(TICK_MS);
  const [, refresh] = useReducer((count: number) => count + 1, 0);
  // The deadlines are the server's: they are compared with the time of the server (the `Date` header of the last read).
  const now = serverNow(localNow);

  const idleMs = Date.parse(session.idleExpiresAt);
  const absoluteMs = Date.parse(session.absoluteExpiresAt);
  const endMs = Math.min(idleMs, absoluteMs);
  const idleWarning = idleMs - IDLE_WARNING_MS;
  const limitWarning = absoluteMs - LIMIT_WARNING_MS;
  const limitVariant = limitWarning <= idleWarning;
  const warnAt = Math.min(idleWarning, limitWarning);
  // The deadlines are the identity of "this" warning: an extension (here or in another tab) changes them.
  const key = `${session.idleExpiresAt}|${session.absoluteExpiresAt}`;
  const stage = now >= endMs ? 'ended' : now >= warnAt ? 'warn' : 'quiet';

  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const asked = useRef<string | null>(null);

  useEffect(() => {
    if (stage === 'quiet' || !online) return;
    const mark = `${key}|${stage}`;
    if (asked.current === mark) return;
    asked.current = mark;
    queryClient
      .query({ ...sessionQueryOptions(client), staleTime: 0 })
      .then(() => {
        setConfirmed(key);
        // The read may have taught the tab a new difference to the clock of the server: draw again with it.
        refresh();
        // After the end the server said "still alive" (a clock that runs fast, an extension elsewhere): keep asking on
        // every tick until it says `401`, so the data never stays on the screen of an expired session.
        if (stage === 'ended' && asked.current === mark) asked.current = null;
      })
      .catch(() => {
        // `401` is handled by the cache (data cleared, the gate leaves); any other failure is asked again on a later tick.
        if (asked.current === mark) asked.current = null;
      });
  }, [stage, key, now, online, client, queryClient]);

  const extend = useMutation({
    mutationFn: () => unwrap(extendSession({ client })),
    onSuccess: (expiry) => {
      queryClient.setQueryData<CurrentSession>(SESSION_KEY, (current) => (current === undefined ? current : { ...current, ...expiry }));
    },
  });

  const open = stage !== 'quiet' && confirmed === key && dismissed !== key;
  const dismiss = () => {
    setDismissed(key);
  };
  const minutes = Math.max(1, Math.ceil((endMs - now) / MINUTE));

  return (
    <AlertDialog
      open={open}
      title={t('expiry.title')}
      onDismiss={dismiss}
      actions={
        <>
          {limitVariant ? (
            <Button data-initial-focus onClick={dismiss}>
              {t('expiry.understood')}
            </Button>
          ) : (
            <Button
              data-initial-focus
              loading={extend.isPending}
              disabled={!online}
              onClick={() => {
                extend.mutate();
              }}
            >
              {t('expiry.extend')}
            </Button>
          )}
          <Button variant="tertiary" loading={loggingOut} onClick={logout}>
            {t('shell.logout')}
          </Button>
        </>
      }
    >
      <p>{limitVariant ? t('expiry.limit', { time: clock.format(absoluteMs) }) : t('expiry.idle', { minutes })}</p>
      {limitVariant || online ? null : <p className="text-body-sm text-text-tertiary">{t('expiry.extendOffline')}</p>}
      {extend.isError ? <InlineAlert tone="error">{t('expiry.extendFailed')}</InlineAlert> : null}
    </AlertDialog>
  );
}
