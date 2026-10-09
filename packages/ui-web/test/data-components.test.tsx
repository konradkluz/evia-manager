import { render, screen, within } from '@testing-library/react';
import { createRef } from 'react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DataTable, DateField, FilterChip, Select } from '../src/index.ts';
import { axeViolations } from './a11y.ts';

const describedBy = (element: Element): string | undefined =>
  document.getElementById(element.getAttribute('aria-describedby') ?? '')?.textContent ?? undefined;

describe('Select (styleguide § 3.3; EVM-029 AC5)', () => {
  const options = [
    { value: '', label: 'Wszystkie akcje' },
    { label: 'Logowanie i sesje', options: [{ value: 'login.succeeded', label: 'Logowanie' }] },
  ];

  it('EVM-029 AC5 it has a visible label, groups and reports the chosen value', async () => {
    const onChange = vi.fn();
    const { container } = render(<Select label="Akcja" value="" options={options} onChange={onChange} />);
    const select = screen.getByRole('combobox', { name: 'Akcja' });
    expect(within(select).getByRole('group', { name: 'Logowanie i sesje' })).toBeTruthy();
    await userEvent.selectOptions(select, 'Logowanie');
    expect(onChange).toHaveBeenCalledWith('login.succeeded');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('EVM-029 AC8 disabled explains why through the hint', () => {
    render(<Select label="Wynik" value="" options={options} onChange={vi.fn()} disabled hint="Brak połączenia." />);
    const select = screen.getByRole('combobox', { name: 'Wynik' });
    expect((select as HTMLSelectElement).disabled).toBe(true);
    expect(describedBy(select)).toBe('Brak połączenia.');
  });
});

describe('Select error (styleguide § 3.2; EVM-021 AC2)', () => {
  it('EVM-021 AC2 an error replaces the hint, is an alert tied to the field, marks it invalid and the page can focus the field', async () => {
    const ref = createRef<HTMLSelectElement>();
    const { container } = render(
      <Select
        label="Typ obiektu"
        value=""
        options={[{ value: '', label: 'Wybierz typ obiektu' }]}
        onChange={vi.fn()}
        hint="Podpowiedź."
        error="Uzupełnij to pole."
        selectRef={ref}
      />,
    );
    const select = screen.getByRole('combobox', { name: 'Typ obiektu' });
    expect(screen.queryByText('Podpowiedź.')).toBeNull();
    expect(screen.getByRole('alert').textContent).toBe('Uzupełnij to pole.');
    expect(select.getAttribute('aria-invalid')).toBe('true');
    expect(describedBy(select)).toBe('Uzupełnij to pole.');
    expect(select.className).toContain('border-border-error');
    ref.current?.focus();
    expect(document.activeElement).toBe(select);
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('DateField (styleguide § 3.5; EVM-029 AC5)', () => {
  it('EVM-029 AC5 it is a labelled date input that reports the typed date', async () => {
    const onChange = vi.fn();
    const { container } = render(<DateField label="Od" value="" onChange={onChange} min="2024-10-07" max="2026-10-07" />);
    const input = screen.getByLabelText('Od');
    expect(input.getAttribute('type')).toBe('date');
    await userEvent.type(input, '2026-10-01');
    expect(onChange).toHaveBeenCalled();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('EVM-029 AC5 an error is announced as an alert, tied to the field and not carried by colour only', () => {
    render(<DateField label="Do" value="2026-10-01" onChange={vi.fn()} error="Data końcowa jest wcześniejsza." />);
    const input = screen.getByLabelText('Do');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toBe('Data końcowa jest wcześniejsza.');
    expect(describedBy(input)).toBe('Data końcowa jest wcześniejsza.');
  });
});

describe('FilterChip (styleguide § 3.7; EVM-029 AC5)', () => {
  it('EVM-029 AC5 a choice chip is a toggle: selected shows the check icon and aria-pressed', async () => {
    const onClick = vi.fn();
    const { rerender } = render(<FilterChip variant="choice" label="Dziś" onClick={onClick} />);
    const chip = screen.getByRole('button', { name: 'Dziś' });
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    expect(chip.querySelector('svg')).toBeNull();
    await userEvent.click(chip);
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(<FilterChip variant="choice" label="Dziś" selected onClick={onClick} />);
    expect(screen.getByRole('button', { name: 'Dziś' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Dziś' }).querySelector('svg')).not.toBeNull();
  });

  it('EVM-029 AC5 an active chip removes its filter and is named "Usuń filtr …"', async () => {
    const onClick = vi.fn();
    const { container } = render(
      <FilterChip variant="active" label="Wynik: Odmowa" removeLabel="Usuń filtr Wynik: Odmowa" onClick={onClick} />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Usuń filtr Wynik: Odmowa' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('EVM-029 AC8 disabled stays focusable and does nothing', async () => {
    const onClick = vi.fn();
    render(
      <>
        <FilterChip variant="choice" label="7 dni" disabled onClick={onClick} />
        <FilterChip variant="active" label="Wynik: Błąd" removeLabel="Usuń filtr Wynik: Błąd" disabled onClick={onClick} />
      </>,
    );
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '7 dni' }));
    await userEvent.click(screen.getByRole('button', { name: '7 dni' }));
    await userEvent.click(screen.getByRole('button', { name: 'Usuń filtr Wynik: Błąd' }));
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('DataTable (styleguide § 3.6; EVM-029 AC5)', () => {
  it('EVM-029 AC5 it is a captioned table with column headers, named rows and cells in the order of the columns', async () => {
    const { container } = render(
      <DataTable
        caption="Dziennik audytu — zdarzenia od najnowszych"
        columns={[
          { id: 'time', header: 'Czas', numeric: true },
          { id: 'action', header: 'Akcja' },
        ]}
        rows={[
          { id: 'a', cells: ['04.10.2026, 14:05', 'Logowanie'], label: 'Logowanie, 04.10.2026, 14:05, udane' },
          { id: 'b', cells: ['04.10.2026, 13:58', 'Zmiana roli'] },
        ]}
      />,
    );
    const table = screen.getByRole('table', { name: 'Dziennik audytu — zdarzenia od najnowszych' });
    // The frame that scrolls below the medium breakpoint is a named region that the keyboard reaches.
    const region = screen.getByRole('region', { name: 'Dziennik audytu — zdarzenia od najnowszych' });
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.contains(table)).toBe(true);
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Czas', 'Akcja']);
    expect(within(table).getByRole('row', { name: 'Logowanie, 04.10.2026, 14:05, udane' })).toBeTruthy();
    expect(
      within(table)
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['04.10.2026, 14:05', 'Logowanie', '04.10.2026, 13:58', 'Zmiana roli']);
    expect(within(table).getAllByRole('cell')[0]?.className).toContain('tabular-nums');
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe('DataTable rows as links and sorting (styleguide § 3.6; EVM-017 AC1)', () => {
  const columns = [
    { id: 'order', header: 'Zlecenie', sort: 'descending' as const },
    { id: 'status', header: 'Status' },
  ];

  it('EVM-017 AC1 a row with a target holds one link named after the row, and the sorted column has aria-sort', async () => {
    const { container } = render(
      <DataTable
        caption="Zlecenia"
        columns={columns}
        rows={[
          { id: 'a', cells: ['ZL-2026-0042 Garaż', 'W realizacji'], label: 'ZL-2026-0042, Garaż, W realizacji', href: '/work-orders/a' },
          { id: 'b', cells: ['ZL-2026-0041 Dom', 'Nowe'] },
        ]}
      />,
    );
    const link = screen.getByRole('link', { name: 'ZL-2026-0042, Garaż, W realizacji' });
    expect(link.getAttribute('href')).toBe('/work-orders/a');
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(link.closest('td')).toBe(screen.getAllByRole('cell')[0]);
    expect(screen.getByRole('columnheader', { name: 'Zlecenie' }).getAttribute('aria-sort')).toBe('descending');
    expect(screen.getByRole('columnheader', { name: 'Status' }).hasAttribute('aria-sort')).toBe(false);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('EVM-017 AC1 the link component of the application is used and the row is reachable by keyboard', async () => {
    const Router = ({ href, children, ...rest }: { href: string; children: React.ReactNode; className: string }) => (
      <a data-router="yes" href={href} {...rest}>
        {children}
      </a>
    );
    render(
      <DataTable
        caption="Zlecenia"
        columns={columns}
        rows={[{ id: 'a', cells: ['x', 'y'], label: 'Wiersz', href: '/w/a' }]}
        link={Router}
      />,
    );
    await userEvent.tab();
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Wiersz' }));
    expect(screen.getByRole('link', { name: 'Wiersz' }).getAttribute('data-router')).toBe('yes');
  });
});

describe('DataTable cards on narrow viewports (styleguide § 3.6; EVM-017 AC1)', () => {
  it('EVM-017 AC1 columns with a card role turn the rows into cards below breakpoint.medium and keep the table semantics', async () => {
    const { container } = render(
      <DataTable
        caption="Zlecenia"
        columns={[
          { id: 'order', header: 'Zlecenie', card: 'primary' },
          { id: 'status', header: 'Status', card: 'badge' },
          { id: 'who', header: 'Opiekun', card: 'meta' },
        ]}
        rows={[{ id: 'a', cells: ['x', 'y', 'z'], label: 'Wiersz', href: '/w/a' }]}
      />,
    );
    const cells = screen.getAllByRole('cell');
    expect(cells[0]?.className).toContain('max-medium:row-span-2');
    expect(cells[1]?.className).toContain('max-medium:col-start-3');
    expect(cells[2]?.className).toContain('max-medium:row-start-3');
    expect(screen.getByRole('table').className).toContain('max-medium:block');
    expect(screen.getAllByRole('columnheader')).toHaveLength(3);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('EVM-017 AC1 without card roles the table keeps scrolling in its frame', () => {
    render(<DataTable caption="Zlecenia" columns={[{ id: 'a', header: 'A' }]} rows={[{ id: 'a', cells: ['x'] }]} />);
    expect(screen.getByRole('table').className).not.toContain('max-medium');
  });
});

describe('DataTable columns for the wide view only (styleguide § 3.6; EVM-039 AC1)', () => {
  it('EVM-039 AC1 a wide-only column is hidden below the wide breakpoint (header and cells) and does not take a place in the cards', async () => {
    const { container } = render(
      <DataTable
        caption="Klienci"
        columns={[
          { id: 'name', header: 'Klient', card: 'primary' },
          { id: 'kind', header: 'Rodzaj', card: 'badge' },
          { id: 'email', header: 'E-mail', wideOnly: true },
        ]}
        rows={[{ id: 'a', cells: ['Przykładowy Jan', 'Osoba', 'jan@example.com'] }]}
      />,
    );
    const table = screen.getByRole('table', { name: 'Klienci' });
    const header = within(table).getByRole('columnheader', { name: 'E-mail' });
    expect(header.className).toContain('hidden');
    expect(header.className).toContain('wide:table-cell');
    const cell = within(table).getByText('jan@example.com').closest('td');
    expect(cell?.className).toContain('hidden');
    expect(cell?.className).toContain('wide:table-cell');
    expect(cell?.className).not.toContain('max-medium:block');
    // the other columns keep their place in the card
    expect(within(table).getByText('Przykładowy Jan').closest('td')?.className).toContain('max-medium:block');
    expect(within(table).getByRole('columnheader', { name: 'Klient' }).className).not.toContain('hidden');
    expect(await axeViolations(container)).toEqual([]);
  });
});
