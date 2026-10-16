import { listUsers, type User, type UserList } from '@evia/contracts';
import {
  Banner,
  Button,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  EmptyState,
  InlineAlert,
  Plus,
  Skeleton,
  TriangleAlert,
  Users,
} from '@evia/ui-web';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessDenied } from '../administration/access-denied.tsx';
import { InviteUserDialog } from '../administration/invite-user-dialog.tsx';
import { USERS_KEY } from '../administration/query-keys.ts';
import { ResendInvitationDialog } from '../administration/resend-invitation-dialog.tsx';
import { UsersTable } from '../administration/users-table.tsx';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import { serverNow } from '../session/server-clock.ts';
import { useSession } from '../session/session.ts';
import { withRotationRetry } from '../session/step-up.ts';
import { useNow } from '../shell/use-now.ts';
import { useOnline } from '../shell/use-online.ts';
import { usePageTitle } from '../shell/use-page-title.ts';
import { useToast } from '../shell/toast-context.tsx';
import { formatClock } from '../work-orders/format.ts';
import { retryMinutes } from './login-failure.tsx';

/** A page of the list (flows/12 → W-16: pagination from the 26th account). */
const PAGE_SIZE = 25;
/** After this long a load is called slow (styleguide § 4.12). */
const SLOW_MS = 10_000;

const isBadCursor = (error: unknown): boolean => error instanceof ApiError && error.status === 400 && error.code === 'invalid_cursor';
const isForbidden = (error: unknown): boolean => error instanceof ApiError && error.status === 403;

/**
 * W-16 "Użytkownicy" (EVM-024 AC1, AC4, AC5, AC7, AC8): the accounts in the Polish alphabet, 25 on a page with a cursor, "Zaproś
 * użytkownika" and "Wyślij ponownie" (a step-up each — the server decides, W-04 opens on `403 step_up_required`). The list needs no
 * step-up. The page is for an Administrator only: Edytor and Tylko odczyt see "Brak dostępu" and the panel does not ask the API; the
 * server authorizes every request anyway (SR-AUTHZ-11). E-mails and names are personal data: the page does not stay in the cache
 * once it is left (SR-WEB-05) and never in the address, the title of the tab or a store of the browser.
 */
export function UsersPage() {
  const { t } = useTranslation();
  const session = useSession();
  const isAdministrator = session.data?.user.role === 'administrator';
  usePageTitle(isAdministrator ? t('users.title') : t('audit.denied.pageTitle'));
  return isAdministrator && session.data !== undefined ? <UsersList selfId={session.data.user.id} /> : <AccessDenied />;
}

