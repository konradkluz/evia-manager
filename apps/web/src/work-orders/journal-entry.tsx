import type { TimelineEntry as Entry } from '@evia/contracts';
import {
  ActionMenu,
  Button,
  ClipboardList,
  EllipsisVertical,
  EyeOff,
  IconButton,
  Info,
  MessageSquareText,
  Pencil,
  TimelineEntry,
} from '@evia/ui-web';
import type { TFunction } from 'i18next';
import { useState, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { noteCategoryLabel } from '../i18n/journal-labels.ts';
import { JournalEventContent } from './journal-event.tsx';
import { formatEntryDate, formatFullDateTime, formatTimeOfDay, relationOf, dayKeyOf } from './journal-format.ts';
import { LinkedText } from './linked-text.tsx';

/** "dziś, 14:10", "wczoraj, 9:30" or "02.10.2026, 10:00" (§ 6.3): the day is the day of the business zone. */
export function relativeTime(t: TFunction, iso: string, nowMs: number): string {
  const time = formatTimeOfDay(iso);
  const relation = relationOf(dayKeyOf(iso), nowMs);
  if (relation === 'today') return t('workOrder.journal.day.todayAt', { time });
  if (relation === 'yesterday') return t('workOrder.journal.day.yesterdayAt', { time });
  return t('workOrder.journal.day.at', { date: formatEntryDate(iso), time });
}

export interface JournalEntryProps {
  readonly entry: Entry;
  /** The entries loaded so far: the correction names the time of the entry it replaces and the original the time of its correction. */
  readonly byId: ReadonlyMap<string, Entry>;
  readonly nowMs: number;
  /** Set for Administrator and Editor and a correctable entry: opens "Popraw wpis". */
  readonly onCorrect: ((entry: Entry) => void) | undefined;
  readonly online: boolean;
  readonly itemRef: Ref<HTMLLIElement> | undefined;
}

/**
 * One entry of the journal (W-08, § 3.10; EVM-037 AC1–AC4): the marker by kind (`pencil` for a note, `message-square-text`
 * for a comment), the author and the time server-side, the category and the stage, the text. The text is shown as React text
 * only (SR-WEB-03); the addresses `https:`, `tel:` and `mailto:` in it are links, anything else — `<script>`,
 * `javascript:` — stays text. A corrected entry is collapsed with "Zastąpiony poprawką z …" and "Pokaż treść"; a correction
 * says "Poprawka wpisu z …:" first. Values the panel does not know (a kind, a category) are not shown raw (P-12).
 */
export function JournalEntry({ entry, byId, nowMs, onCorrect, online, itemRef }: JournalEntryProps) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  const known = entry.kind === 'note' || entry.kind === 'comment';
  // An automatic entry (EVM-038): the server sent the structured event; an `event` without it stays a neutral system entry (P-12).
  const event = entry.kind === 'event' ? entry.event : null;
  const correction = entry.supersedesEntryId === null ? undefined : byId.get(entry.supersedesEntryId);
  const replacement = entry.supersededByEntryId === null ? undefined : byId.get(entry.supersededByEntryId);
  const author = entry.author?.displayName ?? t('workOrder.journal.entry.authorSystem');
  const time = relativeTime(t, entry.createdAt, nowMs);
  const full = formatFullDateTime(entry.createdAt);
  const redactedAt = entry.redactedAt;
  const redacted = redactedAt !== null;

  const kindLabel =
    event !== null
      ? t('workOrder.journal.entry.kindEvent')
      : !known
        ? t('workOrder.journal.entry.kindSystem')
        : entry.supersedesEntryId !== null
          ? t('workOrder.journal.entry.kindCorrection')
          : entry.kind === 'comment'
            ? t('workOrder.journal.entry.kindComment')
            : t('workOrder.journal.entry.kindNote');
  const icon = redacted ? EyeOff : event !== null ? ClipboardList : !known ? Info : entry.kind === 'comment' ? MessageSquareText : Pencil;

  const category = entry.noteCategory === null ? undefined : noteCategoryLabel(entry.noteCategory);
  const meta = [
    category,
    // the sentence of an event names its stage already
    entry.procedureStageName === null || event !== null
      ? undefined
      : t('workOrder.journal.entry.stage', { name: entry.procedureStageName }),
    entry.origin === 'mobile' && entry.capturedAt !== null
      ? t('workOrder.journal.entry.fromPhone', { time: formatTimeOfDay(entry.capturedAt) })
      : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join(' · ');

  const menuLabel = t('workOrder.journal.entry.menuLabel', { author, time });
  const actions =
    onCorrect === undefined ? undefined : (
      <ActionMenu
        label={menuLabel}
        items={[
          {
            id: 'correct',
            label: t('workOrder.journal.entry.correct'),
            onSelect: () => {
              onCorrect(entry);
            },
            ...(online ? {} : { disabledHint: t('workOrder.journal.entry.correctOffline') }),
          },
        ]}
        trigger={(props) => <IconButton {...props} icon={EllipsisVertical} label={menuLabel} />}
      />
    );

  let content;
  if (event !== null && !redacted) {
    content = <JournalEventContent entry={{ ...entry, event }} />;
  } else if (redacted) {
    content = <p className="text-text-secondary">{t('workOrder.journal.entry.redacted', { date: formatEntryDate(redactedAt) })}</p>;
  } else if (entry.body === null) {
    content = known ? <p className="text-text-secondary">{t('workOrder.journal.entry.unavailable')}</p> : null;
  } else if (entry.supersededByEntryId !== null) {
    content = (
      <div className="flex flex-col items-start gap-stack-xs">
        <p className="text-text-secondary">
          {replacement === undefined
            ? t('workOrder.journal.entry.supersededUnknown')
            : t('workOrder.journal.entry.superseded', { time: relativeTime(t, replacement.createdAt, nowMs) })}
        </p>
        <Button
          variant="tertiary"
          aria-expanded={shown}
          onClick={() => {
            setShown(!shown);
          }}
        >
          {shown ? t('workOrder.journal.entry.hide') : t('workOrder.journal.entry.show')}
        </Button>
        {shown ? <EntryText body={entry.body} /> : null}
      </div>
    );
  } else {
    content = (
      <>
        {entry.supersedesEntryId === null ? null : (
          <p className="text-text-secondary">
            {correction === undefined
              ? t('workOrder.journal.entry.correctionOfUnknown')
              : t('workOrder.journal.entry.correctionOf', { time: relativeTime(t, correction.createdAt, nowMs) })}
          </p>
        )}
        <EntryText body={entry.body} />
      </>
    );
  }

  return (
    <TimelineEntry
      icon={icon}
      label={t('workOrder.journal.entry.label', { kind: kindLabel, author, date: full })}
      author={author}
      time={
        <time dateTime={entry.createdAt} title={full}>
          {time}
        </time>
      }
      {...(meta === '' ? {} : { meta })}
      {...(actions === undefined ? {} : { actions })}
      entryId={entry.id}
      {...(itemRef === undefined ? {} : { itemRef })}
    >
      {content}
    </TimelineEntry>
  );
}

/** The text of an entry: React text with linked addresses; line breaks kept; `dir="auto"` so a stray direction mark cannot reorder the line. */
function EntryText({ body }: { readonly body: string }) {
  return (
    <p dir="auto" className="whitespace-pre-line break-words">
      <LinkedText text={body} />
    </p>
  );
}
