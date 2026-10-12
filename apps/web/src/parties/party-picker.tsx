import type { PartyKind, PartySearchItem } from '@evia/contracts';
import { Button, Combobox, InlineAlert, RadioGroup } from '@evia/ui-web';
import { useEffect, useRef, useState, type ReactNode, type Ref, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { partyKindLabels } from '../i18n/catalog-labels.ts';
import { usePartySearch } from './use-party-search.ts';

/**
 * The party chosen in a field: only what the form shows (the search answers with nothing more, SR-DATA-03). The kind is absent for
 * a party that comes from a stage ("Czekamy na…" carries the name only): the line then shows the name alone.
 */
export type PickedParty = Pick<PartySearchItem, 'id' | 'displayName'> & Partial<Pick<PartySearchItem, 'kind' | 'legalForm'>>;

export interface PartyPickerProps {
  /** Always visible: "OSD", "Zarządca / administracja (opcjonalnie)". */
  readonly label: string;
  /** "Zmień OSD" — the name of the button that brings the field back (it names the field: two pickers share the page). */
  readonly changeLabel: string;
  /** "Dodaj stronę: OSD" — the name of the button next to the field (the visible text "Dodaj stronę" is a part of it, WCAG 2.5.3). Absent: no button. */
  readonly addLabel?: string;
  /** Only the parties of these kinds are suggested (AC3): the filter travels in the body of the search. */
  readonly kinds: readonly PartyKind[];
  readonly selected: PickedParty | null;
  readonly onSelect: (party: PickedParty) => void;
  readonly onClear: () => void;
  /** "Dodaj stronę" — from the empty result and next to the field. Absent where a party cannot be added (the dialog of a stage, EVM-033). */
  readonly onAdd?: (() => void) | undefined;
  /** A refusal of the server for this field (wrong or unknown party), shown under the field. */
  readonly error?: string | undefined;
  /**
   * "Podpowiedzi z lokalizacji" (EVM-033 AC1, AC4): the parties of the location, shown above the search with their kind; the chosen
   * one is checked. No suggestions, no section. Only `{id, displayName, kind}` is here — never the contact (SR-DATA-03).
   */
  readonly suggestions?: readonly PickedParty[];
  readonly suggestionsLabel?: string;
  /** Why "Dodaj stronę" cannot be used now (offline, AC6): the button stays, disabled, with this hint; what was typed stays. */
  readonly addDisabledHint?: string | undefined;
  /** The button "Dodaj stronę" next to the field: a dialog that brings the person back to it puts the focus there. */
  readonly addRef?: Ref<HTMLButtonElement>;
  /** The line with the chosen party: a dialog that has just chosen a party for the field puts the focus there. */
  readonly summaryRef?: RefObject<HTMLParagraphElement | null>;
}

/**
 * A combobox of parties of given kinds (EVM-021 AC3, AC4, AC7; W-05 "OSD" and "Zarządca / administracja"): searches by what is
 * typed (3 or more characters, the phrase and the kinds in the body of a POST), and after the choice a line with the name and the
 * kind and "Zmień". The states: loading — skeleton of 3 rows, no results — "Brak wyników dla „…”. [Dodaj stronę]", offline, `429`,
 * a server error. The typed phrase lives only in this component (memory of the tab).
 */
export function PartyPicker({
  label,
  changeLabel,
  addLabel,
  kinds,
  selected,
  onSelect,
  onClear,
  onAdd,
  suggestions = [],
  suggestionsLabel,
  addDisabledHint,
  error,
  addRef,
  summaryRef,
}: PartyPickerProps) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const search = usePartySearch(text, kinds, selected === null);
  const ownSummary = useRef<HTMLParagraphElement>(null);
  const summary = summaryRef ?? ownSummary;
  const field = useRef<HTMLInputElement>(null);
  const previous = useRef(selected?.id);

  // After a choice the field is gone and after "Zmień" the line is: the focus follows (WCAG 2.4.3).
  useEffect(() => {
    if (previous.current === selected?.id) return;
    previous.current = selected?.id;
    (selected === null ? field : summary).current?.focus();
  }, [selected, summary]);

  const alert = error === undefined ? null : <InlineAlert tone="error">{error}</InlineAlert>;
  const addState = addDisabledHint === undefined ? {} : { disabled: true, title: addDisabledHint };
  const line = (party: PickedParty): string =>
    party.kind === undefined
      ? party.displayName
      : t('parties.selected.summary', { name: party.displayName, kind: partyKindLabels[party.kind] });
  const group =
    suggestions.length === 0 || suggestionsLabel === undefined ? null : (
      <RadioGroup
        legend={suggestionsLabel}
        value={selected !== null && suggestions.some((party) => party.id === selected.id) ? selected.id : ''}
        options={suggestions.map((party) => ({ value: party.id, label: line(party) }))}
        onChange={(id) => {
          const party = suggestions.find((candidate) => candidate.id === id);
          if (party !== undefined) onSelect(party);
        }}
      />
    );

  if (selected !== null) {
    return (
      <div className="flex flex-col gap-stack-xs">
        {group}
        <span className="text-label text-text-primary">{label}</span>
        <div className="flex flex-wrap items-center gap-inline-md">
          <p ref={summary} tabIndex={-1} className="text-body text-text-primary focus-visible:focus-ring">
            {line(selected)}
          </p>
          <Button variant="tertiary" aria-label={changeLabel} onClick={onClear}>
            {t('parties.selected.change')}
          </Button>
          {onAdd === undefined || suggestions.length === 0 ? null : (
            <Button ref={addRef} variant="tertiary" aria-label={addLabel} onClick={onAdd} {...addState}>
              {t('parties.field.add')}
            </Button>
          )}
        </div>
        {alert}
      </div>
    );
  }

  const phrase = text.trim();
  let notice: ReactNode = null;
  if (search.state === 'ok') {
    if (!search.online) notice = <p>{t('parties.search.offline')}</p>;
    else if (search.error?.status === 429)
      notice = <p>{t('parties.search.rateLimited', { seconds: search.error.retryAfterSeconds ?? 60 })}</p>;
    else if (search.error !== undefined) {
      notice = (
        <>
          <p>{t('parties.search.error')}</p>
          <Button variant="secondary" onClick={search.retry}>
            {t('parties.search.retry')}
          </Button>
        </>
      );
    } else if (search.items?.length === 0) {
      notice = (
        <>
          <p>{t('parties.search.empty', { query: phrase })}</p>
          {onAdd === undefined ? null : (
            <Button aria-label={addLabel} onClick={onAdd} {...addState}>
              {t('parties.search.add')}
            </Button>
          )}
        </>
      );
    }
  }
  const items = search.items ?? [];
  const announcement = search.loading
    ? t('parties.search.loading')
    : search.items === undefined
      ? ''
      : t('parties.search.found', { count: search.items.length });

  return (
    <div className="flex flex-col gap-stack-xs">
      {group}
      <div className="flex flex-wrap items-end gap-inline-md">
        <div className="min-w-0 flex-1">
          <Combobox
            label={label}
            placeholder={t('parties.field.placeholder')}
            value={text}
            onValueChange={setText}
            options={items.map((item) => ({ id: item.id, label: item.displayName, description: partyKindLabels[item.kind] }))}
            onSelect={(option) => {
              const item = items.find((candidate) => candidate.id === option.id);
              if (item !== undefined) {
                setText('');
                onSelect(item);
              }
            }}
            listLabel={t('parties.field.listLabel', { field: label })}
            loading={search.loading}
            notice={notice}
            announcement={announcement}
            hint={
              search.state === 'short' ? t('parties.field.hintShort') : search.state === 'long' ? t('parties.field.hintLong') : undefined
            }
            inputRef={field}
          />
        </div>
        {onAdd === undefined ? null : (
          <Button ref={addRef} variant="tertiary" aria-label={addLabel} onClick={onAdd} {...addState}>
            {t('parties.field.add')}
          </Button>
        )}
      </div>
      {alert}
    </div>
  );
}
