import { fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Lightbox, type LightboxProps } from '../src/index.ts';
import { axeViolations } from './a11y.ts';

const base = (extra: Partial<LightboxProps> = {}): LightboxProps => ({
  open: true,
  title: 'Zdjęcie 2 z 3',
  closeLabel: 'Zamknij',
  previousLabel: 'Poprzednie',
  nextLabel: 'Następne',
  zoomInLabel: 'Powiększ',
  zoomOutLabel: 'Pomniejsz',
  zoomStatus: (percent) => `Powiększenie ${String(percent)}%`,
  onPrevious: vi.fn(),
  onNext: vi.fn(),
  onDismiss: vi.fn(),
  itemKey: 'a',
  children: <img src="https://bucket.example.test/a.webp" alt="Zdjęcie testowe" />,
  details: <p>W trakcie prac</p>,
  ...extra,
});

describe('Lightbox (styleguide § 3.11; EVM-045 AC1)', () => {
  it('EVM-045 AC1 it is a modal dialog with the buttons Poprzednie, Następne, zoom and close, the picture and the details', async () => {
    const { container } = render(<Lightbox {...base()} />);
    expect(screen.getByRole('dialog', { name: 'Zdjęcie 2 z 3' })).toBeTruthy();
    for (const name of ['Poprzednie', 'Następne', 'Powiększ', 'Pomniejsz', 'Zamknij'])
      expect(screen.getByRole('button', { name })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Zdjęcie testowe' })).toBeTruthy();
    expect(screen.getByText('W trakcie prac')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('EVM-045 AC1 the buttons run the handlers; the first and the last item have the button disabled', async () => {
    const props = base();
    const { rerender } = render(<Lightbox {...props} />);
    await userEvent.click(screen.getByRole('button', { name: 'Poprzednie' }));
    await userEvent.click(screen.getByRole('button', { name: 'Następne' }));
    await userEvent.click(screen.getByRole('button', { name: 'Zamknij' }));
    expect(props.onPrevious).toHaveBeenCalledTimes(1);
    expect(props.onNext).toHaveBeenCalledTimes(1);
    expect(props.onDismiss).toHaveBeenCalledTimes(1);
    rerender(<Lightbox {...base({ onPrevious: undefined, onNext: undefined })} />);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Poprzednie' }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Następne' }).disabled).toBe(true);
  });

  it('EVM-045 AC1 the arrows of the keyboard move between the items while the picture is not zoomed', async () => {
    const props = base();
    render(<Lightbox {...props} />);
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(props.onPrevious).toHaveBeenCalledTimes(1);
    expect(props.onNext).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Powiększ' }));
    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(props.onNext).toHaveBeenCalledTimes(1);
  });

  it('EVM-045 AC1 the arrows do nothing at the ends of the list', () => {
    render(<Lightbox {...base({ onPrevious: undefined, onNext: undefined })} />);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowLeft' });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'a' });
  });

  it('EVM-045 AC1 the zoom has steps with the buttons, announces the step, is limited at both ends and goes back to 100% with a new item', async () => {
    const { rerender } = render(<Lightbox {...base()} />);
    const zoomIn = screen.getByRole<HTMLButtonElement>('button', { name: 'Powiększ' });
    const zoomOut = screen.getByRole<HTMLButtonElement>('button', { name: 'Pomniejsz' });
    expect(zoomOut.disabled).toBe(true);
    const frame = screen.getByRole('img').parentElement as HTMLElement;
    expect(frame.className).toContain('w-full');
    await userEvent.click(zoomIn);
    expect(frame.className).toContain('scale-150');
    expect(screen.getByText('Powiększenie 150%')).toBeTruthy();
    await userEvent.click(zoomIn);
    await userEvent.click(zoomIn);
    expect(frame.className).toContain('scale-300');
    expect(zoomIn.disabled).toBe(true);
    await userEvent.click(zoomOut);
    expect(frame.className).toContain('scale-200');
    rerender(<Lightbox {...base({ itemKey: 'b' })} />);
    expect(frame.className).toContain('w-full');
  });

  it('EVM-045 AC1 while the picture is not there the zoom is disabled', () => {
    render(<Lightbox {...base({ zoomable: false })} />);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Powiększ' }).disabled).toBe(true);
  });

  it('EVM-045 AC1 Esc asks to dismiss, closing renders nothing and the focus goes back to the opener', () => {
    const props = base();
    const view = (open: boolean) => (
      <>
        <button type="button">Miniatura</button>
        <Lightbox {...props} open={open} />
      </>
    );
    const { rerender } = render(view(false));
    const opener = screen.getByRole('button', { name: 'Miniatura' });
    opener.focus();
    rerender(view(true));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Poprzednie' }));
    const cancel = new Event('cancel', { cancelable: true });
    fireEvent(screen.getByRole('dialog'), cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(props.onDismiss).toHaveBeenCalledTimes(1);
    rerender(view(false));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('EVM-045 AC1 an element marked data-initial-focus gets the focus on opening', () => {
    render(<Lightbox {...base({ details: <button data-initial-focus>Pobierz oryginał</button> })} />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Pobierz oryginał' }));
  });
});
