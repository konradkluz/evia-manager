import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from '../src/i18n/i18n.ts';
import { ErrorBoundary } from '../src/shell/error-boundary.tsx';
import { ErrorState } from '../src/shell/error-state.tsx';
import { renderPanel } from './render.tsx';
import { I18nextProvider } from 'react-i18next';

vi.mock('../src/pages/work-orders-page.tsx', () => ({
  WorkOrdersPage: () => {
    throw new Error('synthetic failure with user@example.com');
  },
}));

beforeEach(() => {
  // React reports caught render errors to the console; the tests check what the user sees.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('error state (EVM-008 AC3; styleguide § 4.9)', () => {
  it('EVM-008 AC3 a page that fails to render shows "Coś poszło nie tak" inside the shell, without technical details', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { origin: globalThis.location.origin, reload });
    await renderPanel('/work-orders');
    expect(screen.getByRole('heading', { level: 1, name: 'Coś poszło nie tak' })).toBeTruthy();
    expect(screen.getByText('Odśwież stronę i spróbuj ponownie. Jeśli problem wraca, skontaktuj się z administratorem.')).toBeTruthy();
    expect(within(screen.getByRole('navigation', { name: 'Główna nawigacja' })).getByRole('link', { name: 'Zlecenia' })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/synthetic|example\.com|Error/);
    await userEvent.click(screen.getByRole('button', { name: 'Odśwież stronę' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('EVM-008 AC3 the last-resort boundary replaces a failed shell with the error state', () => {
    const Broken = () => {
      throw new Error('shell failure');
    };
    const onReload = vi.fn();
    render(
      <I18nextProvider i18n={createI18n()}>
        <ErrorBoundary fallback={<ErrorState onReload={onReload} />}>
          <Broken />
        </ErrorBoundary>
      </I18nextProvider>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Coś poszło nie tak' })).toBeTruthy();
    expect(screen.queryByText('shell failure')).toBeNull();
  });

  it('EVM-008 AC3 the boundary renders its children when nothing fails', () => {
    render(
      <ErrorBoundary fallback={<p>fallback</p>}>
        <p>content</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('content')).toBeTruthy();
  });
});
