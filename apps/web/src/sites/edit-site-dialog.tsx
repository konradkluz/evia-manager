import { updateSite, type Party, type Site } from '@evia/contracts';
import { Banner, Button, Dialog, InlineAlert, WifiOff } from '@evia/ui-web';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import { StateDialog } from '../forms/dialog-states.tsx';
import { DiscardDialog } from '../forms/discard-dialog.tsx';
import { useAttempt } from '../forms/attempt.ts';
import { fieldErrorText } from '../forms/field-error-text.ts';
import { describeFailure, refusesAttempt, type SaveFailure } from '../forms/save-failure.ts';
import { AddPartyDialog } from '../parties/add-party-dialog.tsx';
import { MANAGER_KINDS, OSD_KINDS } from '../parties/party-form.ts';
import type { PickedParty } from '../parties/party-picker.tsx';
import { useParty } from '../parties/use-party.ts';
import { useOnline } from '../shell/use-online.ts';
import { isNotFound } from '../work-orders/use-work-order.ts';
import { formatAddress, formatSpot } from './format.ts';
import { buildSitePatch, changedSiteFields, currentSiteText, siteEditOf, type SiteEdit } from './site-edit.ts';
import { SiteFields, type PartyTarget, type SiteFieldElement } from './site-fields.tsx';
import { firstInvalidSite, invalidFields, siteFieldOf, type SiteFieldErrors, type SiteFieldName } from './site-form.ts';
import { useSite } from './use-site.ts';

export interface EditSiteDialogProps {
  readonly siteId: string;
  /** The number of orders of the site that the person may see (this one included); `undefined` when it could not be counted. */
  readonly orderCount: number | undefined;
  /** Closing: the saved site, or `undefined` when nothing was saved. */
  readonly onClose: (saved?: Site) => void;
  /** The site is gone (`404`): "Odśwież zlecenie" closes the dialog and reads the order again. */
  readonly onRefresh: () => void;
}

const etagOf = (version: number): string => `"${String(version)}"`;
const asPicked = (party: Party): PickedParty => ({
  id: party.id,
  kind: party.kind,
  legalForm: party.legalForm,
  displayName: party.displayName,
});

/**
 * Dialog "Edytuj lokalizację" (EVM-036 AC1, AC2, AC4; W-20): reads the site (skeleton, error with "Spróbuj ponownie", "Nie znaleziono
 * lokalizacji") and the two parties it points at (their names and kinds for the comboboxes), then hands over to the form.
 */
export function EditSiteDialog(props: EditSiteDialogProps) {
  const { t } = useTranslation();
  const site = useSite(props.siteId);
  const osd = useParty(site.data?.distributionSystemOperatorPartyId);
  const manager = useParty(site.data?.managerPartyId);
  // What the form was opened with: once it is there it stays, whatever a later read of the site or a party does (typed data is never lost).
  const [opened, setOpened] = useState<{
    readonly site: Site;
    readonly osd: PickedParty | null;
    readonly manager: PickedParty | null;
  } | null>(null);
  const title = t('siteEdit.title');
  const close = () => {
    props.onClose();
  };

  // A disabled read (the site has no such party) or one that is done counts as settled.
  const settled = (query: typeof osd) => query.status !== 'pending' || query.fetchStatus === 'idle';
  if (opened === null && site.data !== undefined && settled(osd) && settled(manager) && !partyFailed(osd, manager)) {
    setOpened({
      site: site.data,
      osd: osd.data === undefined ? null : asPicked(osd.data),
      manager: manager.data === undefined ? null : asPicked(manager.data),
    });
  }
  if (opened !== null) {
    return <EditSiteForm {...props} {...opened} refresh={async () => (await site.refetch()).data} />;
  }

  if (isNotFound(site.error)) {
    return (
      <StateDialog
        title={title}
        onClose={close}
        state={{ kind: 'gone', text: t('siteEdit.gone'), actionLabel: t('siteEdit.refresh'), onAction: props.onRefresh }}
      />
    );
  }
  if (site.isError || partyFailed(osd, manager)) {
    return (
      <StateDialog
        title={title}
        onClose={close}
        state={{
          kind: 'error',
          text: t('siteEdit.loadError'),
          retryLabel: t('siteEdit.retry'),
          onRetry: () => {
            if (site.isError) void site.refetch();
            if (osd.isError) void osd.refetch();
            if (manager.isError) void manager.refetch();
          },
        }}
      />
    );
  }
  return <StateDialog title={title} onClose={close} state={{ kind: 'loading', text: t('siteEdit.loading') }} />;
}

