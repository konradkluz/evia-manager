import type { Customer } from '@evia/contracts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, json, parseBody, problem, SESSION_ROUTE } from './api-fake.ts';
import { activeSessionApi, renderPanel } from './render.tsx';

const ID = '01968f3e-0000-7000-8000-00000000aaa1';
const PATH = `/customers/${ID}`;
const READ = `GET /api/v1/customers/${ID}`;
const PATCH = `PATCH /api/v1/customers/${ID}`;

const JAN: Customer = {
  id: ID,
  kind: 'person',
  firstName: 'Jan',
  lastName: 'Przykładowy',
  phone: '+48600000001',
  notes: 'Kontakt najlepiej po 16:00.',
  displayName: 'Jan Przykładowy',
  version: 3,
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-02T10:00:00.000Z',
};

/** A fake server that keeps one customer: a PATCH with the right `If-Match` changes it, a wrong one is `412`. */
function server(initial: Customer = JAN) {
  let stored: Customer = { ...initial };
  const api = activeSessionApi({
    [SESSION_ROUTE]: () => json(200, ACTIVE_SESSION),
    [READ]: () => json(200, stored, { ETag: `"${String(stored.version)}"` }),
    [PATCH]: (request) => {
      if (request.headers.get('if-match') !== `"${String(stored.version)}"`) return problem(412, 'version_conflict');
      const patch = parseBody(request.body) as Record<string, unknown>;
      // merge-patch: `null` clears the field; the phone is normalised to E.164 like the server does
      const merged: Record<string, unknown> = { ...stored, ...patch };
      const next = Object.fromEntries(
        Object.entries(merged)
          .filter(([, value]) => value !== null)
          .map(([key, value]) => [
            key,
            key === 'phone' && typeof value === 'string' ? value.replaceAll(/[^+\d]/g, '').replace(/^(\d{9})$/, '+48$1') : value,
          ]),
      );
      stored = { ...(next as unknown as Customer), version: stored.version + 1 };
      return json(200, stored, { ETag: `"${String(stored.version)}"` });
    },
  });
  return {
    api,
    /** Somebody else saves a change in the meantime. */
    change(update: Partial<Customer>) {
      stored = { ...stored, ...update, version: stored.version + 1 };
    },
    get stored() {
      return stored;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

async function openDialog() {
  await userEvent.click(await screen.findByRole('button', { name: 'Akcje klienta: Jan Przykładowy' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Edytuj dane klienta…' }));
  return screen.findByRole('dialog', { name: 'Edytuj dane klienta' });
}

const field = (dialog: HTMLElement, name: string) => within(dialog).getByRole<HTMLInputElement>('textbox', { name });
const save = (dialog: HTMLElement) => userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz dane klienta' }));

describe('W-14 the dialog "Edytuj dane klienta" (EVM-039 AC3, AC4)', () => {
  it('EVM-039 AC3 opens filled with the customer, the first field has the focus and the notes carry the PESEL warning (AC4)', async () => {
    const { api } = server();
    await renderPanel(PATH, api);
    const dialog = await openDialog();
    expect(field(dialog, 'Imię').value).toBe('Jan');
    expect(field(dialog, 'Nazwisko').value).toBe('Przykładowy');
    expect(field(dialog, 'Telefon').value).toBe('+48 600 000 001');
    expect(field(dialog, 'E-mail (opcjonalnie)').value).toBe('');
    expect(within(dialog).getByRole<HTMLTextAreaElement>('textbox', { name: 'Notatki (opcjonalnie)' }).value).toBe(
      'Kontakt najlepiej po 16:00.',
    );
    expect(within(dialog).getByText('Nie wpisuj PESEL, numerów dokumentów ani kodów do bram i alarmów.')).toBeTruthy();
    expect(document.activeElement).toBe(field(dialog, 'Imię'));
    expect(within(dialog).getByText('Jan Przykładowy')).toBeTruthy();
    expect(await axeViolations(dialog)).toEqual([]);
  });

  it('EVM-039 AC3 a changed phone and a new e-mail are saved with If-Match of the version on screen, an Idempotency-Key and only those two fields', async () => {
    const { api } = server();
    await renderPanel(PATH, api);
    const dialog = await openDialog();
    await userEvent.clear(field(dialog, 'Telefon'));
    await userEvent.type(field(dialog, 'Telefon'), '600 000 008');
    await userEvent.type(field(dialog, 'E-mail (opcjonalnie)'), 'jan.nowy@example.com');
    await save(dialog);
    expect(await screen.findByText('Zapisano dane klienta.')).toBeTruthy();
    const request = api.calls(PATCH).at(-1);
    expect(request?.headers.get('if-match')).toBe('"3"');
    expect(request?.headers.get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(request?.headers.get('x-csrf-token')).toBe('csrf-active');
    expect(parseBody(request?.body ?? '')).toEqual({ phone: '600 000 008', email: 'jan.nowy@example.com' });
    // the dialog is closed, the page shows the saved data, the tab title still has no name and the focus is back on the menu
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(within(screen.getByRole('region', { name: 'Dane klienta' })).getByRole('link', { name: 'jan.nowy@example.com' })).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Dane klienta' })).getByRole('link', { name: '+48 600 000 008' })).toBeTruthy();
    expect(document.title).toBe('Klient · EVia Manager');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Akcje klienta: Jan Przykładowy' }));
  });

  it('EVM-039 AC4 the patch never carries a field of the server (id, displayName, version, …)', async () => {
    const { api } = server();
    await renderPanel(PATH, api);
    const dialog = await openDialog();
    await userEvent.type(field(dialog, 'E-mail (opcjonalnie)'), 'jan.nowy@example.com');
    await userEvent.clear(within(dialog).getByRole('textbox', { name: 'Notatki (opcjonalnie)' }));
    await save(dialog);
    await screen.findByText('Zapisano dane klienta.');
    const body = parseBody(api.calls(PATCH).at(-1)?.body ?? '') as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['email', 'notes']);
    expect(body['notes']).toBeNull();
    for (const readOnly of [
      'id',
      'displayName',
      'sortName',
      'searchText',
      'version',
      'createdAt',
      'createdBy',
      'updatedAt',
      'updatedBy',
      'deletedAt',
    ]) {
      expect(body).not.toHaveProperty(readOnly);
    }
  });

  it('EVM-039 AC3 the validation is the one of the creation: a wrong phone from the server is told under the field (no value), the focus goes there', async () => {
    const { api } = server();
    api.set(PATCH, () => problem(400, 'validation_failed', { errors: [{ pointer: '/phone', code: 'invalid_format' }] }));
    await renderPanel(PATH, api);
    const dialog = await openDialog();
    await userEvent.clear(field(dialog, 'Telefon'));
    await userEvent.type(field(dialog, 'Telefon'), '12');
    await save(dialog);
    expect(await within(dialog).findByText('Podaj poprawny numer telefonu, np. +48 600 000 001.')).toBeTruthy();
    expect(within(dialog).getByText('Popraw zaznaczone pola.')).toBeTruthy();
    expect(document.activeElement).toBe(field(dialog, 'Telefon'));
    expect(dialog.textContent).not.toContain('invalid_format');
  });

  it('EVM-039 AC3 required fields are checked before anything is sent', async () => {
    const { api } = server();
    await renderPanel(PATH, api);
    const dialog = await openDialog();
    await userEvent.clear(field(dialog, 'Imię'));
    await userEvent.clear(field(dialog, 'Telefon'));
    await save(dialog);
    expect(within(dialog).getAllByText('Uzupełnij to pole.')).toHaveLength(2);
    expect(document.activeElement).toBe(field(dialog, 'Imię'));
    expect(api.calls(PATCH)).toHaveLength(0);
  });

  it('EVM-039 AC3 nothing changed: nothing is sent and the dialog closes', async () => {
    const { api } = server();
    await renderPanel(PATH, api);
    const dialog = await openDialog();
    await save(dialog);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.calls(PATCH)).toHaveLength(0);
    expect(screen.queryByText('Zapisano dane klienta.')).toBeNull();
  });

  it('EVM-039 AC3 on 412 the typed data stays, the customer is read again, "Aktualnie: …" is plain text under the changed field and the next save asks for the new version', async () => {
    const created = server();
    const { api } = created;
    await renderPanel(PATH, api);
    const dialog = await openDialog();
    await userEvent.clear(field(dialog, 'Telefon'));
    await userEvent.type(field(dialog, 'Telefon'), '600 000 008');
    // somebody else changes the phone to something with markup-like text and the version moves on
    created.change({ phone: '+48600000009', notes: '<b>zmienione</b>' });
    const readsBefore = api.calls(READ).length;
    await save(dialog);
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toBe(
      'Dane klienta zmieniono w międzyczasie. Twoje zmiany zachowaliśmy — sprawdź aktualne wartości i zapisz ponownie.',
    );
    expect(field(dialog, 'Telefon').value).toBe('600 000 008');
    expect(await within(dialog).findByText('Aktualnie: +48 600 000 009')).toBeTruthy();
    // an untouched field changed by somebody else is not marked
    expect(within(dialog).queryByText(/zmienione/)).toBeNull();
    expect(api.calls(READ).length).toBeGreaterThan(readsBefore);
    await waitFor(() => {
      expect(document.activeElement).toBe(field(dialog, 'Telefon'));
    });
    await save(dialog);
    expect(await screen.findByText('Zapisano dane klienta.')).toBeTruthy();
    expect(api.calls(PATCH).at(-1)?.headers.get('if-match')).toBe('"4"');
    expect(parseBody(api.calls(PATCH).at(-1)?.body ?? '')).toEqual({ phone: '600 000 008' });
    expect(created.stored.version).toBe(5);
  });

  it('EVM-039 AC3 "Aktualnie" shows the value of the server as text, never as markup', async () => {
    const created = server();
    await renderPanel(PATH, created.api);
    const dialog = await openDialog();
    await userEvent.clear(within(dialog).getByRole('textbox', { name: 'Notatki (opcjonalnie)' }));
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'Notatki (opcjonalnie)' }), 'moje');
    created.change({ notes: '<img src=x onerror=alert(1)>' });
    await save(dialog);
    expect(await within(dialog).findByText('Aktualnie: <img src=x onerror=alert(1)>')).toBeTruthy();
    expect(dialog.querySelector('img')).toBeNull();
    expect(await axeViolations(dialog)).toEqual([]);
  });

  it('EVM-039 AC3 a customer deleted meanwhile (404 on save) is the screen "Nie znaleziono klienta."', async () => {
    const { api } = server();
    api.set(PATCH, () => problem(404, 'not_found'));
    api.set(READ, () => json(200, JAN, { ETag: '"3"' }));
    await renderPanel(PATH, api);
    const dialog = await openDialog();
    await userEvent.type(field(dialog, 'E-mail (opcjonalnie)'), 'jan.nowy@example.com');
    await save(dialog);
    expect(await screen.findByRole('heading', { level: 1, name: 'Nie znaleziono klienta.' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Jan Przykładowy')).toBeNull();
  });

  it('EVM-039 AC3 a lost answer is retried with the same Idempotency-Key and If-Match, so nothing is saved twice', async () => {
    const { api } = server();
    let first = true;
    api.set(PATCH, () => {
      if (first) {
        first = false;
        throw new TypeError('Failed to fetch');
      }
      return json(200, { ...JAN, phone: '+48600000008', version: 4 }, { ETag: '"4"', 'Idempotent-Replayed': 'true' });
    });
    await renderPanel(PATH, api);
    const dialog = await openDialog();
    await userEvent.clear(field(dialog, 'Telefon'));
    await userEvent.type(field(dialog, 'Telefon'), '600 000 008');
    await save(dialog);
    expect(await within(dialog).findByText('Nie udało się zapisać zmian. Spróbuj ponownie — nie zapiszemy ich dwa razy.')).toBeTruthy();
    await save(dialog);
    expect(await screen.findByText('Zapisano dane klienta.')).toBeTruthy();
    const [one, two] = api.calls(PATCH);
    expect(two?.headers.get('idempotency-key')).toBe(one?.headers.get('idempotency-key'));
    expect(two?.headers.get('if-match')).toBe(one?.headers.get('if-match'));
    expect(two?.body).toBe(one?.body);
  });

  it('EVM-039 AC3 a 403 and a 429 are told in words; the typed data stays', async () => {
    const { api } = server();
    let status = 403;
    api.set(PATCH, () => (status === 403 ? problem(403, 'forbidden') : problem(429, 'rate_limited', {}, { 'Retry-After': '30' })));
    await renderPanel(PATH, api);
    const dialog = await openDialog();
    await userEvent.type(field(dialog, 'E-mail (opcjonalnie)'), 'jan.nowy@example.com');
    await save(dialog);
    expect(await within(dialog).findByText('Nie możesz zmieniać danych klientów. Poproś administratora o uprawnienia.')).toBeTruthy();
    status = 429;
    await save(dialog);
    expect(await within(dialog).findByText('Zbyt wiele zapytań. Spróbuj ponownie za 30 s.')).toBeTruthy();
    expect(field(dialog, 'E-mail (opcjonalnie)').value).toBe('jan.nowy@example.com');
  });

  it('EVM-039 AC3 a server error gives a code for support, never the technical detail', async () => {
    const { api } = server();
    api.set(PATCH, () => problem(500, 'internal_error'));
    await renderPanel(PATH, api);
    const dialog = await openDialog();
    await userEvent.type(field(dialog, 'E-mail (opcjonalnie)'), 'jan.nowy@example.com');
    await save(dialog);
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    expect(dialog.textContent).not.toContain('internal_error');
  });

  it('EVM-039 AC3 a change of the kind says that the fields of the previous kind are not saved and sends the kind with the name of the company', async () => {
    const { api } = server();
    await renderPanel(PATH, api);
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Firma' }));
    expect(within(dialog).getByText('Po zmianie rodzaju pola poprzedniego rodzaju nie zostaną zapisane.')).toBeTruthy();
    await userEvent.type(field(dialog, 'Nazwa firmy'), 'Nowa Firma');
    await save(dialog);
    await screen.findByText('Zapisano dane klienta.');
    expect(parseBody(api.calls(PATCH).at(-1)?.body ?? '')).toEqual({ kind: 'company', companyName: 'Nowa Firma' });
  });

  it('EVM-039 AC3 offline the save is disabled and the banner says the typed data stays', async () => {
    const { api } = server();
    await renderPanel(PATH, api);
    const dialog = await openDialog();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      globalThis.dispatchEvent(new Event('offline'));
    });
    expect(within(dialog).getByText('Brak połączenia. Zapiszesz zmiany po powrocie połączenia — wpisane dane zostają.')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Zapisz dane klienta' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('EVM-039 AC3 closing with typed changes asks "Odrzucić zmiany?"; "Wróć do edycji" keeps them, "Odrzuć zmiany" drops them and the focus returns to the menu', async () => {
    const { api } = server();
    await renderPanel(PATH, api);
    let dialog = await openDialog();
    await userEvent.type(field(dialog, 'E-mail (opcjonalnie)'), 'jan.nowy@example.com');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anuluj' }));
    expect(await screen.findByRole('dialog', { name: 'Odrzucić zmiany?' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Wróć do edycji' }));
    await userEvent.click(screen.getByRole('button', { name: 'Wróć do edycji' }));
    dialog = await screen.findByRole('dialog', { name: 'Edytuj dane klienta' });
    expect(field(dialog, 'E-mail (opcjonalnie)').value).toBe('jan.nowy@example.com');
    // jsdom has no Esc handling for <dialog>: the browser's `cancel` event is sent by hand
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(await screen.findByRole('dialog', { name: 'Odrzucić zmiany?' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Odrzuć zmiany' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.calls(PATCH)).toHaveLength(0);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Akcje klienta: Jan Przykładowy' }));
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it('EVM-039 AC3 closing without typed changes closes at once', async () => {
    const { api } = server();
    await renderPanel(PATH, api);
    const dialog = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anuluj' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('EVM-039 AC3 what is typed in the dialog is not written to a store of the browser or to the address', async () => {
    const { api } = server();
    const { history } = await renderPanel(PATH, api);
    const dialog = await openDialog();
    await userEvent.type(field(dialog, 'E-mail (opcjonalnie)'), 'jan.nowy@example.com');
    expect(globalThis.localStorage.length + globalThis.sessionStorage.length).toBe(0);
    expect(history.location.search + history.location.hash).toBe('');
  });
});

describe('W-14 the roles at the edit (EVM-039 AC7)', () => {
  it('EVM-039 AC7 the Editor edits like the Administrator', async () => {
    const { api } = server();
    api.set(SESSION_ROUTE, () => json(200, { ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role: 'editor' } }));
    await renderPanel(PATH, api);
    const dialog = await openDialog();
    await userEvent.type(field(dialog, 'E-mail (opcjonalnie)'), 'jan.nowy@example.com');
    await save(dialog);
    expect(await screen.findByText('Zapisano dane klienta.')).toBeTruthy();
  });

  it('EVM-039 AC7 Tylko odczyt has no trigger and sends nothing that changes data', async () => {
    const { api } = server();
    api.set(SESSION_ROUTE, () => json(200, { ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role: 'read_only' } }));
    await renderPanel(PATH, api);
    await screen.findByRole('heading', { level: 1, name: 'Jan Przykładowy' });
    expect(screen.queryByRole('button', { name: /Akcje klienta/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Edytuj|Zapisz/ })).toBeNull();
    expect(api.requests.filter((entry) => entry.method !== 'GET')).toHaveLength(0);
  });
});
