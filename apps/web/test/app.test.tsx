import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from './a11y.ts';
import { renderPanel } from './render.tsx';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('panel shell and the work orders page (EVM-008 AC3)', () => {
  it('EVM-008 AC3 shell renders navigation with "Zlecenia" and empty state "Brak zleceń" without "Nowe zlecenie"', async () => {
    const { history } = await renderPanel('/work-orders');
    expect(history.location.pathname).toBe('/work-orders');
    const nav = screen.getByRole('navigation', { name: 'Główna nawigacja' });
    expect(within(nav).getByRole('link', { name: 'Zlecenia' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getAllByRole('heading', { level: 1 }).map((heading) => heading.textContent)).toEqual(['Zlecenia']);
    expect(screen.getByRole('heading', { level: 2, name: 'Brak zleceń' })).toBeTruthy();
    expect(screen.getByText('Zlecenia pojawią się tutaj, gdy zostaną dodane do systemu.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /nowe zlecenie/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /nowe zlecenie/i })).toBeNull();
    expect(screen.getByRole('link', { name: 'Przejdź do treści' })).toBeTruthy();
    expect(document.title).toBe('Zlecenia · EVia Manager');
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-008 AC3 the root path and unknown paths lead to the work orders page', async () => {
    const root = await renderPanel('/');
    await waitFor(() => {
      expect(root.history.location.pathname).toBe('/work-orders');
    });
    root.unmount();
    const unknown = await renderPanel('/nie-ma-takiej-strony');
    await waitFor(() => {
      expect(unknown.history.location.pathname).toBe('/work-orders');
    });
  });

  it('EVM-008 AC3 offline: the banner "Brak połączenia…" appears while the shell and the empty state stay visible', async () => {
    await renderPanel('/work-orders');
    expect(screen.queryByText('Brak połączenia. Panel działa po jego powrocie.')).toBeNull();
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      globalThis.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByText('Brak połączenia. Panel działa po jego powrocie.').closest('[role="status"]')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Brak zleceń' })).toBeTruthy();
    onLine.mockReturnValue(true);
    act(() => {
      globalThis.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByText('Brak połączenia. Panel działa po jego powrocie.')).toBeNull();
  });
});
