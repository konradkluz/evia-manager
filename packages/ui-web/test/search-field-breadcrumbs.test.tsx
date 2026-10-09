import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Breadcrumbs, SearchField } from '../src/index.ts';
import { axeViolations } from './a11y.ts';

function Harness({ disabled = false, onChange = vi.fn() }: { disabled?: boolean; onChange?: (value: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <SearchField
      label="Szukaj klientów"
      value={value}
      hint="Co najmniej 3 znaki."
      clearLabel="Wyczyść frazę"
      disabled={disabled}
      onChange={(next) => {
        onChange(next);
        setValue(next);
      }}
    />
  );
}

describe('SearchField (styleguide § 3.7; EVM-039 AC1, AC8)', () => {
  it('EVM-039 AC1 has a visible label, the hint as its description and no clearing x while empty', () => {
    render(<Harness />);
    const field = screen.getByRole('searchbox', { name: 'Szukaj klientów' });
    expect(field.getAttribute('aria-describedby')).toBe(screen.getByText('Co najmniej 3 znaki.').id);
    expect(screen.queryByRole('button', { name: 'Wyczyść frazę' })).toBeNull();
  });

  it('EVM-039 AC1 typing reports the phrase; the x clears it and the focus returns to the field', async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const field = screen.getByRole('searchbox', { name: 'Szukaj klientów' });
    await userEvent.type(field, 'Lod');
    expect(onChange).toHaveBeenLastCalledWith('Lod');
    await userEvent.click(screen.getByRole('button', { name: 'Wyczyść frazę' }));
    expect(onChange).toHaveBeenLastCalledWith('');
    expect((field as HTMLInputElement).value).toBe('');
    expect(document.activeElement).toBe(field);
  });

  it('EVM-039 AC8 a disabled field stays focusable, ignores typing and shows no x', async () => {
    const onChange = vi.fn();
    render(<Harness disabled onChange={onChange} />);
    const field = screen.getByRole('searchbox', { name: 'Szukaj klientów' });
    expect(field.getAttribute('aria-disabled')).toBe('true');
    await userEvent.type(field, 'abc');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Wyczyść frazę' })).toBeNull();
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('EVM-039 AC1 passes axe with a phrase typed', async () => {
    render(<Harness />);
    await userEvent.type(screen.getByRole('searchbox'), 'Lodz');
    expect(await axeViolations(document.body)).toEqual([]);
  });
});

describe('Breadcrumbs (styleguide § 3.17; EVM-039 AC2)', () => {
  it('EVM-039 AC2 links all but the last item; the last one is the current page as plain text', async () => {
    render(<Breadcrumbs label="Okruszki" items={[{ label: 'Klienci', href: '/customers' }, { label: 'Szczegóły klienta' }]} />);
    const nav = screen.getByRole('navigation', { name: 'Okruszki' });
    expect(screen.getByRole('link', { name: 'Klienci' }).getAttribute('href')).toBe('/customers');
    const current = screen.getByText('Szczegóły klienta');
    expect(current.getAttribute('aria-current')).toBe('page');
    expect(current.closest('a')).toBeNull();
    expect(nav.querySelectorAll('li')).toHaveLength(2);
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('EVM-039 AC2 an item without a target is text even when it is not the last', () => {
    render(<Breadcrumbs label="Okruszki" items={[{ label: 'Bez celu' }, { label: 'Tu jesteś' }]} />);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
