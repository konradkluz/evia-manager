import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { List, ListItem, Tabs, TextLink } from '../src/index.ts';
import { axeViolations } from './a11y.ts';

const TABS = [
  { id: 'overview', label: 'Przegląd' },
  { id: 'journal', label: 'Dziennik' },
  { id: 'media', label: 'Media' },
] as const;

function Harness({ tabs = TABS }: { readonly tabs?: ReadonlyArray<{ id: string; label: string }> }) {
  const [selected, setSelected] = useState('overview');
  return (
    <Tabs label="Sekcje zlecenia" tabs={tabs} selectedId={selected} onSelect={setSelected}>
      <p>Panel: {selected}</p>
    </Tabs>
  );
}

describe('Tabs (styleguide § 3.17; EVM-018 AC1)', () => {
  it('EVM-018 AC1 the tab list is named, the selected tab is marked and owns the only tab panel', async () => {
    const { container } = render(<Harness />);
    expect(screen.getByRole('tablist', { name: 'Sekcje zlecenia' })).toBeTruthy();
    const selected = screen.getByRole('tab', { name: 'Przegląd' });
    expect(selected.getAttribute('aria-selected')).toBe('true');
    expect(selected.className).toContain('border-b-indicator');
    expect(selected.className).toContain('font-semibold');
    expect(screen.getByRole('tab', { name: 'Dziennik' }).getAttribute('aria-selected')).toBe('false');
    const panel = screen.getByRole('tabpanel', { name: 'Przegląd' });
    expect(panel.getAttribute('id')).toBe(selected.getAttribute('aria-controls'));
    expect(await axeViolations(container)).toEqual([]);
  });

  it('EVM-018 AC1 only the selected tab is in the tab order; the arrows, Home and End move and select', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByRole('tab', { name: 'Dziennik' }).getAttribute('tabindex')).toBe('-1');
    screen.getByRole('tab', { name: 'Przegląd' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Dziennik' }));
    expect(screen.getByText('Panel: journal')).toBeTruthy();
    await user.keyboard('{End}');
    expect(screen.getByText('Panel: media')).toBeTruthy();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByText('Panel: overview')).toBeTruthy();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByText('Panel: media')).toBeTruthy();
    await user.keyboard('{Home}');
    expect(screen.getByText('Panel: overview')).toBeTruthy();
    await user.keyboard('{Tab}');
    expect(document.activeElement).toBe(screen.getByRole('tabpanel'));
  });

  it('EVM-018 AC1 a click selects a tab and a key that is not a navigation key does nothing', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('tab', { name: 'Media' }));
    expect(screen.getByText('Panel: media')).toBeTruthy();
    await user.keyboard('x');
    expect(screen.getByText('Panel: media')).toBeTruthy();
  });

  it('EVM-018 AC1 a single tab is a valid tab list (the arrows stay on it)', async () => {
    const user = userEvent.setup();
    render(<Harness tabs={[{ id: 'overview', label: 'Przegląd' }]} />);
    screen.getByRole('tab', { name: 'Przegląd' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Przegląd' }));
  });
});

describe('List and TextLink (styleguide § 3.6, § 3.17; EVM-018 AC2, AC4)', () => {
  it('EVM-018 AC2 a list is a named semantic list of items', async () => {
    const { container } = render(
      <List label="Zakres">
        <ListItem>Dostawa ładowarki</ListItem>
        <ListItem>Instalacja zasilająca</ListItem>
      </List>,
    );
    expect(screen.getByRole('list', { name: 'Zakres' })).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('EVM-018 AC2 a list can be named by a heading', () => {
    render(
      <>
        <h2 id="heading">Zakres</h2>
        <List labelledBy="heading">
          <ListItem>Pozycja</ListItem>
        </List>
      </>,
    );
    expect(screen.getByRole('list', { name: 'Zakres' })).toBeTruthy();
  });

  it('EVM-018 AC4 a link is underlined in the link colour and never gets a handle on the opener', async () => {
    const { container } = render(<TextLink href="https://example.invalid/a">Strona</TextLink>);
    const link = screen.getByRole('link', { name: 'Strona' });
    expect(link.getAttribute('href')).toBe('https://example.invalid/a');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.className).toContain('text-text-link');
    expect(link.className).toContain('underline');
    expect(await axeViolations(container)).toEqual([]);
  });
});
