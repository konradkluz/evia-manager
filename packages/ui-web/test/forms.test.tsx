import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Button, Card, InlineAlert, Link2Off, Skeleton, TextField } from '../src/index.ts';
import { axeViolations } from './a11y.ts';

const REVEAL = { show: 'Pokaż', hide: 'Ukryj' };

describe('Button variants and states (styleguide § 3.1; EVM-016 AC3, AC4)', () => {
  it('EVM-016 AC3 variants and sizes map to the tokens of § 3.1', () => {
    const { rerender } = render(
      <Button variant="secondary" size="lg" icon={Link2Off}>
        Przejdź
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Przejdź' });
    expect(button.className).toContain('border-action-secondary-border');
    expect(button.className).toContain('h-control-height-web-lg');
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    rerender(<Button variant="tertiary">Wyloguj</Button>);
    expect(screen.getByRole('button', { name: 'Wyloguj' }).className).toContain('text-action-tertiary-text');
  });

  it('EVM-016 AC4 loading shows the loader icon, keeps the label, is busy and blocks clicks and Enter', async () => {
    const onClick = vi.fn();
    render(
      <Button loading icon={Link2Off} onClick={onClick}>
        Dodaj klucz dostępu
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Dodaj klucz dostępu' });
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.querySelectorAll('svg')).toHaveLength(1);
    await userEvent.click(button);
    button.focus();
    await userEvent.keyboard('{Enter}');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('EVM-016 AC3 disabled stays focusable (aria-disabled) and does not run the action or submit', async () => {
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => {
      event.preventDefault();
    });
    render(
      <form onSubmit={onSubmit}>
        <Button type="submit" disabled>
          Ustaw hasło
        </Button>
      </form>,
    );
    const button = screen.getByRole('button', { name: 'Ustaw hasło' });
    await userEvent.tab();
    expect(document.activeElement).toBe(button);
    await userEvent.click(button);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-busy')).toBeNull();
  });
});

describe('TextField (styleguide § 3.2; EVM-016 AC3)', () => {
  it('EVM-016 AC3 the label, hint and value are tied to the field and the field is accessible', async () => {
    const { container } = render(
      <TextField label="Nowe hasło" value="" type="password" autoComplete="new-password" hint="Co najmniej 15 znaków." reveal={REVEAL} />,
    );
    const field = screen.getByLabelText('Nowe hasło');
    expect(field.getAttribute('type')).toBe('password');
    expect(field.getAttribute('autocomplete')).toBe('new-password');
    expect(field.getAttribute('aria-describedby')).toBe(screen.getByText('Co najmniej 15 znaków.').id);
    expect(field.getAttribute('aria-invalid')).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('EVM-021 AC2 a unit suffix ("kW") is visible after the field, part of its description, and the number keyboard is asked for', async () => {
    const { container } = render(
      <TextField label="Moc przyłączeniowa (opcjonalnie)" value="11" suffix="kW" inputMode="decimal" hint="Do 2 miejsc po przecinku." />,
    );
    const field = screen.getByLabelText('Moc przyłączeniowa (opcjonalnie)');
    const suffix = screen.getByText('kW');
    expect(field.getAttribute('inputmode')).toBe('decimal');
    expect(field.getAttribute('aria-describedby')).toBe(`${suffix.id} ${screen.getByText('Do 2 miejsc po przecinku.').id}`);
    expect(await axeViolations(container)).toEqual([]);
  });

  it('EVM-016 AC3 password show and hide toggles the input type and the button text', async () => {
    const onChange = vi.fn();
    const ref = createRef<HTMLInputElement>();
    render(<TextField label="Nowe hasło" value="tajne hasło" type="password" reveal={REVEAL} onChange={onChange} inputRef={ref} />);
    expect(ref.current?.type).toBe('password');
    await userEvent.click(screen.getByRole('button', { name: 'Pokaż' }));
    expect(ref.current?.type).toBe('text');
    await userEvent.click(screen.getByRole('button', { name: 'Ukryj' }));
    expect(ref.current?.type).toBe('password');
    await userEvent.type(screen.getByLabelText('Nowe hasło'), 'x');
    expect(onChange).toHaveBeenCalled();
  });

  it('EVM-016 AC3 an error replaces the hint, is an alert with an icon and marks the field invalid', async () => {
    const onBlur = vi.fn();
    const { container } = render(
      <TextField
        label="Nowe hasło"
        value=""
        type="password"
        hint="Podpowiedź."
        error="Hasło musi mieć co najmniej 15 znaków."
        onBlur={onBlur}
      />,
    );
    const field = screen.getByLabelText('Nowe hasło');
    expect(screen.queryByText('Podpowiedź.')).toBeNull();
    expect(screen.getByRole('alert').textContent).toBe('Hasło musi mieć co najmniej 15 znaków.');
    expect(screen.getByRole('alert').querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.getAttribute('aria-describedby')).toBe(screen.getByRole('alert').id);
    expect(field.className).toContain('border-border-error');
    field.focus();
    field.blur();
    expect(onBlur).toHaveBeenCalled();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('EVM-016 AC3 read-only variant has no outline, keeps the value and the autocomplete hint for password managers', async () => {
    const { container } = render(
      <TextField label="E-mail" value="anna.testowa@example.com" type="email" autoComplete="username" readOnly />,
    );
    const field = screen.getByLabelText('E-mail');
    expect(field.hasAttribute('readonly')).toBe(true);
    expect(field.getAttribute('autocomplete')).toBe('username');
    expect(field.className).toContain('border-0');
    expect((field as HTMLInputElement).value).toBe('anna.testowa@example.com');
    expect(screen.queryByRole('button')).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('EVM-016 AC3 disabled field uses the disabled tokens and no hint or error renders nothing below', () => {
    render(<TextField label="Nazwa" value="x" disabled />);
    const field = screen.getByLabelText('Nazwa');
    expect((field as HTMLInputElement).disabled).toBe(true);
    expect(field.className).toContain('disabled:bg-control-bg-disabled');
    expect(field.getAttribute('aria-describedby')).toBeNull();
  });
});

describe('InlineAlert, Card and Skeleton (styleguide § 3.19, § 3.8, § 3.16; EVM-016 AC3, AC5)', () => {
  it('EVM-016 AC3 an error alert has role alert, an icon and the exit action; an info alert is plain content', async () => {
    const { container, rerender } = render(
      <InlineAlert tone="error" action={<Button variant="tertiary">Spróbuj ponownie</Button>}>
        Nie udało się.
      </InlineAlert>,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Nie udało się.');
    expect(alert.className).toContain('bg-feedback-error-bg');
    expect(alert.className).toContain('border-s-indicator-error');
    expect(alert.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByRole('button', { name: 'Spróbuj ponownie' })).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
    rerender(<InlineAlert tone="info">Ustawienie hasła wyloguje bieżące konto.</InlineAlert>);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Ustawienie hasła wyloguje bieżące konto.').closest('div')?.parentElement?.className).toContain(
      'border-s-indicator-info',
    );
  });

  it('EVM-016 AC5 a card is a labelled region on the surface token and a skeleton is decorative', async () => {
    const { container } = render(
      <Card labelledBy="title">
        <h1 id="title">Ustaw hasło</h1>
        <Skeleton shape="field" />
        <Skeleton className="w-1/2" />
      </Card>,
    );
    const card = screen.getByRole('region', { name: 'Ustaw hasło' });
    expect(card.className).toContain('bg-bg-surface');
    expect(card.className).toContain('rounded-card');
    const blocks = container.querySelectorAll('[aria-hidden="true"]');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.className).toContain('h-control-height-web-md');
    expect(blocks[0]?.className).toContain('animate-skeleton');
    expect(blocks[1]?.className).toContain('h-icon-md');
    expect(await axeViolations(container)).toEqual([]);
  });
});
