import type { CurrentSession } from '@evia/contracts';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearDrafts } from '../src/session/draft-store.ts';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, json, SESSION_ROUTE, type Handler } from './api-fake.ts';
import { activeSessionApi, renderPanel } from './render.tsx';
import { userEvent } from './user.ts';

// EVM-138 AC2: the choice "Rodzaj" of W-05 and the switch of the function (CurrentSession.features.siteSurveys).
const SITE_SEARCH = 'POST /api/v1/sites/search';
const GARAGE = {
  id: '01968f3e-0000-7000-8000-00000000bbbb',
  siteType: 'multi_family_garage',
  street: 'ul. Testowa',
  buildingNumber: '7',
  postalCode: '00-001',
  city: 'Warszawa',
};

const session = (role: 'administrator' | 'editor' | 'read_only', on: boolean): CurrentSession => ({
  ...ACTIVE_SESSION,
  user: { ...ACTIVE_SESSION.user, role },
  features: { siteSurveys: on },
});

const sites: Handler = () => json(200, { items: [GARAGE], nextCursor: null });
const api = (role: 'administrator' | 'editor' | 'read_only', on: boolean) =>
  activeSessionApi({ [SESSION_ROUTE]: () => json(200, session(role, on)), [SITE_SEARCH]: sites });

afterEach(() => {
  vi.restoreAllMocks();
  clearDrafts();
});

const KIND_ORDER = /Zlecenie z szablonu/;
const KIND_SURVEY = /Wizja lokalna/;

describe('W-05 the choice "Rodzaj" (EVM-138 AC2)', () => {
  it('EVM-138 AC2 with the function on: the group "Rodzaj" has two cards, "Zlecenie z szablonu" is chosen and the form of an order is shown', async () => {
    await renderPanel('/work-orders/new', api('administrator', true));
    const group = screen.getByRole('group', { name: 'Rodzaj' });
    expect(group).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>('radio', { name: KIND_ORDER }).checked).toBe(true);
    expect(
      screen.getByRole('radio', {
        name: /Wizja lokalna Oględziny bez klienta — tylko adres i zdjęcia\. Klienta przypiszesz po akceptacji oferty\./,
      }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Utwórz zlecenie' })).toBeTruthy();
  });

  it('EVM-138 AC2 the Editor has the choice too', async () => {
    await renderPanel('/work-orders/new', api('editor', true));
    expect(screen.getByRole('group', { name: 'Rodzaj' })).toBeTruthy();
  });

  it('EVM-138 AC2 with the function off there is no choice and no site survey: the form of an order only — even for the address ?rodzaj=wizja', async () => {
    await renderPanel('/work-orders/new?rodzaj=wizja', api('administrator', false));
    expect(screen.queryByRole('group', { name: 'Rodzaj' })).toBeNull();
    expect(screen.queryByRole('radio', { name: KIND_SURVEY })).toBeNull();
    expect(screen.getByRole('button', { name: 'Utwórz zlecenie' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Załóż wizję lokalną' })).toBeNull();
  });

  it('EVM-138 AC2 Tylko odczyt: "Nie możesz tworzyć zleceń." and no choice (the server answers 403 anyway)', async () => {
    await renderPanel('/work-orders/new', api('read_only', true));
    expect(screen.getByRole('heading', { level: 1, name: 'Nie możesz tworzyć zleceń.' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Rodzaj' })).toBeNull();
  });

  it('EVM-138 AC2 choosing "Wizja lokalna" replaces the form, the address carries only ?rodzaj=wizja, the change is announced and the focus stays on the chosen card', async () => {
    const { history } = await renderPanel('/work-orders/new', api('administrator', true));
    await userEvent.click(screen.getByRole('radio', { name: KIND_SURVEY }));
    expect(await screen.findByRole('button', { name: 'Załóż wizję lokalną' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Utwórz zlecenie' })).toBeNull();
    expect(history.location.search).toBe('?rodzaj=wizja');
    expect(screen.getAllByRole('status').some((node) => node.textContent === 'Formularz wizji lokalnej')).toBe(true);
    const chosen = screen.getByRole<HTMLInputElement>('radio', { name: KIND_SURVEY });
    expect(chosen.checked).toBe(true);
    expect(document.activeElement).toBe(chosen);
  });

  it('EVM-138 AC2 the arrows move the choice like in any radio group and back to "Zlecenie z szablonu" — the order form again, the address without the kind', async () => {
    const { history } = await renderPanel('/work-orders/new?rodzaj=wizja', api('administrator', true));
    const chosen = screen.getByRole<HTMLInputElement>('radio', { name: KIND_SURVEY });
    expect(chosen.checked).toBe(true);
    chosen.focus();
    await userEvent.keyboard('{ArrowUp}');
    expect(await screen.findByRole('button', { name: 'Utwórz zlecenie' })).toBeTruthy();
    expect(history.location.search).toBe('');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: KIND_ORDER }));
    expect(screen.getAllByRole('status').some((node) => node.textContent === 'Formularz zlecenia z szablonu')).toBe(true);
  });

  it('EVM-138 AC2 the location typed in one kind stays when the kind changes (the draft of the tab)', async () => {
    await renderPanel('/work-orders/new', api('administrator', true));
    await userEvent.type(screen.getByRole('combobox', { name: 'Lokalizacja' }), 'testowa');
    await screen.findByRole('option', { name: /ul\. Testowa 7/ });
    await userEvent.keyboard('{ArrowDown}{Enter}');
    await userEvent.click(screen.getByRole('radio', { name: KIND_SURVEY }));
    expect(await screen.findByRole('button', { name: 'Załóż wizję lokalną' })).toBeTruthy();
    expect(screen.getByText(/ul\. Testowa 7/)).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Lokalizacja' })).toBeNull();
    await userEvent.click(screen.getByRole('radio', { name: KIND_ORDER }));
    expect(await screen.findByRole('button', { name: 'Utwórz zlecenie' })).toBeTruthy();
    expect(screen.getByText(/ul\. Testowa 7/)).toBeTruthy();
  });

  it('EVM-138 AC6 the choice has no accessibility violations (axe)', async () => {
    await renderPanel('/work-orders/new', api('administrator', true));
    expect(await axeViolations(document.body)).toEqual([]);
  });
});
