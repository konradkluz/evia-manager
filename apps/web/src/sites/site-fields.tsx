import type { SiteType } from '@evia/contracts';
import { Select, TextArea, TextField } from '@evia/ui-web';
import type { ReactNode, Ref, RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { siteTypeLabels } from '../i18n/catalog-labels.ts';
import { MANAGER_KINDS, OSD_KINDS } from '../parties/party-form.ts';
import { PartyPicker, type PickedParty } from '../parties/party-picker.tsx';
import { GARAGE_SITE_TYPE, SITE_TYPES, type SiteFieldErrors, type SiteFieldName, type SiteForm } from './site-form.ts';

export type PartyTarget = 'osd' | 'manager';

export type SiteFieldElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

const isSiteType = (value: string): value is SiteType => SITE_TYPES.some((type) => type === value);

export interface SiteFieldsProps {
  readonly form: SiteForm;
  readonly errors: SiteFieldErrors;
  readonly osd: PickedParty | null;
  readonly manager: PickedParty | null;
  /** The fields, by name: the form puts the focus on the first invalid one. */
  readonly fields: RefObject<Partial<Record<SiteFieldName, SiteFieldElement | null>>>;
  readonly onFormChange: (patch: Partial<SiteForm>) => void;
  readonly onPartyChange: (target: PartyTarget, party: PickedParty | null) => void;
  /** "Dodaj stronę" next to a field or from its empty result: the owner of the form opens the dialog for the field. */
  readonly onAddParty: (target: PartyTarget) => void;
  /** Wraps a field (the dialog "Edytuj lokalizację" puts "Aktualnie: …" under a field changed by somebody else). */
  readonly decorate?: (field: SiteFieldName, control: ReactNode) => ReactNode;
  /** The buttons "Dodaj stronę" and the lines with the chosen parties: the focus goes there when the person comes back. */
  readonly addRefs?: Readonly<Record<PartyTarget, Ref<HTMLButtonElement>>>;
  readonly summaryRefs?: Readonly<Record<PartyTarget, RefObject<HTMLParagraphElement | null>>>;
}

/**
 * The fields of a site (W-05 "Nowa lokalizacja" and W-20 "Edytuj lokalizację"): the type of the object, the address, for a garage the
 * parking spot and the level, the OSD and the manager (comboboxes of parties), the connection power in kW, the PPE and the notes
 * with the warning about what not to write. The state lives in the owner; this is only the form.
 */
export function SiteFields({
  form,
  errors,
  osd,
  manager,
  fields,
  onFormChange,
  onPartyChange,
  onAddParty,
  decorate = (_field, control) => control,
  addRefs,
  summaryRefs,
}: SiteFieldsProps) {
  const { t } = useTranslation();

  const text = (field: Exclude<SiteFieldName, 'siteType' | 'osd' | 'manager' | 'notes'>, label: string, extra: { suffix?: string } = {}) =>
    decorate(
      field,
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
          onFormChange({ [field]: event.target.value });
        }}
      />,
    );

  return (
    <>
      {decorate(
        'siteType',
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
            onFormChange({ siteType: isSiteType(value) ? value : '' });
          }}
        />,
      )}
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
          onPartyChange('osd', picked);
        }}
        onClear={() => {
          onPartyChange('osd', null);
        }}
        onAdd={() => {
          onAddParty('osd');
        }}
        error={errors.osd}
        {...(addRefs === undefined ? {} : { addRef: addRefs.osd })}
        {...(summaryRefs === undefined ? {} : { summaryRef: summaryRefs.osd })}
      />
      <PartyPicker
        label={t('sites.new.manager')}
        changeLabel={t('sites.new.managerChange')}
        addLabel={t('sites.new.managerAdd')}
        kinds={MANAGER_KINDS}
        selected={manager}
        onSelect={(picked) => {
          onPartyChange('manager', picked);
        }}
        onClear={() => {
          onPartyChange('manager', null);
        }}
        onAdd={() => {
          onAddParty('manager');
        }}
        error={errors.manager}
        {...(addRefs === undefined ? {} : { addRef: addRefs.manager })}
        {...(summaryRefs === undefined ? {} : { summaryRef: summaryRefs.manager })}
      />
      <div className="grid grid-cols-1 gap-inline-md medium:grid-cols-2">
        {text('connectionPowerKw', t('sites.new.connectionPower'), { suffix: t('sites.new.kilowatt') })}
        {text('meteringPointId', t('sites.new.meteringPoint'))}
      </div>
      {decorate(
        'notes',
        <TextArea
          label={t('sites.new.notes')}
          value={form.notes}
          hint={t('sites.new.notesHint')}
          error={errors.notes}
          inputRef={(element) => {
            fields.current.notes = element;
          }}
          onChange={(event) => {
            onFormChange({ notes: event.target.value });
          }}
        />,
      )}
    </>
  );
}
