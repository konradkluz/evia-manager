import { createSite } from '@evia/contracts';
import { Banner, Button, InlineAlert, WifiOff } from '@evia/ui-web';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApi } from '../api/api-context.tsx';
import { ApiError, unwrap } from '../api/client.ts';
import { useAttempt } from '../forms/attempt.ts';
import { fieldErrorText } from '../forms/field-error-text.ts';
import { describeFailure, refusesAttempt, type SaveFailure } from '../forms/save-failure.ts';
import type { PickedParty } from '../parties/party-picker.tsx';
import { useOnline } from '../shell/use-online.ts';
import {
  buildSiteBody,
  firstInvalidSite,
  invalidFields,
  siteFieldOf,
  siteFingerprint,
  type PickedSite,
  type SiteFieldErrors,
  type SiteFieldName,
  type SiteForm,
} from './site-form.ts';
import { SiteFields, type PartyTarget, type SiteFieldElement } from './site-fields.tsx';

export type { PartyTarget } from './site-fields.tsx';

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
  const fields = useRef<Partial<Record<SiteFieldName, SiteFieldElement | null>>>({});
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
      <SiteFields
        form={form}
        errors={errors}
        osd={osd}
        manager={manager}
        fields={fields}
        onFormChange={change}
        onPartyChange={party}
        onAddParty={onAddParty}
      />
      <div className="flex flex-wrap justify-start gap-inline-md">
        <Button loading={mutation.isPending} disabled={!online} onClick={submit}>
          {t('sites.new.submit')}
        </Button>
      </div>
    </div>
  );
}
