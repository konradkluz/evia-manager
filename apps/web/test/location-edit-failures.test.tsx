import { screen, waitFor, within } from '@testing-library/react';
import { userEvent as userEventDefault } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { json, parseBody, problem } from './api-fake.ts';
import { locationServer, MANAGER_ID, MANAGER_ROUTE, OSD_ID, OSD_ROUTE, PARTY_CREATE, PATH, SITE_ROUTE } from './location-edit-api.ts';
import { renderPanel } from './render.tsx';

const userEvent = userEventDefault.setup({ delay: null });
const SITE_PATCH = `PATCH ${SITE_ROUTE}`;
const PARTY_PATCH = `PATCH ${OSD_ROUTE}`;
const EDIT = { name: 'Edytuj lokalizację' } as const;

afterEach(() => {
  vi.restoreAllMocks();
});

async function openSite() {
  await userEvent.click(await screen.findByRole('button', EDIT));
  await screen.findByRole('combobox', { name: 'Typ obiektu' });
  return screen.getByRole('dialog', EDIT);
}

async function openParty() {
  await userEvent.click(await screen.findByRole('button', { name: 'Akcje strony: Operator Testowy (OSD)' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Edytuj stronę…' }));
  await screen.findByRole('textbox', { name: 'Nazwa' });
  return screen.getByRole('dialog', { name: 'Edytuj stronę' });
}

describe('W-20 failures of saving a site (EVM-036 AC4, AC8)', () => {
  it.each([
    [
      problem(400, 'validation_failed'),
      'Nie udało się zapisać zmian lokalizacji. Spróbuj ponownie za chwilę. Jeśli problem się powtarza, zgłoś go (kod: abcdef01).',
    ],
    [problem(409, 'idempotency_in_progress'), 'Zapis tej zmiany jeszcze trwa. Spróbuj ponownie za chwilę.'],
    [problem(422, 'idempotency_mismatch'), 'Nie udało się zapisać zmian lokalizacji. Spróbuj ponownie — nie zapiszemy ich dwa razy.'],
  ])('EVM-036 AC8 a failed save is told in words and the typed data stay (%#)', async (answer, text) => {
    const { api } = locationServer({ routes: { [SITE_PATCH]: () => answer.clone() } });
    await renderPanel(PATH, api);
    const dialog = await openSite();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Miasto' }), 'X');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz zmiany' }));
    expect(await within(dialog).findByText(text)).toBeTruthy();
    expect(within(dialog).getByRole<HTMLInputElement>('textbox', { name: 'Miasto' }).value).toBe('WarszawaX');
  });

  it('EVM-036 AC4 a field cleared by somebody else is shown as "Aktualnie: brak"', async () => {
    const server = locationServer();
    await renderPanel(PATH, server.api);
    const dialog = await openSite();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'PPE (opcjonalnie)' }), '1');
    server.changeSite({ meteringPointId: undefined });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz zmiany' }));
    expect(await within(dialog).findByText('Aktualnie: brak')).toBeTruthy();
  });

  it('EVM-036 AC4 a site that is gone when the dialog opens says so; "Anuluj" closes it', async () => {
    const server = locationServer();
    server.removeSite();
    await renderPanel(PATH, server.api);
    await userEvent.click(await screen.findByRole('button', EDIT));
    const gone = await screen.findByText('Nie znaleziono lokalizacji. Mogła zostać usunięta.');
    expect(gone).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Anuluj' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(document.activeElement).toBe(screen.getByRole('button', EDIT));
  });

  it('EVM-036 AC2 a party that is gone leaves its field empty; one that cannot be read is an error with "Spróbuj ponownie"', async () => {
    let failing = true;
    const { api } = locationServer({
      routes: {
        [`GET ${OSD_ROUTE}`]: () => problem(404, 'not_found'),
        [`GET ${MANAGER_ROUTE}`]: () =>
          failing
            ? problem(500, 'internal_error')
            : json(200, {
                id: MANAGER_ID,
                kind: 'housing_community',
                legalForm: 'organization',
                displayName: 'Wspólnota Testowa',
                version: 1,
                createdAt: '2026-09-01T10:00:00.000Z',
                updatedAt: '2026-09-02T10:00:00.000Z',
              }),
      },
    });
    await renderPanel(PATH, api);
    await userEvent.click(await screen.findByRole('button', EDIT));
    expect(await screen.findByText('Nie udało się wczytać lokalizacji.')).toBeTruthy();
    failing = false;
    await userEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    const dialog = await waitFor(() => {
      const found = screen.getByRole('dialog', EDIT);
      within(found).getByRole('combobox', { name: 'Typ obiektu' });
      return found;
    });
    expect(within(dialog).getByRole('combobox', { name: 'OSD (opcjonalnie)' })).toBeTruthy();
    expect(within(dialog).getByText('Wspólnota Testowa · Wspólnota / spółdzielnia')).toBeTruthy();
  });

  it('EVM-036 AC2 "Wróć do lokalizacji" from the manager view and a party added for the OSD return to the form', async () => {
    const { api } = locationServer({
      routes: {
        [PARTY_CREATE]: (request) =>
          json(201, {
            ...(parseBody(request.body) as object),
            version: 1,
            createdAt: '2026-10-09T10:00:00.000Z',
            updatedAt: '2026-10-09T10:00:00.000Z',
          }),
      },
    });
    await renderPanel(PATH, api);
    const dialog = await openSite();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zmień zarządcę / administrację' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dodaj stronę: zarządca / administracja' }));
    const adding = await screen.findByRole('dialog', { name: 'Edytuj lokalizację › Dodaj stronę' });
    await userEvent.click(within(adding).getByRole('button', { name: 'Wróć do lokalizacji' }));
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(screen.getByRole('dialog', EDIT)).getByRole('button', { name: 'Dodaj stronę: zarządca / administracja' }),
      );
    });
    await userEvent.click(screen.getByRole('button', { name: 'Zmień OSD' }));
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj stronę: OSD' }));
    const addingOsd = await screen.findByRole('dialog', { name: 'Edytuj lokalizację › Dodaj stronę' });
    await userEvent.type(within(addingOsd).getByRole('textbox', { name: 'Nazwa' }), 'Operator Nowy');
    await userEvent.click(within(addingOsd).getByRole('button', { name: 'Dodaj stronę' }));
    expect(await screen.findByText('Operator Nowy · OSD')).toBeTruthy();
  });
});

