import type { PartyKind, PartySearchItem } from '@evia/contracts';
import { Button, Combobox, InlineAlert } from '@evia/ui-web';
import { useEffect, useRef, useState, type ReactNode, type Ref, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { partyKindLabels } from '../i18n/catalog-labels.ts';
import { usePartySearch } from './use-party-search.ts';

/** The party chosen in a field: only what the form shows (the search answers with nothing more, SR-DATA-03). */
export type PickedParty = PartySearchItem;

export interface PartyPickerProps {
  /** Always visible: "OSD", "Zarządca / administracja (opcjonalnie)". */
  readonly label: string;
  /** "Zmień OSD" — the name of the button that brings the field back (it names the field: two pickers share the page). */
  readonly changeLabel: string;
  /** "Dodaj stronę: OSD" — the name of the button next to the field (the visible text "Dodaj stronę" is a part of it, WCAG 2.5.3). */
  readonly addLabel: string;
  /** Only the parties of these kinds are suggested (AC3): the filter travels in the body of the search. */
  readonly kinds: readonly PartyKind[];
  readonly selected: PickedParty | null;
  readonly onSelect: (party: PickedParty) => void;
  readonly onClear: () => void;
  /** "Dodaj stronę" — from the empty result and next to the field. */
  readonly onAdd: () => void;
  /** A refusal of the server for this field (wrong or unknown party), shown under the field. */
  readonly error?: string | undefined;
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

  if (selected !== null) {
    return (
      <div className="flex flex-col gap-stack-xs">
        <span className="text-label text-text-primary">{label}</span>
        <div className="flex flex-wrap items-center gap-inline-md">
          <p ref={summary} tabIndex={-1} className="text-body text-text-primary focus-visible:focus-ring">
            {t('parties.selected.summary', { name: selected.displayName, kind: partyKindLabels[selected.kind] })}
          </p>
          <Button variant="tertiary" aria-label={changeLabel} onClick={onClear}>
            {t('parties.selected.change')}
          </Button>
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
          <Button aria-label={addLabel} onClick={onAdd}>
            {t('parties.search.add')}
          </Button>
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
        <Button ref={addRef} variant="tertiary" aria-label={addLabel} onClick={onAdd}>
          {t('parties.field.add')}
        </Button>
      </div>
      {alert}
    </div>
  );
}