/** A party that is gone (404) is no party of the site any more: the field is empty. Any other failure to read one is an error. */
const partyFailed = (...queries: Array<{ readonly isError: boolean; readonly error: unknown }>): boolean =>
  queries.some((query) => query.isError && !isNotFound(query.error));

type Failure = SaveFailure | { readonly kind: 'conflict' };

function EditSiteForm({
  site,
  osd: osd0,
  manager: manager0,
  orderCount,
  refresh,
  onClose,
  onRefresh,
}: EditSiteDialogProps & {
  readonly site: Site;
  readonly osd: PickedParty | null;
  readonly manager: PickedParty | null;
  readonly refresh: () => Promise<Site | undefined>;
}) {
  const { t } = useTranslation();
  const client = useApi();
  const online = useOnline();
  // What the dialog was opened with stays the reference of "what was touched", also after a refresh of the site.
  const [initial] = useState(() => siteEditOf(site, osd0, manager0));
  const [current, setCurrent] = useState<SiteEdit>(initial);
  const [version, setVersion] = useState(site.version);
  const [latest, setLatest] = useState<Site | null>(null);
  const [errors, setErrors] = useState<SiteFieldErrors>({});
  const [failure, setFailure] = useState<Failure | null>(null);
  const [view, setView] = useState<'form' | PartyTarget | 'discard'>('form');
  const [gone, setGone] = useState(false);
  const [notice, setNotice] = useState('');
  const [focusRequest, setFocusRequest] = useState(0);
  const formId = useId();
  const attempt = useAttempt();
  const fields = useRef<Partial<Record<SiteFieldName, SiteFieldElement | null>>>({});
  const alert = useRef<HTMLDivElement>(null);
  const addRefs = { osd: useRef<HTMLButtonElement>(null), manager: useRef<HTMLButtonElement>(null) };
  const summaryRefs = { osd: useRef<HTMLParagraphElement>(null), manager: useRef<HTMLParagraphElement>(null) };
  // Where the focus goes when the form comes back after "Dodaj stronę": the new choice, or the button the person came from.
  const comeBack = useRef<{ readonly target: PartyTarget; readonly created: boolean } | null>(null);

  const mutation = useMutation({
    mutationFn: (request: { readonly body: ReturnType<typeof buildSitePatch>; readonly key: string; readonly version: number }) =>
      unwrap(
        updateSite({
          client,
          path: { siteId: site.id },
          body: request.body,
          headers: { 'If-Match': etagOf(request.version), 'Idempotency-Key': request.key },
        }),
      ),
  });

  const touched = changedSiteFields(initial, current);
  const dirty = touched.length > 0;
  // The fields the person changed and somebody else changed too: their value now is shown under the field (the parties are not).
  const conflicts: SiteFieldName[] =
    latest === null
      ? []
      : touched.filter((field) => {
          if (field === 'osd' || field === 'manager') return false;
          const mine = changedSiteFields(siteEditOf(latest, current.osd, current.manager), current);
          const theirs = changedSiteFields(initial, siteEditOf(latest, current.osd, current.manager));
          return mine.includes(field) && theirs.includes(field);
        });

  // After a failed save the focus goes to the first invalid field, or after a conflict to the first field with "Aktualnie: …",
  // or to the message; only a new attempt asks for it — fixing one field must not pull the focus to another.
  useEffect(() => {
    if (focusRequest === 0) return;
    const invalid = firstInvalidSite(errors);
    const target = invalid ?? conflicts[0];
    if (target !== undefined) fields.current[target]?.focus();
    else if (failure !== null) alert.current?.focus();
    // Only the request matters here: it is bumped together with the errors and the failure it concerns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);

  // The form is back from "Dodaj stronę" (WCAG 2.4.3): the focus goes where the person was.
  useEffect(() => {
    if (view !== 'form' || comeBack.current === null) return;
    const { target, created } = comeBack.current;
    comeBack.current = null;
    (created ? summaryRefs[target].current : addRefs[target].current)?.focus();
    // The refs are stable; only the return to the form matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const clearError = (field: SiteFieldName) => {
    setErrors((existing) =>
      existing[field] === undefined ? existing : Object.fromEntries(Object.entries(existing).filter(([name]) => name !== field)),
    );
  };

  const dismiss = () => {
    if (dirty && !mutation.isPending) setView('discard');
    else onClose();
  };

  const submit = () => {
    const invalid = Object.entries(invalidFields(current.form)) as Array<[SiteFieldName, 'required' | 'invalid_format']>;
    if (invalid.length > 0) {
      setErrors(Object.fromEntries(invalid.map(([field, code]) => [field, fieldErrorText(t, field, code)])));
      setFailure(null);
      setFocusRequest((value) => value + 1);
      return;
    }
    const body = buildSitePatch(initial, current);
    // Nothing changed: nothing to save (a patch would raise the version and write to the audit log for no reason).
    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }
    const { key } = attempt.next(JSON.stringify({ body, version }));
    setErrors({});
    setFailure(null);
    setNotice('');
    mutation.mutate(
      { body, key, version },
      {
        onSuccess: (saved) => {
          onClose(saved);
        },
        onError: (error) => {
          if (refusesAttempt(error)) attempt.forget();
          if (error instanceof ApiError && error.status === 404) {
            setGone(true);
            return;
          }
          if (error instanceof ApiError && error.status === 412) {
            setFailure({ kind: 'conflict' });
            setErrors({});
            // The answer carries no values: the site is read again and the fresh version is used by the next save.
            void refresh().then((fresh) => {
              if (fresh !== undefined) {
                setLatest(fresh);
                setVersion(fresh.version);
              }
              setFocusRequest((value) => value + 1);
            });
            return;
          }
          const mapped: SiteFieldErrors = {};
          if (error instanceof ApiError && error.status === 400) {
            for (const entry of error.errors) {
              const field = siteFieldOf(entry);
              if (field !== undefined && mapped[field] === undefined) mapped[field] = fieldErrorText(t, field, entry.code);
            }
          }
          setErrors(mapped);
          setFailure(describeFailure(error, Object.keys(mapped).length > 0));
          setFocusRequest((value) => value + 1);
        },
      },
    );
  };

  const failureText = (failed: Failure): string => {
    switch (failed.kind) {
      case 'conflict':
        return t('siteEdit.conflict');
      case 'fields':
        return t('siteEdit.failure.fields');
      case 'network':
        return t('siteEdit.failure.network');
      case 'inProgress':
        return t('siteEdit.failure.inProgress');
      case 'forbidden':
        return t('siteEdit.failure.forbidden');
      case 'rate':
        return t('siteEdit.failure.rateLimited', { seconds: failed.seconds });
      case 'server':
        return t('siteEdit.failure.server', { code: failed.code });
    }
  };

  /** A field with "Aktualnie: …" under it when somebody else changed it while the dialog was open (plain text, SR-WEB-03). */
  const decorate = (field: SiteFieldName, control: ReactNode) => {
    if (latest === null || !conflicts.includes(field) || field === 'osd' || field === 'manager') return control;
    const now = currentSiteText(latest, field);
    return (
      <div className="flex flex-col gap-stack-xs">
        {control}
        <p className="text-body-sm text-text-secondary">{now === '' ? t('forms.currentNone') : t('forms.current', { value: now })}</p>
      </div>
    );
  };

  const backFromAdding = (target: PartyTarget, created: boolean) => {
    comeBack.current = { target, created };
    setView('form');
  };

  if (gone) {
    return (
      <StateDialog
        title={t('siteEdit.title')}
        onClose={() => {
          onClose();
        }}
        state={{ kind: 'gone', text: t('siteEdit.gone'), actionLabel: t('siteEdit.refresh'), onAction: onRefresh }}
      />
    );
  }

  const address = [formatAddress(site), formatSpot(t, site)].filter((part) => part !== undefined).join(' · ');
  return (
    <>
      <Dialog
        open={view === 'form'}
        title={t('siteEdit.title')}
        closeLabel={t('forms.closeDialog')}
        onDismiss={dismiss}
        actions={
          <>
            <Button variant="tertiary" onClick={dismiss}>
              {t('forms.cancel')}
            </Button>
            <Button
              type="submit"
              form={formId}
              loading={mutation.isPending}
              disabled={!online}
              {...(online ? {} : { title: t('forms.submitOffline') })}
            >
              {t('siteEdit.submit')}
            </Button>
          </>
        }
      >
        <form
          id={formId}
          noValidate
          className="flex flex-col gap-stack-md"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <p className="break-words text-body text-text-secondary">{address}</p>
          <InlineAlert tone="info">
            {orderCount === undefined ? t('siteEdit.countNone') : t('siteEdit.count', { count: orderCount })}
          </InlineAlert>
          {online ? null : <Banner icon={WifiOff}>{t('siteEdit.offline')}</Banner>}
          <div role="status">{notice === '' ? null : <p className="text-body-sm text-text-secondary">{notice}</p>}</div>
          {failure === null ? null : (
            <InlineAlert tone="error" alertRef={alert}>
              {failureText(failure)}
            </InlineAlert>
          )}
          <SiteFields
            form={current.form}
            errors={errors}
            osd={current.osd}
            manager={current.manager}
            fields={fields}
            decorate={decorate}
            addRefs={{ osd: addRefs.osd, manager: addRefs.manager }}
            summaryRefs={summaryRefs}
            onFormChange={(patch) => {
              setCurrent((existing) => ({ ...existing, form: { ...existing.form, ...patch } }));
              for (const field of Object.keys(patch) as SiteFieldName[]) clearError(field);
              setNotice('');
            }}
            onPartyChange={(target, party) => {
              setCurrent((existing) => ({ ...existing, [target]: party }));
              clearError(target);
              setNotice('');
            }}
            onAddParty={setView}
          />
        </form>
      </Dialog>
      <AddPartyDialog
        open={view === 'osd'}
        kinds={OSD_KINDS}
        title={t('siteEdit.addTitle')}
        cancelLabel={t('siteEdit.back')}
        onClose={() => {
          backFromAdding('osd', false);
        }}
        onCreated={(party) => {
          setCurrent((existing) => ({ ...existing, osd: party }));
          clearError('osd');
          setNotice(t('siteEdit.partyAdded', { name: party.displayName }));
          backFromAdding('osd', true);
        }}
      />
      <AddPartyDialog
        open={view === 'manager'}
        kinds={MANAGER_KINDS}
        title={t('siteEdit.addTitle')}
        cancelLabel={t('siteEdit.back')}
        onClose={() => {
          backFromAdding('manager', false);
        }}
        onCreated={(party) => {
          setCurrent((existing) => ({ ...existing, manager: party }));
          clearError('manager');
          setNotice(t('siteEdit.partyAdded', { name: party.displayName }));
          backFromAdding('manager', true);
        }}
      />
      <DiscardDialog
        open={view === 'discard'}
        onConfirm={() => {
          onClose();
        }}
        onBack={() => {
          setView('form');
        }}
      />
    </>
  );
}
