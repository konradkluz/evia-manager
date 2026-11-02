import { listDevices, type DeviceState, type ManagedDevice } from '@evia/contracts';
import {
  Button,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  EmptyState,
  InlineAlert,
  Select,
  Shield,
  Skeleton,
  Smartphone,
} from '@evia/ui-web';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessDenied } from '../administration/access-denied.tsx';
import { pluralOf } from '../account/plural.ts';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import { LogoutDeviceDialog, WipeDeviceDialog } from '../devices/device-dialogs.tsx';
import { DEVICES_KEY, stateLabel } from '../devices/device-view.ts';
import { DevicesTable } from '../devices/devices-table.tsx';
import { serverNow } from '../session/server-clock.ts';
import { useSession } from '../session/session.ts';
import { withRotationRetry } from '../session/step-up.ts';
import { useStepUp } from '../session/step-up-context.tsx';
import { useToast } from '../shell/toast-context.tsx';
import { useNow } from '../shell/use-now.ts';
import { useOnline } from '../shell/use-online.ts';
import { usePageTitle } from '../shell/use-page-title.ts';

/** Devices on a page (the API limit is 100). */
const PAGE_SIZE = 25;
const STATES: readonly DeviceState[] = ['active', 'signed_out', 'wipe_required', 'wiped'];

const isStepUpRequired = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 403 && error.code === 'step_up_required';
const isForbidden = (error: unknown): boolean => error instanceof ApiError && error.status === 403 && error.code !== 'step_up_required';
const isBadCursor = (error: unknown): boolean =>
  error instanceof ApiError &&
  error.status === 400 &&
  (error.code === 'invalid_cursor' || error.errors.some((entry) => entry.pointer.endsWith('cursor')));

/**
 * W-17 "Urządzenia" (EVM-095 AC2–AC4, AC6): the devices of all users, for an Administrator only (the panel does not even ask without
 * the role; Edytor and Tylko odczyt get "Brak dostępu" and the server answers `403` without data). The list asks for a step-up on
 * entry (W-04 opens on `403 step_up_required`, once; "Anuluj" leaves an empty state and no data, and the data lives in the memory of
 * the tab only — SR-WEB-05). Filters (user, state) and cursor pages as in the audit log. "Wyloguj urządzenie…" and "Zablokuj i wyczyść…"
 * are dialogs of their own; the result is a toast and a fresh list.
 */
export function DevicesPage() {
  const { t } = useTranslation();
  const session = useSession();
  const isAdministrator = session.data?.user.role === 'administrator';
  usePageTitle(isAdministrator ? t('devices.title') : t('audit.denied.pageTitle'));
  return isAdministrator ? <DevicesList /> : <AccessDenied />;
}