describe('W-20 failures of saving a party (EVM-036 AC4, AC8)', () => {
  it.each([
    [
      problem(400, 'validation_failed'),
      'Nie udało się zapisać zmian strony. Spróbuj ponownie za chwilę. Jeśli problem się powtarza, zgłoś go (kod: abcdef01).',
    ],
    [problem(409, 'idempotency_in_progress'), 'Zapis tej zmiany jeszcze trwa. Spróbuj ponownie za chwilę.'],
    [problem(422, 'idempotency_mismatch'), 'Nie udało się zapisać zmian strony. Spróbuj ponownie — nie zapiszemy ich dwa razy.'],
  ])('EVM-036 AC8 a failed save is told in words and the typed data stay (%#)', async (answer, text) => {
    const { api } = locationServer({ routes: { [PARTY_PATCH]: () => answer.clone() } });
    await renderPanel(PATH, api);
    const dialog = await openParty();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Nazwa' }), 'X');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz zmiany strony' }));
    expect(await within(dialog).findByText(text)).toBeTruthy();
    expect(within(dialog).getByRole<HTMLInputElement>('textbox', { name: 'Nazwa' }).value).toBe('Operator TestowyX');
  });

  it('EVM-036 AC4 a field cleared by somebody else is "Aktualnie: brak" and the optional fields emptied are sent as null', async () => {
    const server = locationServer();
    await renderPanel(PATH, server.api);
    const dialog = await openParty();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Osoba kontaktowa (opcjonalnie)' }), ' Dwa');
    server.changeParty(OSD_ID, { contactPersonName: undefined });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz zmiany strony' }));
    expect(await within(dialog).findByText('Aktualnie: brak')).toBeTruthy();
    await userEvent.clear(within(dialog).getByRole('textbox', { name: 'Notatki (opcjonalnie)' }));
    await userEvent.clear(within(dialog).getByRole('textbox', { name: 'Telefon (opcjonalnie)' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz zmiany strony' }));
    await screen.findByText('Zapisano zmiany strony.');
    expect(parseBody(server.api.calls(PARTY_PATCH).at(-1)?.body ?? '')).toMatchObject({ notes: null, phone: null });
  });

  it('EVM-036 AC3 "Wróć do edycji" from the discard question keeps the typed data', async () => {
    const { api } = locationServer();
    await renderPanel(PATH, api);
    const dialog = await openParty();
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Nazwa' }), 'X');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anuluj' }));
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'Odrzucić zmiany?' })).getByRole('button', { name: 'Wróć do edycji' }),
    );
    const back = await screen.findByRole('dialog', { name: 'Edytuj stronę' });
    expect(within(back).getByRole<HTMLInputElement>('textbox', { name: 'Nazwa' }).value).toBe('Operator TestowyX');
  });
});
