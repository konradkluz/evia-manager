import { createSite, type SiteType } from '@evia/contracts';
import { Banner, Button, InlineAlert, Select, TextArea, TextField, WifiOff } from '@evia/ui-web';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import { useAttempt } from '../forms/attempt.ts';
import { fieldErrorText } from '../forms/field-error-text.ts';
import { describeFailure, refusesAttempt, type SaveFailure } from '../forms/save-failure.ts';
import { siteTypeLabels } from '../i18n/catalog-labels.ts';
import { MANAGER_KINDS, OSD_KINDS } from '../parties/party-form.ts';
import { PartyPicker, type PickedParty } from '../parties/party-picker.tsx';
import { useOnline } from '../shell/use-online.ts';
import {
  buildSiteBody,
  firstInvalidSite,
  GARAGE_SITE_TYPE,
  invalidFields,
  siteFieldOf,
  siteFingerprint,
  SITE_TYPES,
  type PickedSite,
  type SiteFieldErrors,
  type SiteFieldName,
  type SiteForm,
} from './site-form.ts';

export type PartyTarget = 'osd' | 'manager';

export interface NewSiteFormProps {
  readonly form: SiteForm;
  readonly onFormChange: (form: SiteForm) => void;
  readonly osd: PickedParty | null;
  readonly manager: PickedParty | null;
  readonly onPartyChange: (target: PartyTarget, party: PickedParty | null) => void;
  /** "Dodaj stronę" next to a field or from its empty result: the section opens the dialog for the field. */
  readonly onAddParty: (target: PartyTarget) => void;
  /** The site is saved: the section selects it. */
  readonly onSaved: (site: PickedSite) => void;
}

const isSiteType = (value: string): value is SiteType => SITE_TYPES.some((type) => type === value);

/**
 * "Nowa lokalizacja" of W-05 (EVM-021 AC2, AC3, AC5, AC7): the type of the object, the address, for a garage the parking spot and
 * the level, the OSD and the manager (comboboxes of parties), the connection power in kW, the PPE and notes with the warning about
 * what not to write. "Zapisz lokalizację" saves the site with a separate request, independent of any customer: the first save names
 * the site (`id`, UUIDv7) and the request (`Idempotency-Key`), a retry of the same content sends the same pair (no duplicate).
 * What is typed lives in the memory of the tab only (the page holds it); offline and after a failed save it stays.
 */