function UsersList({ selfId }: { readonly selfId: string }) {
  const { t } = useTranslation();
  const client = useApi();
  const queryClient = useQueryClient();
  const online = useOnline();
  const showToast = useToast();
  const now = serverNow(useNow(30_000));
  /** Cursors of the pages passed through: empty = the first page, the last = the current one. */
  const [cursors, setCursors] = useState<readonly string[]>([]);
  const [lastPage, setLastPage] = useState<{ readonly list: UserList; readonly at: number } | null>(null);
  const [notice, setNotice] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [inviting, setInviting] = useState(false);
  const [resending, setResending] = useState<User | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef<'next' | 'previous' | null>(null);
  const names = useRef(new Map<string, HTMLElement>());
  const cursor = cursors.at(-1);

  const query = useQuery({
    queryKey: [USERS_KEY, cursor ?? null],
    queryFn: ({ signal }) =>
      withRotationRetry(() =>
        unwrap(listUsers({ client, signal, query: { limit: PAGE_SIZE, ...(cursor === undefined ? {} : { cursor }) } })),
      ),
    retry: false,
    // E-mails and names are personal data: the page does not stay in the cache once it is left (SR-WEB-05).
    gcTime: 0,
  });
  const { data, error } = query;

  // The last loaded page stays in the memory of this tab only — the offline view shows it under a banner.
  useEffect(() => {
    if (data !== undefined) setLastPage({ list: data, at: query.dataUpdatedAt });
  }, [data, query.dataUpdatedAt]);

  // After a change of page the focus goes to the heading of the table and the change is announced (WCAG 2.4.3, 4.1.3).
  useEffect(() => {
    if (data === undefined || moved.current === null) return;
    setAnnouncement(moved.current === 'next' ? t('users.pages.loadedNext') : t('users.pages.loadedPrevious'));
    moved.current = null;
    heading.current?.focus();
  }, [data, t]);

  // A cursor the server no longer accepts: back to the first page with a message.
  const badCursor = cursors.length > 0 && isBadCursor(error);
  useEffect(() => {
    if (!badCursor) return;
    setCursors([]);
    setNotice(true);
  }, [badCursor]);

  // The connection is back: a list that failed meanwhile is read again.
  const failed = error !== null && !badCursor;
  useEffect(() => {
    if (online && failed && error instanceof ApiError && error.status === 0) void query.refetch();
    // Only the return of the connection matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  // "Pokaż konto": the focus goes to the name of the account in its row once the dialog is closed.
  useEffect(() => {
    if (shown === null) return;
    const element = names.current.get(shown);
    element?.scrollIntoView({ block: 'center' });
    element?.focus();
    setShown(null);
  }, [shown, data]);

  const refresh = () => {
    setNotice(false);
    void queryClient.invalidateQueries({ queryKey: [USERS_KEY] });
  };
  const find = (id: string): User | undefined => (data ?? lastPage?.list)?.items.find((user) => user.id === id);
  const go = (direction: 'next' | 'previous') => {
    moved.current = direction;
    setNotice(false);
    if (direction === 'next') {
      if (data?.nextCursor) setCursors([...cursors, data.nextCursor]);
    } else setCursors(cursors.slice(0, -1));
  };

  if (isForbidden(error)) return <AccessDenied />;

  const stale = data === undefined && error !== null && !online && lastPage !== null;
  const list = data ?? (stale ? lastPage.list : undefined);
  const onlyOwn =
    list !== undefined && cursors.length === 0 && list.nextCursor === null && list.items.length === 1 && list.items[0]?.id === selfId;
  const activeAdministrators =
    list === undefined ? [] : list.items.filter((user) => user.role === 'administrator' && user.status === 'active');
  // Only a whole list can say "the only one": with more pages the rest is not known.
  const sole =
    list !== undefined &&
    cursors.length === 0 &&
    list.nextCursor === null &&
    activeAdministrators.length === 1 &&
    activeAdministrators[0]?.id === selfId;
  const hint = online ? undefined : t('users.offlineHint');
  const rateLimited = error instanceof ApiError && error.status === 429;

  const inviteButton = (variant: 'primary' | 'secondary') => (
    <Button
      variant={variant}
      className="max-medium:w-full"
      icon={Plus}
      disabled={!online}
      {...(hint === undefined ? {} : { title: hint })}
      onClick={() => {
        setInviting(true);
      }}
    >
      {t('users.invite')}
    </Button>
  );

  return (
    <div className="flex flex-col gap-stack-md">
      <div className="flex flex-wrap items-center justify-between gap-inline-md">
        <h1 className="font-display text-heading-1 text-text-primary">{t('users.title')}</h1>
        {list === undefined ? null : inviteButton('primary')}
      </div>
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {notice ? <InlineAlert tone="info">{t('users.error.cursorReset')}</InlineAlert> : null}
      {stale ? <Banner icon={CircleAlert}>{t('users.stale', { time: formatClock(lastPage.at) })}</Banner> : null}
      {sole ? <Banner icon={TriangleAlert}>{t('users.soleAdministrator')}</Banner> : null}
      {failed && !stale ? (
        rateLimited ? (
          <InlineAlert
            tone="error"
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  void query.refetch();
                }}
              >
                {t('users.error.retry')}
              </Button>
            }
          >
            {t('users.error.rateLimited', { minutes: retryMinutes(error) })}
          </InlineAlert>
        ) : (
          <EmptyState
            icon={CircleAlert}
            title={t('users.error.title')}
            description={t('users.error.description')}
            action={
              <Button
                onClick={() => {
                  void query.refetch();
                }}
              >
                {t('users.error.retry')}
              </Button>
            }
          />
        )
      ) : list === undefined ? (
        <Loading />
      ) : (
        <>
          <h2 ref={heading} tabIndex={-1} className="text-heading-3 text-text-primary focus-visible:focus-ring">
            {t('users.table.heading', { count: PAGE_SIZE })}
          </h2>
          <UsersTable
            users={list.items}
            selfId={selfId}
            online={online}
            now={now}
            onResend={setResending}
            nameRef={(id, element) => {
              if (element === null) names.current.delete(id);
              else names.current.set(id, element);
            }}
          />
          {onlyOwn ? (
            <EmptyState
              icon={Users}
              title={t('users.empty.title')}
              description={t('users.empty.description')}
              action={inviteButton('secondary')}
            />
          ) : null}
          <nav aria-label={t('users.pages.label')} className="flex flex-wrap items-center justify-center gap-inline-md">
            <Button
              variant="secondary"
              icon={ChevronLeft}
              disabled={!online || cursors.length === 0}
              onClick={() => {
                go('previous');
              }}
            >
              {t('users.pages.previous')}
            </Button>
            <Button
              variant="secondary"
              icon={ChevronRight}
              disabled={!online || !list.nextCursor}
              onClick={() => {
                go('next');
              }}
            >
              {t('users.pages.next')}
            </Button>
            {online ? null : <p className="text-body-sm text-text-tertiary">{t('users.pages.offlineHint')}</p>}
          </nav>
        </>
      )}
      <InviteUserDialog
        open={inviting}
        find={find}
        onClose={() => {
          setInviting(false);
        }}
        onInvited={() => {
          setInviting(false);
          showToast(t('users.toast.invited'));
          refresh();
        }}
        onShowAccount={(id) => {
          setInviting(false);
          setShown(id);
        }}
      />
      <ResendInvitationDialog
        user={resending}
        now={now}
        onClose={() => {
          setResending(null);
        }}
        onResent={() => {
          setResending(null);
          showToast(t('users.toast.resent'));
          refresh();
        }}
        onRefresh={refresh}
      />
    </div>
  );
}

/** Skeleton of the rows (styleguide § 4.12) with a text status; after 10 s it says the load takes longer than usual. */
function Loading() {
  const { t } = useTranslation();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = globalThis.setTimeout(() => {
      setSlow(true);
    }, SLOW_MS);
    return () => {
      globalThis.clearTimeout(timer);
    };
  }, []);
  return (
    <div aria-busy="true" className="flex flex-col gap-stack-sm">
      <p role="status" className="text-body text-text-secondary">
        {slow ? t('users.loading.slow') : t('shell.loading')}
      </p>
      {Array.from({ length: 5 }, (_, index) => (
        <Skeleton key={index} shape="field" />
      ))}
    </div>
  );
}
