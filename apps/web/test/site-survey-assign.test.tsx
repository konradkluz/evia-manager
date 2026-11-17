import type { WorkOrderDetails } from '@evia/contracts';
import { fireEvent, screen, waitFor, within, type BoundFunctions, type queries } from '@testing-library/react';
import { userEvent } from './user.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from './a11y.ts';
import { json, parseBody, problem, type Handler } from './api-fake.ts';
import { renderPanel } from './render.tsx';
import { browserStorageText, JAN, NOW, SURVEY_ID, SURVEY_PATH, SURVEY_URL, surveyApi, surveyOrder } from './site-survey-api.ts';
import { HEADER } from './work-order-api.ts';

const SEARCH = 'POST /api/v1/customers/search';
const CREATE = 'POST /api/v1/customers';
const ASSIGN = `PUT ${SURVEY_URL}/customer`;
const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The answer of the API: the same order, now with the customer and without the marker of a survey. */
const assigned = (version = 6): WorkOrderDetails => ({
  ...HEADER,
  id: SURVEY_ID,
  number: 'ZL-2026-0049',
  title: 'Wizja lokalna',
  status: 'quoting',
  customer: { id: JAN.id, displayName: JAN.displayName },
  version,
  allowedTransitions: ['accepted', 'on_hold', 'cancelled'],
  siteSurvey: null,
});

const found: Handler = () => json(200, { items: [JAN], nextCursor: null });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});
afterEach(() => {
  vi.useRealTimers();
});

const BANNER = 'Wizja lokalna — brak klienta';
const dialog = () => screen.getByRole('dialog', { name: 'Przypisz klienta' });

async function openAssign(api: ReturnType<typeof surveyApi>) {
  await renderPanel(SURVEY_PATH, api);
  const banner = await screen.findByRole('region', { name: BANNER });
  await userEvent.click(within(banner).getByRole('button', { name: 'Przypisz klienta' }));
  return within(dialog());
}

/** Chooses the customer of the search and goes to the confirmation. */
async function chooseJan(box: BoundFunctions<typeof queries>) {
  await userEvent.type(box.getByRole('combobox', { name: 'Klient' }), 'Przykł');
  await userEvent.click(await screen.findByRole('option', { name: /Jan Przykładowy/ }));
  await userEvent.click(box.getByRole('button', { name: 'Dalej' }));
  return within(dialog());
}

/** Esc on the open dialog (jsdom does not turn the key into the `cancel` event of a modal `<dialog>`). */
const pressEsc = () => {
  fireEvent(screen.getAllByRole('dialog').at(-1) as HTMLElement, new Event('cancel', { cancelable: true }));
};

const confirmName = 'Przypisz klienta Jan Przykładowy do wizji ZL-2026-0049 — nieodwracalnie';