export function NewSiteForm({ form, onFormChange, osd, manager, onPartyChange, onAddParty, onSaved }: NewSiteFormProps) {
  const { t } = useTranslation();
  const client = useApi();
  const online = useOnline();
  const [errors, setErrors] = useState<SiteFieldErrors>({});
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const attempt = useAttempt();
  const fields = useRef<Partial<Record<SiteFieldName, HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null>>>({});
  const alert = useRef<HTMLDivElement>(null);

  const mutation = useMutation({
    mutationFn: (request: { readonly body: ReturnType<typeof buildSiteBody>; readonly key: string }) =>
      unwrap(createSite({ client, body: request.body, headers: { 'Idempotency-Key': request.key } })),
  });

  // After a failed save the focus goes to the first invalid field, or to the message when no field can take it (§ 4.1).
  useEffect(() => {
    if (focusRequest === 0) return;
    const invalid = firstInvalidSite(errors);
    const target = invalid === undefined ? null : (fields.current[invalid] ?? null);
    if (target !== null) target.focus();
    else if (failure !== null) alert.current?.focus();
    // Only the request matters here: it is bumped together with the errors and the failure it concerns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);

  const clearError = (field: SiteFieldName) => {
    setErrors((current) =>
      current[field] === undefined ? current : Object.fromEntries(Object.entries(current).filter(([name]) => name !== field)),
    );
  };

  const change = (patch: Partial<SiteForm>) => {
    onFormChange({ ...form, ...patch });
    for (const field of Object.keys(patch) as SiteFieldName[]) clearError(field);
  };

  const party = (target: PartyTarget, picked: PickedParty | null) => {
    onPartyChange(target, picked);
    clearError(target);
  };

  const submit = () => {
    const invalid = invalidFields(form);
    const entries = Object.entries(invalid) as Array<[SiteFieldName, 'required' | 'invalid_format']>;
    if (entries.length > 0) {
      setErrors(Object.fromEntries(entries.map(([field, code]) => [field, fieldErrorText(t, field, code)])));
      setFailure(null);
      setFocusRequest((current) => current + 1);
      return;
    }
    const { id, key } = attempt.next(siteFingerprint(buildSiteBody(form, '', osd, manager)));
    setErrors({});
    setFailure(null);
    mutation.mutate(
      { body: buildSiteBody(form, id, osd, manager), key },
      {
        onSuccess: (site) => {
          attempt.forget();
          mutation.reset();
          onSaved({
            id: site.id,
            siteType: site.siteType,
            street: site.street,
            buildingNumber: site.buildingNumber,
            postalCode: site.postalCode,
            city: site.city,
            ...(site.apartmentNumber === undefined ? {} : { apartmentNumber: site.apartmentNumber }),
            ...(site.parkingSpotNumber === undefined ? {} : { parkingSpotNumber: site.parkingSpotNumber }),
            ...(site.garageLevel === undefined ? {} : { garageLevel: site.garageLevel }),
          });
        },
        onError: (error) => {
          const mapped: SiteFieldErrors = {};
          if (error instanceof ApiError && error.status === 400) {
            for (const entry of error.errors) {
              const field = siteFieldOf(entry);
              if (field !== undefined && mapped[field] === undefined) mapped[field] = fieldErrorText(t, field, entry.code);
            }
          }
          if (refusesAttempt(error)) attempt.forget();
          setErrors(mapped);
          setFailure(describeFailure(error, Object.keys(mapped).length > 0));
          setFocusRequest((current) => current + 1);
        },
      },
    );
  };

  const text = (
    field: Exclude<SiteFieldName, 'siteType' | 'osd' | 'manager' | 'notes'>,
    label: string,
    extra: { suffix?: string } = {},
  ) => (
    <TextField
      label={label}
      value={form[field]}
      autoComplete="off"
      error={errors[field]}
      {...(extra.suffix === undefined ? {} : { suffix: extra.suffix, inputMode: 'decimal' as const })}
      inputRef={(element) => {
        fields.current[field] = element;
      }}
      onChange={(event) => {
        change({ [field]: event.target.value });
      }}
    />
  );

  const failureText = (current: SaveFailure): string => {
    switch (current.kind) {
      case 'fields':
        return t('sites.failure.fields');
      case 'network':
        return t('sites.failure.network');
      case 'inProgress':
        return t('sites.failure.inProgress');
      case 'forbidden':
        return t('sites.failure.forbidden');
      case 'rate':
        return t('sites.failure.rateLimited', { seconds: current.seconds });
      case 'server':
        return t('sites.failure.server', { code: current.code });
    }
  };

  return (
    <div className="flex flex-col gap-stack-md">
      {online ? null : <Banner icon={WifiOff}>{t('sites.new.offline')}</Banner>}
      {failure === null ? null : (
        <InlineAlert tone="error" alertRef={alert}>
          {failureText(failure)}
        </InlineAlert>
      )}
      <Select
        label={t('sites.new.siteType')}
        value={form.siteType}
        options={[
          { value: '', label: t('sites.new.siteTypePlaceholder') },
          ...SITE_TYPES.map((type) => ({ value: type, label: siteTypeLabels[type] })),
        ]}
        error={errors.siteType}
        selectRef={(element) => {
          fields.current.siteType = element;
        }}
        onChange={(value) => {
          change({ siteType: isSiteType(value) ? value : '' });
        }}
      />
      <div className="grid grid-cols-1 gap-inline-md medium:grid-cols-2">
        {text('street', t('sites.new.street'))}
        {text('buildingNumber', t('sites.new.buildingNumber'))}
        {text('apartmentNumber', t('sites.new.apartmentNumber'))}
        {text('postalCode', t('sites.new.postalCode'))}
        {text('city', t('sites.new.city'))}
      </div>
      {form.siteType === GARAGE_SITE_TYPE ? (
        <div className="grid grid-cols-1 gap-inline-md medium:grid-cols-2">
          {text('parkingSpotNumber', t('sites.new.parkingSpotNumber'))}
          {text('garageLevel', t('sites.new.garageLevel'))}
        </div>
      ) : null}
      <PartyPicker
        label={t('sites.new.osd')}
        changeLabel={t('sites.new.osdChange')}
        addLabel={t('sites.new.osdAdd')}
        kinds={OSD_KINDS}
        selected={osd}
        onSelect={(picked) => {
          party('osd', picked);
        }}
        onClear={() => {
          party('osd', null);
        }}
        onAdd={() => {
          onAddParty('osd');
        }}
        error={errors.osd}
      />
      <PartyPicker
        label={t('sites.new.manager')}
        changeLabel={t('sites.new.managerChange')}
        addLabel={t('sites.new.managerAdd')}
        kinds={MANAGER_KINDS}
        selected={manager}
        onSelect={(picked) => {
          party('manager', picked);
        }}
        onClear={() => {
          party('manager', null);
        }}
        onAdd={() => {
          onAddParty('manager');
        }}
        error={errors.manager}
      />
      <div className="grid grid-cols-1 gap-inline-md medium:grid-cols-2">
        {text('connectionPowerKw', t('sites.new.connectionPower'), { suffix: t('sites.new.kilowatt') })}
        {text('meteringPointId', t('sites.new.meteringPoint'))}
      </div>
      <TextArea
        label={t('sites.new.notes')}
        value={form.notes}
        hint={t('sites.new.notesHint')}
        error={errors.notes}
        inputRef={(element) => {
          fields.current.notes = element;
        }}
        onChange={(event) => {
          change({ notes: event.target.value });
        }}
      />
      <div className="flex flex-wrap justify-start gap-inline-md">
        <Button loading={mutation.isPending} disabled={!online} onClick={submit}>
          {t('sites.new.submit')}
        </Button>
      </div>
    </div>
  );
}
