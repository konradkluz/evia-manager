import { fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Lightbox, LightboxImage, type LightboxProps } from '../src/index.ts';
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
  scrollAreaLabel: 'Powiększone zdjęcie',
  onPrevious: vi.fn(),
  onNext: vi.fn(),
  onDismiss: vi.fn(),
  itemKey: 'a',
  children: <LightboxImage src="https://bucket.example.test/a.webp" alt="Zdjęcie testowe" />,
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
    await userEvent.click(zoomIn);
    expect(screen.getByText('Powiększenie 150%')).toBeTruthy();
    await userEvent.click(zoomIn);
    await userEvent.click(zoomIn);
    expect(screen.getByText('Powiększenie 300%')).toBeTruthy();
    expect(zoomIn.disabled).toBe(true);
    await userEvent.click(zoomOut);
    expect(screen.getByText('Powiększenie 200%')).toBeTruthy();
    rerender(<Lightbox {...base({ itemKey: 'b' })} />);
    expect(screen.queryByText(/Powiększenie/)).toBeNull();
    expect(zoomOut.disabled).toBe(true);
  });

  it('EVM-045 AC1 the picture is the fitted size at the fit and fitted size times the factor at a step (a measured area, a known natural size)', async () => {
    const client = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
    const height = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
    try {
      render(<Lightbox {...base()} />);
      const image = screen.getByRole<HTMLImageElement>('img');
      expect(image.style.width).toBe('');
      Object.defineProperty(image, 'naturalWidth', { value: 1600 });
      Object.defineProperty(image, 'naturalHeight', { value: 1200 });
      fireEvent.load(image);
      expect(parseFloat(image.style.width)).toBeCloseTo(533.33, 1);
      expect(image.style.height).toBe('400px');
      await userEvent.click(screen.getByRole('button', { name: 'Powiększ' }));
      expect(parseFloat(image.style.width)).toBeCloseTo(800, 3);
      expect(image.style.height).toBe('600px');
      await userEvent.click(screen.getByRole('button', { name: 'Powiększ' }));
      await userEvent.click(screen.getByRole('button', { name: 'Powiększ' }));
      expect(image.style.height).toBe('1200px');
      await userEvent.click(screen.getByRole('button', { name: 'Pomniejsz' }));
      await userEvent.click(screen.getByRole('button', { name: 'Pomniejsz' }));
      await userEvent.click(screen.getByRole('button', { name: 'Pomniejsz' }));
      expect(image.style.height).toBe('400px');
    } finally {
      client.mockRestore();
      height.mockRestore();
    }
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

  it('EVM-045 AC1 the scrolling picture area is a focusable named region with a visible focus ring (WCAG 2.1.1, 2.4.7)', () => {
    render(<Lightbox {...base()} />);
    const area = screen.getByRole('region', { name: 'Powiększone zdjęcie' });
    expect(area.getAttribute('tabindex')).toBe('0');
    expect(area.className).toContain('focus-visible:focus-ring');
    area.focus();
    expect(document.activeElement).toBe(area);
  });
});
