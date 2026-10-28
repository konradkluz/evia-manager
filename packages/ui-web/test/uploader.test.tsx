import { fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button, UploadQueueItem, Uploader } from '../src/index.ts';
import { axeViolations } from './a11y.ts';

const jpeg = (name: string) => new File(['x'], name, { type: 'image/jpeg' });

describe('Uploader (styleguide § 3.12; EVM-044 AC1, AC4)', () => {
  it('EVM-044 AC1 the visible button chooses files through the input and passes them on, the input is emptied for the next choice', async () => {
    const onFiles = vi.fn();
    const { container } = render(
      <Uploader
        dropLabel="Upuść zdjęcia tutaj albo"
        buttonLabel="Wybierz pliki"
        inputLabel="Wybrane pliki"
        hint="Zdjęcia: JPEG do 50 MB"
        accept="image/jpeg"
        onFiles={onFiles}
      />,
    );
    expect(screen.getByRole('button', { name: 'Wybierz pliki' }).getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByText('Zdjęcia: JPEG do 50 MB')).toBeTruthy();
    const input = screen.getByLabelText<HTMLInputElement>('Wybrane pliki');
    await userEvent.upload(input, [jpeg('a.jpg'), jpeg('b.jpg')]);
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect((onFiles.mock.calls[0]?.[0] as File[]).map((file) => file.name)).toEqual(['a.jpg', 'b.jpg']);
    expect(input.value).toBe('');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('EVM-044 AC1 the button opens the picker of the input', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    render(<Uploader variant="button" buttonLabel="Wybierz z galerii" inputLabel="Wybrane pliki" onFiles={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Wybierz z galerii' }));
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });

  it('EVM-044 AC1 a drop on the drop area passes the files on; dragging is only an addition and a disabled area ignores it', () => {
    const onFiles = vi.fn();
    const { rerender } = render(<Uploader buttonLabel="Wybierz pliki" inputLabel="Wybrane pliki" onFiles={onFiles} />);
    const area = screen.getByRole('button', { name: 'Wybierz pliki' }).closest('div[class*="rounded-card"]') as HTMLElement;
    fireEvent.dragOver(area);
    expect(area.className).toContain('bg-bg-selected');
    fireEvent.dragLeave(area);
    expect(area.className).not.toContain('bg-bg-selected');
    fireEvent.drop(area, { dataTransfer: { files: [jpeg('c.jpg')] } });
    expect(onFiles).toHaveBeenCalledTimes(1);
    fireEvent.drop(area, { dataTransfer: { files: [] } });
    expect(onFiles).toHaveBeenCalledTimes(1);
    rerender(<Uploader buttonLabel="Wybierz pliki" inputLabel="Wybrane pliki" disabled onFiles={onFiles} />);
    fireEvent.dragOver(area);
    fireEvent.drop(area, { dataTransfer: { files: [jpeg('d.jpg')] } });
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Wybierz pliki' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('EVM-044 AC4 the button variant has no drop area', () => {
    const { container } = render(
      <Uploader variant="button" buttonLabel="Wybierz z galerii" inputLabel="Wybrane pliki" onFiles={vi.fn()} />,
    );
    expect(container.querySelector('[class*="border-border-strong"]')).toBeNull();
    expect(screen.queryByText(/Upuść/)).toBeNull();
  });
});

describe('UploadQueueItem (styleguide § 3.12, § 4.14; EVM-044 AC1, AC4, AC5)', () => {
  it('EVM-044 AC4 a file being sent shows the label, the progress bar with its value and the visible buttons', async () => {
    const { container } = render(
      <ul>
        <UploadQueueItem
          name="IMG_0403.jpg"
          state="uploading"
          statusLabel="Wysyłanie 45%"
          percent={45.4}
          progressLabel="Postęp wysyłania pliku IMG_0403.jpg"
          actions={<Button variant="tertiary">Wstrzymaj</Button>}
        />
      </ul>,
    );
    expect(screen.getByText('IMG_0403.jpg')).toBeTruthy();
    expect(screen.getByText('Wysyłanie 45%')).toBeTruthy();
    const bar = screen.getByRole('progressbar', { name: 'Postęp wysyłania pliku IMG_0403.jpg' });
    expect(bar.getAttribute('aria-valuenow')).toBe('45');
    expect(screen.getByRole('button', { name: 'Wstrzymaj' })).toBeTruthy();
    expect(container.querySelector('li')?.className).toContain('min-h-touch-target-min');
    expect(await axeViolations(container)).toEqual([]);
  });

  it('EVM-044 AC1 AC3 AC5 every state has an icon and a label on its tone, and only an uploading file has a bar (clamped to 0 … 100)', () => {
    const states = [
      ['queued', 'bg-sync-queued-bg'],
      ['paused', 'bg-sync-queued-bg'],
      ['checking', 'bg-sync-queued-bg'],
      ['uploading', 'bg-sync-in-progress-bg'],
      ['done', 'bg-sync-done-bg'],
      ['failed', 'bg-sync-error-bg'],
      ['attention', 'bg-sync-error-bg'],
    ] as const;
    for (const [state, tone] of states) {
      const { container, unmount } = render(
        <ul>
          <UploadQueueItem name="x.jpg" state={state} statusLabel={`Stan ${state}`} detail="Co dalej" />
        </ul>,
      );
      const badge = screen.getByText(`Stan ${state}`).closest('span[class*="rounded-pill"]') as HTMLElement;
      expect(badge.className).toContain(tone);
      expect(badge.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
      expect(screen.getByText('Co dalej')).toBeTruthy();
      expect(screen.queryByRole('progressbar')).toBeNull();
      expect(container.querySelector('li')).toBeTruthy();
      unmount();
    }
    const { unmount } = render(
      <ul>
        <UploadQueueItem name="x.jpg" state="uploading" statusLabel="Wysyłanie" percent={140} progressLabel="Postęp" />
      </ul>,
    );
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
    unmount();
    render(
      <ul>
        <UploadQueueItem name="x.jpg" state="uploading" statusLabel="Wysyłanie" percent={-3} progressLabel="Postęp" />
      </ul>,
    );
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0');
  });
});
