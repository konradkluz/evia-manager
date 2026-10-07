import { RadioGroup } from '@evia/ui-web';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AddPartyDialog } from '../parties/add-party-dialog.tsx';
import { MANAGER_KINDS, OSD_KINDS } from '../parties/party-form.ts';
import type { PickedParty } from '../parties/party-picker.tsx';
import { useToast } from '../shell/toast-context.tsx';
import { NewSiteForm, type PartyTarget } from './new-site-form.tsx';
import { EMPTY_SITE_FORM, siteStarted, type PickedSite, type SiteForm } from './site-form.ts';
import { SitePicker } from './site-picker.tsx';

/** Everything the section "2. Lokalizacja" holds; the page keeps it (in the memory of the tab, as a draft) and hands it back. */
export interface LocationState {
  readonly mode: 'existing' | 'new';
  /** The chosen or just saved site (shown in the mode "Istniejąca lokalizacja"). */
  readonly site: PickedSite | null;
  readonly form: SiteForm;
  readonly osd: PickedParty | null;
  readonly manager: PickedParty | null;
}

export const EMPTY_LOCATION: LocationState = { mode: 'existing', site: null, form: EMPTY_SITE_FORM, osd: null, manager: null };

/** Has the person chosen a site or started a new one — a draft is worth keeping, "Anuluj" asks before dropping it. */
export const locationStarted = (location: LocationState): boolean =>
  location.site !== null || siteStarted(location.form, location.osd, location.manager);

export interface LocationSectionProps {
  readonly value: LocationState;
  /** Takes the change as a function of the current state: an answer of the server that arrives later never overwrites newer typing. */
  readonly onChange: (update: (current: LocationState) => LocationState) => void;
}

/**
 * W-05 "2. Lokalizacja" (EVM-021): the radio "Istniejąca lokalizacja" / "Nowa lokalizacja", the search of sites or the form of a new
 * one, and the dialogs "Dodaj stronę" for the OSD and the manager (a saved party is chosen in the field it was opened from).
 */
export function LocationSection({ value, onChange }: LocationSectionProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const [adding, setAdding] = useState<PartyTarget | null>(null);
  const patch = (partial: Partial<LocationState>) => {
    onChange((current) => ({ ...current, ...partial }));
  };

  const addedParty = (target: PartyTarget) => (party: PickedParty) => {
    setAdding(null);
    patch({ [target]: party });
    toast(t('parties.dialog.added'));
  };

  return (
    <div className="flex flex-col gap-stack-md">
      <RadioGroup
        legend={t('sites.mode.legend')}
        value={value.mode}
        onChange={(mode) => {
          patch({ mode: mode === 'new' ? 'new' : 'existing' });
        }}
        options={[
          { value: 'existing', label: t('sites.mode.existing') },
          { value: 'new', label: t('sites.mode.new') },
        ]}
      />
      {value.mode === 'existing' ? (
        <SitePicker
          selected={value.site}
          onSelect={(site) => {
            patch({ site });
          }}
          onClear={() => {
            patch({ site: null });
          }}
          onNew={() => {
            patch({ mode: 'new' });
          }}
        />
      ) : null}
      {/* Stays mounted while hidden: a save whose answer is lost keeps its identifier and key when the person looks at "Istniejąca lokalizacja" meanwhile. */}
      <div hidden={value.mode !== 'new'}>
        <NewSiteForm
          form={value.form}
          onFormChange={(form) => {
            patch({ form });
          }}
          osd={value.osd}
          manager={value.manager}
          onPartyChange={(target, party) => {
            patch({ [target]: party });
          }}
          onAddParty={setAdding}
          onSaved={(site) => {
            onChange(() => ({ mode: 'existing', site, form: EMPTY_SITE_FORM, osd: null, manager: null }));
            toast(t('sites.new.added'));
          }}
        />
      </div>
      <AddPartyDialog
        open={adding === 'osd'}
        kinds={OSD_KINDS}
        onClose={() => {
          setAdding(null);
        }}
        onCreated={addedParty('osd')}
      />
      <AddPartyDialog
        open={adding === 'manager'}
        kinds={MANAGER_KINDS}
        onClose={() => {
          setAdding(null);
        }}
        onCreated={addedParty('manager')}
      />
    </div>
  );
}