function DevicesList() {
  const { t } = useTranslation();
  const client = useApi();
  const requestStepUp = useStepUp();
  const online = useOnline();
  const showToast = useToast();
  const now = serverNow(useNow(30_000));
  const [userId, setUserId] = useState('');
  const [state, setState] = useState<DeviceState | ''>('');
  const [cursors, setCursors] = useState<readonly string[]>([]);
  const [people, setPeople] = useState<ReadonlyMap<string, string>>(new Map());
  const [notice, setNotice] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [logout, setLogout] = useState<ManagedDevice | null>(null);
  const [wipe, setWipe] = useState<ManagedDevice | null>(null);
  const [declined, setDeclined] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef<'next' | 'previous' | null>(null);
  const asked = useRef(false);
  const cursor = cursors.at(-1);

  const query = useQuery({
    queryKey: [DEVICES_KEY, userId, state, cursor ?? null],
    queryFn: ({ signal }) =>
      withRotationRetry(() =>
        unwrap(
          listDevices({
            client,
            signal,
            query: {
              limit: PAGE_SIZE,
              ...(userId === '' ? {} : { userId }),
              ...(state === '' ? {} : { state }),
              ...(cursor === undefined ? {} : { cursor }),
            },
          }),
        ),
      ),
    retry: false,
    // Names of people and models are personal data: nothing stays in the cache once the page is left (SR-WEB-05).
    gcTime: 0,
  });
  const { data, error } = query;
  const stepUpNeeded = isStepUpRequired(error);

  // The people seen so far feed the filter of the user (the list of accounts is another page).
  useEffect(() => {
    if (data === undefined) return;
    setPeople((known) => {
      const next = new Map(known);
      for (const { user } of data.items) next.set(user.userId, user.displayName);
      return next.size === known.size ? known : next;
    });
  }, [data]);

  useEffect(() => {
    if (data === undefined || moved.current === null) return;
    setAnnouncement(moved.current === 'next' ? t('audit.pages.loadedNext') : t('audit.pages.loadedPrevious'));
    moved.current = null;
    heading.current?.focus();
  }, [data, t]);

  const badCursor = cursors.length > 0 && isBadCursor(error);
  useEffect(() => {
    if (!badCursor) return;
    setCursors([]);
    setNotice(true);
  }, [badCursor]);

  /** W-04 once per entry: after the confirmation the same request is repeated; "Anuluj" leaves the empty state (no data, no request). */
  const confirm = useCallback(async () => {
    if (!(await requestStepUp(t('stepUp.title.viewDevices')))) {
      setDeclined(true);
      return;
    }
    setDeclined(false);
    await query.refetch();
  }, [requestStepUp, t, query]);
  useEffect(() => {
    if (!stepUpNeeded || asked.current) return;
    asked.current = true;
    void confirm();
  }, [stepUpNeeded, confirm]);

  const change = (nextUser: string, nextState: DeviceState | '') => {
    moved.current = null;
    setNotice(false);
    setCursors([]);
    setUserId(nextUser);
    setState(nextState);
  };
  const go = (direction: 'next' | 'previous') => {
    moved.current = direction;
    setNotice(false);
    if (direction === 'next') {
      if (data?.nextCursor) setCursors([...cursors, data.nextCursor]);
    } else setCursors(cursors.slice(0, -1));
  };
  const done = (message: string) => {
    setLogout(null);
    setWipe(null);
    showToast(message);
    void query.refetch();
  };
  const gone = () => {
    setLogout(null);
    setWipe(null);
    showToast(t('devices.notFound'));
    void query.refetch();
  };

  if (isForbidden(error)) return <AccessDenied />;

  const filtered = userId !== '' || state !== '';
  const count = data?.items.length ?? 0;
  const countText =
    pluralOf(count) === 'one'
      ? t('devices.countOne', { count })
      : pluralOf(count) === 'few'
        ? t('devices.countFew', { count })
        : t('devices.countMany', { count });
  const retry = (
    <Button
      onClick={() => {
        void query.refetch();
      }}
    >
      {t('devices.error.retry')}
    </Button>
  );

  return (
    <div className="flex flex-col gap-stack-md">
      <h1 className="font-display text-heading-1 text-text-primary">{t('devices.title')}</h1>
      <form
        aria-label={t('devices.filters.label')}
        className="flex flex-wrap items-end gap-inline-md"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <Select
          label={t('devices.filters.user')}
          value={userId}
          disabled={!online}
          options={[{ value: '', label: t('devices.filters.allUsers') }, ...[...people].map(([id, name]) => ({ value: id, label: name }))]}
          onChange={(value) => {
            change(value, state);
          }}
        />
        <Select
          label={t('devices.filters.state')}
          value={state}
          disabled={!online}
          options={[
            { value: '', label: t('devices.filters.allStates') },
            ...STATES.map((known) => ({ value: known, label: stateLabel(t, known) })),
          ]}
          onChange={(value) => {
            change(userId, STATES.find((known) => known === value) ?? '');
          }}
        />
        {data === undefined ? null : <p className="pb-stack-xs text-body-sm text-text-secondary">{countText}</p>}
      </form>
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {notice ? <InlineAlert tone="info">{t('devices.error.cursorReset')}</InlineAlert> : null}
      {stepUpNeeded ? (
        declined ? (
          <EmptyState
            icon={Shield}
            title={t('devices.confirm.title')}
            description={t('devices.confirm.description')}
            action={
              <Button
                onClick={() => {
                  void confirm();
                }}
              >
                {t('devices.confirm.action')}
              </Button>
            }
          />
        ) : null
      ) : error !== null && !badCursor ? (
        <EmptyState icon={CircleAlert} title={t('devices.error.title')} description={t('devices.error.description')} action={retry} />
      ) : data === undefined ? (
        <div aria-busy="true" className="flex flex-col gap-stack-sm">
          <p role="status" className="text-body text-text-secondary">
            {t('devices.loading')}
          </p>
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} shape="field" />
          ))}
        </div>
      ) : data.items.length === 0 ? (
        <EmptyState
          icon={Smartphone}
          title={filtered ? t('devices.empty.filtered') : t('devices.empty.title')}
          description={filtered ? t('devices.empty.filteredHint') : t('devices.empty.description')}
          action={
            filtered ? (
              <Button
                variant="secondary"
                onClick={() => {
                  change('', '');
                }}
              >
                {t('devices.filters.clear')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <h2 ref={heading} tabIndex={-1} className="sr-only focus-visible:focus-ring">
            {t('devices.table.caption')}
          </h2>
          <DevicesTable devices={data.items} online={online} now={now} onLogout={setLogout} onWipe={setWipe} />
          <nav aria-label={t('devices.pages.label')} className="flex flex-wrap items-center justify-center gap-inline-md">
            <Button
              variant="secondary"
              icon={ChevronLeft}
              disabled={!online || cursors.length === 0}
              onClick={() => {
                go('previous');
              }}
            >
              {t('devices.pages.previous')}
            </Button>
            <Button
              variant="secondary"
              icon={ChevronRight}
              disabled={!online || !data.nextCursor}
              onClick={() => {
                go('next');
              }}
            >
              {t('devices.pages.next')}
            </Button>
            {online ? null : <p className="text-body-sm text-text-tertiary">{t('devices.pages.offlineHint')}</p>}
          </nav>
        </>
      )}
      {logout === null ? null : (
        <LogoutDeviceDialog
          device={logout}
          onClose={() => {
            setLogout(null);
          }}
          onDone={() => {
            done(t('devices.logout.done'));
          }}
          onGone={gone}
        />
      )}
      {wipe === null ? null : (
        <WipeDeviceDialog
          device={wipe}
          onClose={() => {
            setWipe(null);
          }}
          onDone={() => {
            done(t('devices.wipe.done'));
          }}
          onGone={gone}
        />
      )}
    </div>
  );
}