describe('W-06 site survey: "Przypisz klienta" (EVM-138 AC3)', () => {
  it('EVM-138 AC3 an existing customer: the warning, the choice, the confirmation, PUT {customerId, version} without If-Match, then a plain order', async () => {
    const api = surveyApi(surveyOrder(), { [SEARCH]: found, [ASSIGN]: () => json(200, assigned(), { ETag: '"6"' }) });
    const box = await openAssign(api);
    expect(box.getByText('Klienta możesz przypisać tylko raz — nie da się go później zmienić.')).toBeTruthy();
    expect(box.getByRole('button', { name: 'Dalej' }).getAttribute('aria-disabled')).toBe('true');
    const confirm = await chooseJan(box);
    expect(confirm.getByRole('heading', { name: 'Przypisać klienta do wizji ZL-2026-0049?' })).toBeTruthy();
    expect(confirm.getByText('Klient: Jan Przykładowy')).toBeTruthy();
    expect(confirm.getByText(/Tego nie da się cofnąć ani zmienić\./)).toBeTruthy();
    // the new view is announced by its heading, which takes the focus
    expect(document.activeElement).toBe(confirm.getByRole('heading', { name: 'Przypisać klienta do wizji ZL-2026-0049?' }));
    await userEvent.click(confirm.getByRole('button', { name: confirmName }));
    // the banner is gone, the customer is in the card and in the header, the marks are gone
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: BANNER })).toBeNull();
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    const [call] = api.calls(ASSIGN);
    expect(parseBody(call?.body ?? '{}')).toEqual({ customerId: JAN.id, version: 5 });
    expect(call?.headers.get('Idempotency-Key') ?? '').toMatch(UUIDV7);
    expect(call?.headers.get('If-Match')).toBeNull();
    expect(screen.getByText('Przypisano klienta. Wizja jest teraz zwykłym zleceniem.')).toBeTruthy();
    expect(await screen.findByRole('heading', { level: 1, name: 'ZL-2026-0049' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'ZL-2026-0049' }));
    expect(screen.queryByText('Oznaczenie: Wizja lokalna')).toBeNull();
    expect(within(screen.getByRole('main')).getAllByText('Jan Przykładowy').length).toBeGreaterThan(0);
    expect(within(screen.getByRole('main')).queryByText('Brak klienta')).toBeNull();
  });

  it('EVM-138 AC3 a new customer: the phone of the orderer is in the form, the saved customer comes back to the confirmation', async () => {
    const api = surveyApi(surveyOrder(), {
      [SEARCH]: found,
      [CREATE]: (request) => {
        const sent = parseBody(request.body) as { id: string };
        return json(
          201,
          { id: sent.id, kind: 'person', phone: '+48600000002', displayName: 'Anna Nowak', version: 1, createdAt: NOW, updatedAt: NOW },
          { ETag: '"1"' },
        );
      },
      [ASSIGN]: () => json(200, { ...assigned(), customer: { id: 'x', displayName: 'Anna Nowak' } }),
    });
    const box = await openAssign(api);
    await userEvent.click(box.getByRole('button', { name: 'Dodaj nowego klienta' }));
    const form = within(dialog());
    expect(form.getByRole('heading', { name: 'Dodaj nowego klienta' })).toBeTruthy();
    expect(document.activeElement).toBe(form.getByRole('heading', { name: 'Dodaj nowego klienta' }));
    expect(form.getByRole<HTMLInputElement>('textbox', { name: 'Telefon' }).value).toBe('+48600000002');
    expect(form.getByText('Telefon podstawiliśmy z wizji — sprawdź go.')).toBeTruthy();
    await userEvent.type(form.getByRole('textbox', { name: 'Imię' }), 'Anna');
    await userEvent.type(form.getByRole('textbox', { name: 'Nazwisko' }), 'Nowak');
    await userEvent.click(form.getByRole('button', { name: 'Dodaj nowego klienta' }));
    const confirm = within(dialog());
    expect(await confirm.findByText('Klient: Anna Nowak')).toBeTruthy();
    expect(confirm.getByText('Dodano klienta.')).toBeTruthy();
    await userEvent.click(confirm.getByRole('button', { name: /^Przypisz klienta Anna Nowak/ }));
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: BANNER })).toBeNull();
    });
    const [assign] = api.calls(ASSIGN);
    expect(parseBody(assign?.body ?? '{}')).toMatchObject({ version: 5 });
    // the phone of the orderer is in no store and not in the address
    expect(browserStorageText()).not.toContain('600000002');
  });

  it('EVM-138 AC3 without a phone of the orderer the form of a new customer has none filled and no remark', async () => {
    const order = surveyOrder({ siteSurvey: { expiresAt: '2027-04-20T10:00:00.000Z', extensionCount: 0, requesterPhone: null } });
    const box = await openAssign(surveyApi(order, { [SEARCH]: found }));
    await userEvent.click(box.getByRole('button', { name: 'Dodaj nowego klienta' }));
    const form = within(dialog());
    expect(form.getByRole<HTMLInputElement>('textbox', { name: 'Telefon' }).value).toBe('');
    expect(form.queryByText('Telefon podstawiliśmy z wizji — sprawdź go.')).toBeNull();
    await userEvent.click(form.getByRole('button', { name: 'Wróć do wyboru' }));
    expect(within(dialog()).getByRole('combobox', { name: 'Klient' })).toBeTruthy();
  });

  it('EVM-138 AC3 412 version_conflict: the message, "Odśwież zlecenie" reads the order again, the chosen customer stays', async () => {
    let reads = 0;
    const api = surveyApi(surveyOrder(), {
      [SEARCH]: found,
      [ASSIGN]: () => problem(412, 'version_conflict'),
      [`GET ${SURVEY_URL}`]: () => {
        reads += 1;
        return json(200, surveyOrder({ version: reads === 1 ? 5 : 6 }), { ETag: `"${String(reads === 1 ? 5 : 6)}"` });
      },
    });
    const box = await openAssign(api);
    const confirm = await chooseJan(box);
    await userEvent.click(confirm.getByRole('button', { name: confirmName }));
    const alert = await within(dialog()).findByRole('alert');
    expect(alert.textContent).toContain('To zlecenie zmieniono w międzyczasie. Sprawdź jego aktualny stan i spróbuj ponownie.');
    await waitFor(() => {
      expect(reads).toBeGreaterThanOrEqual(2);
    });
    expect(within(dialog()).getByText('Klient: Jan Przykładowy')).toBeTruthy();
    // the retry carries the version that was read again, with a new key
    api.set(ASSIGN, () => json(200, assigned(7)));
    await userEvent.click(within(dialog()).getByRole('button', { name: confirmName }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    const calls = api.calls(ASSIGN);
    expect(parseBody(calls[0]?.body ?? '{}')).toMatchObject({ version: 5 });
    expect(parseBody(calls[1]?.body ?? '{}')).toMatchObject({ version: 6 });
    expect(calls[1]?.headers.get('Idempotency-Key')).not.toBe(calls[0]?.headers.get('Idempotency-Key'));
  });

  it.each([
    ['409 invalid_state_transition', () => problem(409, 'invalid_state_transition'), 'To zlecenie zmieniono w międzyczasie.'],
    [
      '409 customer_already_set',
      () => problem(409, 'customer_already_set'),
      'Ta wizja ma już klienta. Odśwież stronę, aby zobaczyć aktualny stan.',
    ],
    ['403', () => problem(403, 'forbidden'), 'Nie możesz przypisać klienta. Poproś administratora.'],
    ['429', () => problem(429, 'rate_limited', {}, { 'Retry-After': '30' }), 'Zbyt wiele prób. Spróbuj ponownie za 30 s.'],
    [
      '422 idempotency_mismatch',
      () => problem(422, 'idempotency_mismatch'),
      'Nie udało się przypisać klienta. Spróbuj ponownie — nie przypiszemy go dwa razy.',
    ],
    ['500', () => problem(500, 'internal_error'), 'Nie udało się przypisać klienta. Spróbuj ponownie — nie przypiszemy go dwa razy.'],
  ])('EVM-138 AC3 %s: a message in the dialog, the data stays', async (_name, answer, text) => {
    const api = surveyApi(surveyOrder(), { [SEARCH]: found, [ASSIGN]: answer, [`GET ${SURVEY_URL}`]: () => json(200, surveyOrder()) });
    const box = await openAssign(api);
    const confirm = await chooseJan(box);
    await userEvent.click(confirm.getByRole('button', { name: confirmName }));
    const alert = await within(dialog()).findByRole('alert');
    expect(alert.textContent).toContain(text);
    expect(within(dialog()).getByText('Klient: Jan Przykładowy')).toBeTruthy();
    expect(screen.getByRole('region', { name: BANNER })).toBeTruthy();
  });

  it('EVM-138 AC3 a lost answer: the retry of the same content sends the same Idempotency-Key', async () => {
    const answers: Handler[] = [() => problem(500, 'internal_error'), () => json(200, assigned())];
    let call = 0;
    const api = surveyApi(surveyOrder(), { [SEARCH]: found, [ASSIGN]: (request) => answers[call++]?.(request) ?? problem(500, 'x') });
    const box = await openAssign(api);
    const confirm = await chooseJan(box);
    await userEvent.click(confirm.getByRole('button', { name: confirmName }));
    await within(dialog()).findByRole('alert');
    await userEvent.click(within(dialog()).getByRole('button', { name: confirmName }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    const [first, second] = api.calls(ASSIGN);
    expect(first?.headers.get('Idempotency-Key')).toBe(second?.headers.get('Idempotency-Key'));
  });

  it('EVM-138 AC3 422 customer_unavailable: back to the choice with "Nie znaleziono wybranego klienta. Wybierz innego."', async () => {
    const api = surveyApi(surveyOrder(), { [SEARCH]: found, [ASSIGN]: () => problem(422, 'customer_unavailable') });
    const box = await openAssign(api);
    const confirm = await chooseJan(box);
    await userEvent.click(confirm.getByRole('button', { name: confirmName }));
    const alert = await within(dialog()).findByRole('alert');
    expect(alert.textContent).toContain('Nie znaleziono wybranego klienta. Wybierz innego.');
    expect(within(dialog()).getByRole('combobox', { name: 'Klient' })).toBeTruthy();
  });

  it('EVM-138 AC3 offline "Dalej" and "Przypisz klienta" are disabled with "Przypiszesz po powrocie połączenia."', async () => {
    const api = surveyApi(surveyOrder(), { [SEARCH]: found, [ASSIGN]: () => json(200, assigned()) });
    const box = await openAssign(api);
    const confirm = await chooseJan(box);
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    window.dispatchEvent(new Event('offline'));
    await waitFor(() => {
      expect(confirm.getByRole('button', { name: confirmName }).getAttribute('aria-disabled')).toBe('true');
    });
    expect(confirm.getByText('Przypiszesz po powrocie połączenia.')).toBeTruthy();
    await userEvent.click(confirm.getByRole('button', { name: confirmName }));
    expect(api.calls(ASSIGN)).toHaveLength(0);
  });

  it('EVM-138 AC3 "Wróć" and Esc: back to the choice, Esc closes the dialog and the focus goes to the heading of the order', async () => {
    const api = surveyApi(surveyOrder(), { [SEARCH]: found });
    const box = await openAssign(api);
    const confirm = await chooseJan(box);
    await userEvent.click(confirm.getByRole('button', { name: 'Wróć' }));
    // the chosen customer is kept, with "Zmień klienta"
    expect(within(dialog()).getByText('Jan Przykładowy · +48 600 000 001')).toBeTruthy();
    expect(within(dialog()).getByRole('button', { name: 'Zmień klienta' })).toBeTruthy();
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Anuluj' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(screen.getByRole('region', { name: BANNER })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'ZL-2026-0049' }));
  });

  it('EVM-138 AC3 Esc or "Wróć do wyboru" with typed data of a new customer asks "Odrzucić zmiany?"; without typed data it closes at once', async () => {
    const api = surveyApi(surveyOrder(), { [SEARCH]: found });
    const box = await openAssign(api);
    await userEvent.click(box.getByRole('button', { name: 'Dodaj nowego klienta' }));
    // the phone of the orderer is put in by the panel itself: it is not "typed data"
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Wróć do wyboru' }));
    expect(screen.queryByRole('dialog', { name: 'Odrzucić zmiany?' })).toBeNull();
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Dodaj nowego klienta' }));
    await userEvent.type(within(dialog()).getByRole('textbox', { name: 'Nazwisko' }), 'Nowak');
    pressEsc();
    const ask = await screen.findByRole('dialog', { name: 'Odrzucić zmiany?' });
    expect(document.activeElement).toBe(within(ask).getByRole('button', { name: 'Wróć do edycji' }));
    await userEvent.click(within(ask).getByRole('button', { name: 'Wróć do edycji' }));
    expect(screen.queryByRole('dialog', { name: 'Odrzucić zmiany?' })).toBeNull();
    expect(within(dialog()).getByRole<HTMLInputElement>('textbox', { name: 'Nazwisko' }).value).toBe('Nowak');
    // "Wróć do wyboru" asks too, and "Odrzuć zmiany" goes back to the choice
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Wróć do wyboru' }));
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'Odrzucić zmiany?' })).getByRole('button', { name: 'Odrzuć zmiany' }),
    );
    expect(await within(dialog()).findByRole('combobox', { name: 'Klient' })).toBeTruthy();
    // Esc in the view of the choice closes the dialog without a question
    pressEsc();
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });

  it('EVM-138 AC3 "Odrzuć zmiany" after Esc closes the whole dialog', async () => {
    const api = surveyApi(surveyOrder(), { [SEARCH]: found });
    const box = await openAssign(api);
    await userEvent.click(box.getByRole('button', { name: 'Dodaj nowego klienta' }));
    await userEvent.type(within(dialog()).getByRole('textbox', { name: 'Nazwisko' }), 'Nowak');
    pressEsc();
    await userEvent.click(
      within(await screen.findByRole('dialog', { name: 'Odrzucić zmiany?' })).getByRole('button', { name: 'Odrzuć zmiany' }),
    );
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(screen.getByRole('region', { name: BANNER })).toBeTruthy();
  });

  it('EVM-138 AC3 every view of the dialog has no axe violations', async () => {
    const api = surveyApi(surveyOrder(), { [SEARCH]: found });
    const box = await openAssign(api);
    expect(await axeViolations(dialog())).toEqual([]);
    await userEvent.click(box.getByRole('button', { name: 'Dodaj nowego klienta' }));
    expect(await axeViolations(dialog())).toEqual([]);
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Wróć do wyboru' }));
    const confirm = await chooseJan(within(dialog()));
    expect(await axeViolations(dialog())).toEqual([]);
    expect(confirm.getByRole('button', { name: confirmName })).toBeTruthy();
  });
});
