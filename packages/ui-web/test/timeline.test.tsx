import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MessageSquareText, Pencil, Timeline, TimelineDay, TimelineEntry } from '../src/index.ts';
import { axeViolations } from './a11y.ts';

describe('Timeline (styleguide § 3.10; EVM-037 AC1, AC2, AC6)', () => {
  it('EVM-037 AC6 days are headings with an ordered list of entries, each entry has its own name', async () => {
    const { container } = render(
      <Timeline>
        <TimelineDay heading="Dziś">
          <TimelineEntry
            icon={Pencil}
            label="Wpis: Anna Testowa, 11.10.2026 14:10"
            author="Anna Testowa"
            time={<time dateTime="2026-10-11T12:10:00Z">dziś, 14:10</time>}
            meta="Ustalenie"
            entryId="e1"
          >
            <p>Treść wpisu</p>
          </TimelineEntry>
          <TimelineEntry
            icon={MessageSquareText}
            label="Komentarz: Marta Fikcyjna, 11.10.2026 09:00"
            author="Marta Fikcyjna"
            time={<time dateTime="2026-10-11T07:00:00Z">dziś, 9:00</time>}
            actions={<button type="button">Menu</button>}
          >
            <p>Komentarz</p>
          </TimelineEntry>
        </TimelineDay>
        <TimelineDay heading="Wczoraj">
          <TimelineEntry icon={Pencil} label="Wpis: Piotr Testowy, 10.10.2026 09:30" author="Piotr Testowy" time="wczoraj, 9:30">
            <p>Wczoraj</p>
          </TimelineEntry>
        </TimelineDay>
      </Timeline>,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'Dziś' })).toBeTruthy();
    const day = screen.getByRole('region', { name: 'Dziś' });
    const items = within(day).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(screen.getByRole('listitem', { name: 'Wpis: Anna Testowa, 11.10.2026 14:10' }).getAttribute('data-entry-id')).toBe('e1');
    expect(within(items[0] as HTMLElement).getByText('Ustalenie')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('EVM-037 AC6 the marker is decorative and the entry can take the focus programmatically', () => {
    render(
      <TimelineDay heading="Dziś" headingLevel={4}>
        <TimelineEntry icon={Pencil} label="Wpis" author="Anna" time="14:10">
          <p>x</p>
        </TimelineEntry>
      </TimelineDay>,
    );
    const item = screen.getByRole('listitem', { name: 'Wpis' });
    expect(item.getAttribute('tabindex')).toBe('-1');
    expect(item.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByRole('heading', { level: 4, name: 'Dziś' })).toBeTruthy();
  });
});
