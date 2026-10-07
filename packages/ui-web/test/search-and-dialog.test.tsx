import { fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button, Combobox, Dialog, Disclosure, RadioGroup, TextArea, TextField, type ComboboxOption } from '../src/index.ts';
import { axeViolations } from './a11y.ts';

const OPTIONS: ComboboxOption[] = [
  { id: '1', label: 'Jan Przykładowy', description: '+48 600 000 001' },
  { id: '2', label: 'Anna Testowa', description: '+48 600 000 002' },
];

function Harness({
  options = OPTIONS,
  loading = false,
  notice,
  onSelect = vi.fn(),
}: {
  options?: ComboboxOption[];
  loading?: boolean;
  notice?: React.ReactNode;
  onSelect?: (option: ComboboxOption) => void;
}) {
  const [value, setValue] = useState('');
  return (
    <Combobox
      label="Klient"
      placeholder="Szukaj"
      value={value}
      onValueChange={setValue}
      options={options}
      onSelect={onSelect}
      listLabel="Wyniki"
      loading={loading}
      notice={notice}
      announcement="Znaleziono: 2"
      hint="Wpisz co najmniej 3 znaki."
    />
  );
}

describe('Combobox (styleguide § 3.3; EVM-020 AC1, AC8)', () => {
  it('EVM-020 AC1 typing opens a labelled list; the field stays the focus owner and exposes the combobox roles', async () => {
    const { container } = render(<Harness />);
    const field = screen.getByRole('combobox', { name: 'Klient' });
    expect(field.getAttribute('aria-expanded')).toBe('false');
    await userEvent.type(field, 'prz');
    expect(field.getAttribute('aria-expanded')).toBe('true');
    expect(field.getAttribute('aria-controls')).toBeTruthy();
    const list = screen.getByRole('listbox', { name: 'Wyniki' });
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Jan Przykładowy+48 600 000 001',
      'Anna Testowa+48 600 000 002',
    ]);
    expect(list.parentElement?.id).toBe(field.getAttribute('aria-controls'));
    expect(document.activeElement).toBe(field);
    expect(screen.getByRole('status').textContent).toBe('Znaleziono: 2');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('EVM-020 AC1 arrows move the active option (wrapping), Enter chooses it and closes the list, Esc closes without choosing', async () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const field = screen.getByRole('combobox');
    await userEvent.type(field, 'prz');
    await userEvent.keyboard('{ArrowDown}');
    expect(field.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[0]?.id);
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(screen.getAllByRole('option')[0]?.getAttribute('aria-selected')).toBe('true');
    await userEvent.keyboard('{ArrowUp}');
    expect(screen.getAllByRole('option')[1]?.getAttribute('aria-selected')).toBe('true');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
    await userEvent.keyboard('{ArrowUp}');
    expect(screen.getAllByRole('option')[1]?.getAttribute('aria-selected')).toBe('true');
    await userEvent.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith(OPTIONS[1]);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('EVM-020 AC1 Enter without an active option chooses nothing; a click chooses the option', async () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const field = screen.getByRole('combobox');
    await userEvent.type(field, 'prz{Enter}');
    expect(onSelect).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('option', { name: /Jan Przykładowy/ }));
    expect(onSelect).toHaveBeenCalledWith(OPTIONS[0]);
  });

  it('EVM-020 AC8 loading shows a skeleton of 3 rows marked busy, with no options', async () => {
    const { container } = render(<Harness loading />);
    await userEvent.type(screen.getByRole('combobox'), 'prz');
    expect(screen.queryByRole('listbox')).toBeNull();
    const popup = document.getElementById(screen.getByRole('combobox').getAttribute('aria-controls') ?? '');
    expect(popup?.getAttribute('aria-busy')).toBe('true');
    expect(popup?.querySelectorAll('[aria-hidden="true"]')).toHaveLength(3);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('EVM-020 AC8 a notice (no results, offline, limit) with an action is reached with Tab and keeps the popup open', async () => {
    const onAdd = vi.fn();
    render(
      <>
        <Harness
          options={[]}
          notice={
            <>
              <p>Brak wyników.</p>
              <Button onClick={onAdd}>Dodaj klienta</Button>
            </>
          }
        />
        <button type="button">Dalej</button>
      </>,
    );
    const field = screen.getByRole('combobox');
    await userEvent.type(field, 'xyz');
    expect(screen.getByText('Brak wyników.')).toBeTruthy();
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Dodaj klienta' }));
    expect(screen.getByText('Brak wyników.')).toBeTruthy();
    await userEvent.keyboard('{Enter}');
    expect(onAdd).toHaveBeenCalledOnce();
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Dalej' }));
    expect(screen.queryByText('Brak wyników.')).toBeNull();
  });

  it('EVM-020 AC1 focusing a filled field reopens the popup; an empty field and a disabled one stay closed', async () => {
    const { rerender } = render(<Harness />);
    const field = screen.getByRole('combobox');
    await userEvent.click(field);
    expect(screen.queryByRole('listbox')).toBeNull();
    await userEvent.type(field, 'prz');
    await userEvent.tab();
    expect(screen.queryByRole('listbox')).toBeNull();
    await userEvent.click(field);
    expect(screen.getByRole('listbox')).toBeTruthy();
    rerender(
      <Combobox label="Klient" value="x" onValueChange={vi.fn()} options={OPTIONS} onSelect={vi.fn()} listLabel="Wyniki" disabled />,
    );
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('Dialog (styleguide § 3.13; EVM-020 AC2)', () => {
  function Host({ onDismiss = vi.fn() }: { onDismiss?: () => void }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button
          type="button"
          onClick={() => {
            setOpen(true);
          }}
        >
          Otwórz
        </button>
        <Dialog
          open={open}
          title="Dodaj klienta"
          closeLabel="Zamknij okno"
          onDismiss={() => {
            onDismiss();
            setOpen(false);
          }}
          actions={<Button>Zapisz</Button>}
        >
          <TextField label="Imię" value="" />
        </Dialog>
      </>
    );
  }

  it('EVM-020 AC2 it is a named dialog on the md width, focus lands on the first field and returns to the opener on closing', async () => {
    const { container } = render(<Host />);
    const opener = screen.getByRole('button', { name: 'Otwórz' });
    await userEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Dodaj klienta' });
    expect(dialog.className).toContain('max-w-dialog-width-md');
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Imię' }));
    expect(await axeViolations(container)).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Zamknij okno' }));
    expect(screen.queryByRole('textbox', { name: 'Imię' })).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('EVM-020 AC2 Esc asks the parent to dismiss and does not close the dialog by itself', async () => {
    const onDismiss = vi.fn();
    render(<Host onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole('button', { name: 'Otwórz' }));
    const cancel = new Event('cancel', { cancelable: true });
    fireEvent(screen.getByRole('dialog'), cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('EVM-020 AC2 without a field the first button gets the focus, and a closed dialog renders no content', () => {
    const { rerender } = render(
      <Dialog open title="T" closeLabel="Zamknij" onDismiss={vi.fn()} actions={<Button>Ok</Button>}>
        <p>Treść</p>
      </Dialog>,
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Zamknij' }));
    rerender(
      <Dialog open={false} title="T" closeLabel="Zamknij" onDismiss={vi.fn()} actions={<Button>Ok</Button>}>
        <p>Treść</p>
      </Dialog>,
    );
    expect(screen.queryByText('Treść')).toBeNull();
  });
});

describe('RadioGroup, TextArea, Disclosure (styleguide § 3.4, § 3.2, § 3.21; EVM-020 AC2)', () => {
  it('EVM-020 AC2 the radio group is a fieldset with a legend; arrows change the choice; an error is announced', async () => {
    function Group({ error }: { error?: string }) {
      const [value, setValue] = useState('person');
      return (
        <RadioGroup
          legend="Rodzaj"
          value={value}
          onChange={setValue}
          error={error}
          options={[
            { value: 'person', label: 'Osoba' },
            { value: 'company', label: 'Firma' },
          ]}
        />
      );
    }
    const { container, rerender } = render(<Group />);
    const group = screen.getByRole('group', { name: 'Rodzaj' });
    expect(group.tagName).toBe('FIELDSET');
    const person = screen.getByRole('radio', { name: 'Osoba' });
    person.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Firma' }).checked).toBe(true);
    expect(await axeViolations(container)).toEqual([]);
    rerender(<Group error="Wybierz rodzaj." />);
    expect(screen.getByRole('alert').textContent).toBe('Wybierz rodzaj.');
    expect(group.getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id);
  });

  it('EVM-020 AC2 the text area has a label, a hint tied to it and an error that replaces the hint', async () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <TextArea label="Notatki (opcjonalnie)" value="" hint="Nie wpisuj PESEL." onChange={onChange} />,
    );
    const field = screen.getByRole('textbox', { name: 'Notatki (opcjonalnie)' });
    expect(field.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByText('Nie wpisuj PESEL.')).toBeTruthy();
    await userEvent.type(field, 'a');
    expect(onChange).toHaveBeenCalled();
    expect(await axeViolations(container)).toEqual([]);
    rerender(<TextArea label="Notatki (opcjonalnie)" value="" hint="Nie wpisuj PESEL." error="Za długie." />);
    expect(screen.queryByText('Nie wpisuj PESEL.')).toBeNull();
    expect(screen.getByRole('alert').textContent).toBe('Za długie.');
    expect(field.getAttribute('aria-invalid')).toBe('true');
  });

  it('EVM-020 AC2 the disclosure is a button in a heading with aria-expanded and aria-controls; the content stays mounted', async () => {
    function Host() {
      const [expanded, setExpanded] = useState(false);
      return (
        <Disclosure title="Adres korespondencyjny (opcjonalnie)" summary="do dokumentów" expanded={expanded} onExpandedChange={setExpanded}>
          <TextField label="Ulica" value="" />
        </Disclosure>
      );
    }
    const { container } = render(<Host />);
    const header = screen.getByRole('button', { name: /Adres korespondencyjny/ });
    expect(header.closest('h3')).not.toBeNull();
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('textbox', { name: 'Ulica' })).toBeNull();
    expect(document.getElementById(header.getAttribute('aria-controls') ?? '')?.hidden).toBe(true);
    header.focus();
    await userEvent.keyboard('{Enter}');
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(header);
    expect(screen.getByRole('textbox', { name: 'Ulica' })).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
    await userEvent.keyboard(' ');
    expect(header.getAttribute('aria-expanded')).toBe('false');
  });

  it('EVM-020 AC2 the telephone field is a text box for a phone number', () => {
    render(<TextField label="Telefon" type="tel" value="" />);
    expect(screen.getByRole('textbox', { name: 'Telefon' }).getAttribute('type')).toBe('tel');
  });
});
