import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { userEvent as userEventDefault } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from './a11y.ts';
import { json, parseBody, problem } from './api-fake.ts';
import { locationServer, OSD_ID, OSD_ROUTE, PATH } from './location-edit-api.ts';
import { renderPanel } from './render.tsx';

// No pause between keystrokes: typing many characters per test would otherwise run close to the 5 s limit on a slow CI runner.
const userEvent = userEventDefault.setup({ delay: null });
const READ = `GET ${OSD_ROUTE}`;
const PATCH = `PATCH ${OSD_ROUTE}`;
const MENU = { name: 'Akcje strony: Operator Testowy (OSD)' } as const;
const DIALOG = { name: 'Edytuj stronę' } as const;
const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

async function openDialog() {
  await userEvent.click(await screen.findByRole('button', MENU));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Edytuj stronę…' }));
  // the dialog shows a skeleton while the party is read: the form is there when its first field is
  await screen.findByRole('textbox', { name: 'Nazwa' });
  return screen.getByRole('dialog', DIALOG);
}

const box = (dialog: HTMLElement, name: string) => within(dialog).getByRole<HTMLInputElement>('textbox', { name });
const save = (dialog: HTMLElement) => userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz zmiany strony' }));

describe('W-20 the dialog "Edytuj stronę" (EVM-036 AC3)', () => {
  it('EVM-036 AC3 the menu next to the OSD opens the dialog filled with the party: the shared-party notice, the kind as read-only text, the notes warning', async () => {
    const { api } = locationServer();
    await renderPanel(PATH, api);
    const menu = await screen.findByRole('button', MENU);
    expect(menu.getAttribute('aria-haspopup')).toBe('menu');
    const dialog = await openDialog();
    expect(box(dialog, 'Nazwa').value).toBe('Operator Testowy');
    expect(box(dialog, 'Osoba kontaktowa (opcjonalnie)').value).toBe('Anna Kontakt');
    expect(box(dialog, 'Telefon (opcjonalnie)').value).toBe('+48 600 000 002');
    expect(box(dialog, 'E-mail (opcjonalnie)').value).toBe('przylacza@osd.test');
    expect(box(dialog, 'Notatki (opcjonalnie)').value).toBe('Wnioski tylko przez portal OSD.');
    expect(within(dialog).getByRole<HTMLInputElement>('radio', { name: 'Firma lub instytucja' }).checked).toBe(true);
    expect(
      within(dialog).getByText('Strona jest wspólna — zmiana będzie widoczna we wszystkich lokalizacjach i zleceniach z tą stroną.'),
    ).toBeTruthy();
    expect(within(dialog).getByText('Rodzaj strony')).toBeTruthy();
    expect(within(dialog).getByText('Rodzaju strony nie można zmienić — od niego zależy, gdzie można ją wybrać.')).toBeTruthy();
    expect(within(dialog).queryByRole('combobox', { name: 'Rodzaj strony' })).toBeNull();
    expect(
      within(dialog).getByText('Nie wpisuj PESEL, numerów dokumentów ani kodów do bram i alarmów. Notatki zobaczą technicy w aplikacji.'),
    ).toBeTruthy();
    expect(within(dialog).getByText('Operator Testowy · OSD')).toBeTruthy();
    expect(await axeViolations(dialog)).toEqual([]);
  });

  it('EVM-036 AC3 the manager has its own menu with the name and the role in its name', async () => {
    const { api } = locationServer();
    await renderPanel(PATH, api);
    expect(await screen.findByRole('button', { name: 'Akcje strony: Wspólnota Testowa (zarządca)' })).toBeTruthy();
  });

  it('EVM-036 AC3 a changed name and an emptied e-mail are saved with If-Match of the version on screen, a key and only those fields; the toast, the card and the focus on the menu follow', async () => {
    const server = locationServer();
    await renderPanel(PATH, server.api);
    const dialog = await openDialog();
    await userEvent.clear(box(dialog, 'Nazwa'));
    await userEvent.type(box(dialog, 'Nazwa'), 'Operator Nowy');
    await userEvent.clear(box(dialog, 'E-mail (opcjonalnie)'));
    await save(dialog);
    expect(await screen.findByText('Zapisano zmiany strony.')).toBeTruthy();
    const request = server.api.calls(PATCH).at(-1);
    expect(request?.headers.get('if-match')).toBe('"2"');
    expect(request?.headers.get('idempotency-key')).toMatch(UUIDV7);
    expect(request?.headers.get('x-csrf-token')).toBe('csrf-active');
    expect(parseBody(request?.body ?? '')).toEqual({ displayName: 'Operator Nowy', email: null });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    const card = within(screen.getByRole('region', { name: 'Lokalizacja' }));
    expect(await card.findByText('Operator Nowy')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Akcje strony: Operator Nowy (OSD)' }));
  });

  it('EVM-036 AC3 a natural person is named "Imię i nazwisko"; changing the form travels as legalForm and the kind is never sent', async () => {
    const server = locationServer();
    await renderPanel(PATH, server.api);
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Osoba fizyczna' }));
    expect(box(dialog, 'Imię i nazwisko').value).toBe('Operator Testowy');
    await save(dialog);
    await screen.findByText('Zapisano zmiany strony.');
    expect(parseBody(server.api.calls(PATCH).at(-1)?.body ?? '')).toEqual({ legalForm: 'natural_person' });
  });

  it('EVM-036 AC3 an empty name is told under the field and nothing is sent; a server error of a field (400) is told under it too', async () => {
    const { api } = locationServer({
      routes: { [PATCH]: () => problem(400, 'validation_failed', { errors: [{ pointer: '/phone', code: 'invalid_format' }] }) },
    });
    await renderPanel(PATH, api);
    const dialog = await openDialog();
    await userEvent.clear(box(dialog, 'Nazwa'));
    await save(dialog);
    expect(within(dialog).getByText('Uzupełnij to pole.')).toBeTruthy();
    expect(api.calls(PATCH)).toHaveLength(0);
    expect(document.activeElement).toBe(box(dialog, 'Nazwa'));
    await userEvent.type(box(dialog, 'Nazwa'), 'Operator Testowy');
    await userEvent.type(box(dialog, 'Telefon (opcjonalnie)'), '1');
    await save(dialog);
    expect(await within(dialog).findByText('Podaj poprawny numer telefonu, np. +48 600 000 001.')).toBeTruthy();
    expect(within(dialog).getByText('Popraw zaznaczone pola.')).toBeTruthy();
    expect(document.activeElement).toBe(box(dialog, 'Telefon (opcjonalnie)'));
  });

  it('EVM-036 AC3 nothing changed is nothing sent; Esc with typed data asks "Odrzucić zmiany?" and the focus is back on the menu', async () => {
    const { api } = locationServer();
    await renderPanel(PATH, api);
    let dialog = await openDialog();
    await save(dialog);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.calls(PATCH)).toHaveLength(0);
    dialog = await openDialog();
    await userEvent.type(box(dialog, 'Nazwa'), 'X');
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    const ask = await screen.findByRole('dialog', { name: 'Odrzucić zmiany?' });
    await userEvent.click(within(ask).getByRole('button', { name: 'Odrzuć zmiany' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.calls(PATCH)).toHaveLength(0);
    expect(document.activeElement).toBe(screen.getByRole('button', MENU));
  });

  it('EVM-036 AC3 the notes and the contact are text: markup in a note stays text in the field', async () => {
    const markup = '<script>alert(1)</script> javascript:alert(2)';
    const server = locationServer();
    server.changeParty(OSD_ID, { notes: markup });
    await renderPanel(PATH, server.api);
    const dialog = await openDialog();
    expect(box(dialog, 'Notatki (opcjonalnie)').value).toBe(markup);
    expect(document.querySelector('script')).toBeNull();
  });
});

describe('W-20 "Edytuj stronę" a conflict and other states (EVM-036 AC4, AC8)', () => {
  it('EVM-036 AC4 somebody else changed the party: 412 shows the message, the typed data stay, "Aktualnie: …" shows the new name as text and the next save asks for the new version', async () => {
    const server = locationServer();
    await renderPanel(PATH, server.api);
    const dialog = await openDialog();
    await userEvent.clear(box(dialog, 'Nazwa'));
    await userEvent.type(box(dialog, 'Nazwa'), 'Operator Nowy');
    await userEvent.type(box(dialog, 'Osoba kontaktowa (opcjonalnie)'), ' Dwa');
    server.changeParty(OSD_ID, { displayName: '<i>Operator Inny</i>' });
    await save(dialog);
    expect(
      await within(dialog).findByText(
        'Stronę zmieniono w międzyczasie. Twoje zmiany zachowaliśmy — sprawdź aktualne wartości i zapisz ponownie.',
      ),
    ).toBeTruthy();
    expect(await within(dialog).findByText('Aktualnie: <i>Operator Inny</i>')).toBeTruthy();
    expect(dialog.querySelector('i')).toBeNull();
    expect(within(dialog).getAllByText(/^Aktualnie:/)).toHaveLength(1);
    expect(box(dialog, 'Nazwa').value).toBe('Operator Nowy');
    expect(box(dialog, 'Osoba kontaktowa (opcjonalnie)').value).toBe('Anna Kontakt Dwa');
    await waitFor(() => {
      expect(document.activeElement).toBe(box(dialog, 'Nazwa'));
    });
    await save(dialog);
    await screen.findByText('Zapisano zmiany strony.');
    expect(server.api.calls(PATCH).map((request) => request.headers.get('if-match'))).toEqual(['"2"', '"3"']);
    expect(server.party(OSD_ID)?.displayName).toBe('Operator Nowy');
  });

  it('EVM-036 AC4 a party removed meanwhile (404 on save) says so and offers "Odśwież zlecenie"', async () => {
    const { api } = locationServer({ routes: { [PATCH]: () => problem(404, 'not_found') } });
    await renderPanel(PATH, api);
    const dialog = await openDialog();
    await userEvent.type(box(dialog, 'Nazwa'), 'X');
    await save(dialog);
    const gone = await screen.findByRole('dialog', DIALOG);
    expect(within(gone).getByText('Nie znaleziono strony. Mogła zostać usunięta.')).toBeTruthy();
    await userEvent.click(within(gone).getByRole('button', { name: 'Odśwież zlecenie' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('EVM-036 AC4 a party that cannot be read: the dialog says so with "Spróbuj ponownie"; a party that is gone says "Nie znaleziono strony"', async () => {
    let status = 500;
    const { api } = locationServer({
      routes: { [READ]: () => (status === 500 ? problem(500, 'internal_error') : problem(404, 'not_found')) },
    });
    await renderPanel(PATH, api);
    await userEvent.click(await screen.findByRole('button', MENU));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edytuj stronę…' }));
    const failed = await screen.findByRole('dialog', DIALOG);
    expect(await within(failed).findByText('Nie udało się wczytać strony.')).toBeTruthy();
    status = 404;
    await userEvent.click(within(failed).getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await screen.findByText('Nie znaleziono strony. Mogła zostać usunięta.')).toBeTruthy();
  });

  it('EVM-036 AC8 while the party is read the dialog shows a skeleton with a status', async () => {
    let release: (response: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const server = locationServer();
    const { api } = locationServer({ routes: { [READ]: () => pending } });
    await renderPanel(PATH, api);
    await userEvent.click(await screen.findByRole('button', MENU));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edytuj stronę…' }));
    const loading = await screen.findByRole('dialog', DIALOG);
    expect(within(loading).getByText('Wczytujemy stronę…')).toBeTruthy();
    release(json(200, server.party(OSD_ID)));
    expect((await screen.findByRole<HTMLInputElement>('textbox', { name: 'Nazwa' })).value).toBe('Operator Testowy');
  });

  it('EVM-036 AC8 429 on save: "Zbyt wiele zapytań" with the seconds from Retry-After; 403: the message says the person may not change parties; the data stay', async () => {
    let answer = problem(429, 'rate_limited', {}, { 'Retry-After': '30' });
    const { api } = locationServer({ routes: { [PATCH]: () => answer } });
    await renderPanel(PATH, api);
    const dialog = await openDialog();
    await userEvent.type(box(dialog, 'Nazwa'), 'X');
    await save(dialog);
    expect(await within(dialog).findByText('Zbyt wiele zapytań. Spróbuj ponownie za 30 s.')).toBeTruthy();
    answer = problem(403, 'forbidden');
    await save(dialog);
    expect(await within(dialog).findByText('Nie możesz zmieniać stron. Poproś administratora o uprawnienia.')).toBeTruthy();
    expect(box(dialog, 'Nazwa').value).toBe('Operator TestowyX');
  });

  it('EVM-036 AC8 offline the menu item says it can be used after the connection returns; a lost connection in the dialog disables "Zapisz zmiany strony" with the hint', async () => {
    const { api } = locationServer();
    await renderPanel(PATH, api);
    const dialog = await openDialog();
    await userEvent.type(box(dialog, 'Nazwa'), 'X');
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    window.dispatchEvent(new Event('offline'));
    expect(
      await within(dialog).findByText('Brak połączenia. Zapiszesz zmiany po powrocie połączenia — wpisane dane zostają.'),
    ).toBeTruthy();
    const submit = within(dialog).getByRole('button', { name: 'Zapisz zmiany strony' });
    expect(submit.getAttribute('aria-disabled')).toBe('true');
    expect(submit.getAttribute('title')).toBe('Zapiszesz po powrocie połączenia.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anuluj' }));
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'Odrzucić zmiany?' })).getByRole('button', { name: 'Odrzuć zmiany' }),
    );
    await userEvent.click(await screen.findByRole('button', MENU));
    const item = screen.getByRole('menuitem', { name: /Edytuj stronę…/ });
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(within(item).getByText('Zmienisz po powrocie połączenia.')).toBeTruthy();
    expect(api.calls(PATCH)).toHaveLength(0);
  });
});
