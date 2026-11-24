import { screen, within } from '@testing-library/react';
import { userEvent } from './user.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from './a11y.ts';
import { json, problem } from './api-fake.ts';
import { renderPanel } from './render.tsx';
import {
  browserStorageText,
  NOW,
  roleSession,
  SURVEY_PATH,
  SURVEY_ROUTES_NOT_ASKED,
  SURVEY_URL,
  surveyApi,
  surveyOrder,
} from './site-survey-api.ts';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});
afterEach(() => {
  vi.useRealTimers();
});

const main = () => within(screen.getByRole('main'));
const BANNER = 'Wizja lokalna — brak klienta';

describe('W-06 site survey: details (EVM-138 AC3, AC4; flows/17)', () => {
  it('EVM-138 AC3 the banner "Wizja lokalna — brak klienta" with the date, the days and "Przypisz klienta"; the marks, "Brak klienta" and the phone', async () => {
    await renderPanel(SURVEY_PATH, surveyApi());
    expect(await screen.findByRole('heading', { level: 1, name: 'ZL-2026-0049' })).toBeTruthy();
    const banner = await screen.findByRole('region', { name: BANNER });
    expect(within(banner).getByText(BANNER)).toBeTruthy();
    expect(
      within(banner).getByText(
        'Wizja zostanie trwale usunięta dnia 20.04.2027 (za 80 dni) — razem ze zdjęciami, filmami i wpisami — jeśli nie przypiszesz klienta.',
      ),
    ).toBeTruthy();
    const assign = within(banner).getByRole('button', { name: 'Przypisz klienta' });
    expect(assign.getAttribute('aria-haspopup')).toBe('dialog');
    // the mark stands next to the number and next to the status, never instead of it
    expect(main().getAllByText('Wizja lokalna').length).toBeGreaterThan(0);
    expect(main().getByText('Wycena')).toBeTruthy();
    expect(main().getAllByText('Brak klienta').length).toBeGreaterThanOrEqual(2);
    const phone = main().getByRole('link', { name: /\+48 600 000 002/ });
    expect(phone.getAttribute('href')).toBe('tel:+48600000002');
    expect(phone.textContent).toContain('Zadzwoń na telefon zamawiającego');
    // the tab title is the number only: no address, no phone
    expect(document.title).toBe('ZL-2026-0049 · EVia Manager');
  });

  it('EVM-138 AC3 the card of the customer is not asked for a survey; what the empty reads of the processes, the scope and the instalments say is ignored', async () => {
    const api = surveyApi();
    await renderPanel(SURVEY_PATH, api);
    await screen.findByRole('region', { name: BANNER });
    expect(
      api.requests
        .map((entry) => `${entry.method} ${entry.path}`)
        .filter((entry) => SURVEY_ROUTES_NOT_ASKED.some((route) => route === entry)),
    ).toEqual([]);
    expect(main().getByText(/Wizja lokalna nie ma procesów ani płatności/)).toBeTruthy();
  });

  it('EVM-138 AC3 the phone of the orderer is in no store of the browser and not in the address', async () => {
    const { history } = await renderPanel(SURVEY_PATH, surveyApi());
    await screen.findByRole('region', { name: BANNER });
    expect(history.location.href).not.toContain('600');
    expect(browserStorageText()).not.toContain('600000002');
  });

  it('EVM-138 AC3 15 days or fewer: the warning banner says "wymaga decyzji" in its name; the extensions are counted', async () => {
    const near = surveyOrder({ siteSurvey: { expiresAt: '2027-02-14T10:00:00.000Z', extensionCount: 1, requesterPhone: null } });
    await renderPanel(SURVEY_PATH, surveyApi(near));
    const banner = await screen.findByRole('region', { name: 'Wizja lokalna — brak klienta, wymaga decyzji' });
    expect(within(banner).getByText(/\(za 15 dni\)/)).toBeTruthy();
    expect(within(banner).getByText(/Przedłużono 1 z 2 razy\./)).toBeTruthy();
    // no phone: no row of the phone
    expect(main().queryByText('Telefon zamawiającego')).toBeNull();
  });

  it.each([
    ['2027-01-30T20:00:00.000Z', /\(dziś\)/],
    ['2027-01-28T10:00:00.000Z', /Termin minął — wizja zostanie wkrótce usunięta/],
  ])('EVM-138 AC3 the deadline %s in the banner', async (expiresAt, text) => {
    const order = surveyOrder({ siteSurvey: { expiresAt, extensionCount: 0, requesterPhone: null } });
    await renderPanel(SURVEY_PATH, surveyApi(order));
    const banner = await screen.findByRole('region', { name: 'Wizja lokalna — brak klienta, wymaga decyzji' });
    expect(within(banner).getByText(text)).toBeTruthy();
  });

  it('EVM-138 AC4 payments and the ZIP are disabled with a reason that is their description; photos work, and since EVM-148 so do documents', async () => {
    const api = surveyApi(surveyOrder(), {
      [`GET ${SURVEY_URL}/documents`]: () => json(200, { items: [], nextCursor: null, totalCount: 0 }),
      'GET /api/v1/catalog/document-kinds': () => json(200, { items: [] }),
    });
    await renderPanel(SURVEY_PATH, api);
    await screen.findByRole('region', { name: BANNER });
    const milestone = main().getByRole('button', { name: 'Dodaj transzę' });
    expect(milestone.getAttribute('aria-disabled')).toBe('true');
    expect(milestone.getAttribute('aria-describedby')).not.toBeNull();
    expect(main().getByText('Płatności dodasz po przypisaniu klienta.')).toBeTruthy();
    // a disabled button stays focusable
    milestone.focus();
    expect(document.activeElement).toBe(milestone);
    await userEvent.click(main().getByRole('tab', { name: 'Media i dokumenty' }));
    const zip = await main().findByRole('button', { name: 'Eksportuj zdjęcia (ZIP)' });
    expect(zip.getAttribute('aria-disabled')).toBe('true');
    expect(zip.getAttribute('aria-describedby')).not.toBeNull();
    expect(main().getByText('Eksport ZIP będzie dostępny po przypisaniu klienta.')).toBeTruthy();
    // EVM-148 AC1 AC3: an open survey takes an offer, so the button works and the old hint is gone
    const add = await main().findByRole('button', { name: 'Dodaj dokument' });
    expect(add.getAttribute('aria-disabled')).toBeNull();
    expect(main().queryByText('Dokumenty dodasz po przypisaniu klienta.')).toBeNull();
    expect(main().getByRole('button', { name: 'Dodaj zdjęcia lub filmy' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('EVM-138 AC3 the description of a survey is a free field: the dialog "Edytuj dane zlecenia" warns not to put names, surnames or phones in it (W8)', async () => {
    await renderPanel(SURVEY_PATH, surveyApi());
    await userEvent.click(await screen.findByRole('button', { name: 'Akcje zlecenia: ZL-2026-0049' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edytuj dane zlecenia…' }));
    const dialog = within(await screen.findByRole('dialog', { name: /Edytuj dane zlecenia/ }));
    expect(dialog.getByText(/Nie wpisuj imion, nazwisk ani telefonów\./)).toBeTruthy();
    expect(dialog.getByRole('textbox', { name: /Opis/ }).getAttribute('aria-describedby')).not.toBeNull();
  });

  it('EVM-138 AC3 the Editor has "Przypisz klienta" too', async () => {
    await renderPanel(SURVEY_PATH, surveyApi(surveyOrder(), {}, roleSession('editor')));
    const banner = await screen.findByRole('region', { name: BANNER });
    expect(within(banner).getByRole('button', { name: 'Przypisz klienta' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('EVM-138 AC3 offline "Przypisz klienta" is disabled and says why', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    await renderPanel(SURVEY_PATH, surveyApi());
    const banner = await screen.findByRole('region', { name: BANNER });
    expect(within(banner).getByRole('button', { name: 'Przypisz klienta' }).getAttribute('aria-disabled')).toBe('true');
    expect(within(banner).getByText('Przypiszesz po powrocie połączenia.')).toBeTruthy();
  });

  it('EVM-138 AC6 Tylko odczyt does not see a survey: 404 is "Nie znaleziono zlecenia" with no trace of the survey', async () => {
    const api = surveyApi(surveyOrder(), { [`GET ${SURVEY_URL}`]: () => problem(404, 'not_found') }, roleSession('read_only'));
    await renderPanel(SURVEY_PATH, api, { heading: false });
    expect(await screen.findByRole('heading', { level: 1, name: 'Nie znaleziono zlecenia.' })).toBeTruthy();
    expect(screen.queryByText(BANNER)).toBeNull();
    expect(document.title).toBe('Nie znaleziono · EVia Manager');
  });

  it('EVM-138 AC3 the page has no axe violations', async () => {
    const { container } = await renderPanel(SURVEY_PATH, surveyApi());
    await screen.findByRole('region', { name: BANNER });
    expect(await axeViolations(container)).toEqual([]);
  });
});
