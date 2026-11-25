import { QueryClient } from '@tanstack/react-query';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentSession, WorkOrderDetails } from '@evia/contracts';
import { axeViolations } from './a11y.ts';
import { json, parseBody, problem, type Handler } from './api-fake.ts';
import { doc } from './documents-api.ts';
import { renderPanel } from './render.tsx';
import { NOW, roleSession, SURVEY_ID, SURVEY_PATH, SURVEY_URL, surveyApi, surveyOrder } from './site-survey-api.ts';
import { userEvent } from './user.ts';

// Documents of a site survey without a customer (EVM-148 AC1-AC6; ADR-0025): the offer, the warning, the reasons of a failure. Synthetic data only.
const DOCS = `${SURVEY_URL}/documents`;
const file = (name = 'oferta-testowa.pdf') => new File([new Uint8Array(1000)], name);
const dialog = () => screen.getByRole('dialog');
const panel = () => screen.findByRole('list', { name: 'Wysyłanie dokumentu' });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

interface Options {
  readonly order?: WorkOrderDetails;
  readonly documents?: ReturnType<typeof doc>[];
  readonly create?: Handler;
  readonly session?: CurrentSession;
  readonly header?: Handler;
}

function api({ order = surveyOrder(), documents = [], create, session, header }: Options = {}) {
  return surveyApi(
    order,
    {
      [`GET ${DOCS}`]: () => json(200, { items: documents, nextCursor: null, totalCount: documents.length }),
      [`POST ${DOCS}`]: create ?? (() => problem(500, 'internal_error')),
      'GET /api/v1/catalog/document-kinds': () =>
        json(200, { items: [{ code: 'quote', name: 'Oferta/wycena', confidentiality: 'standard' }] }),
      ...(header === undefined ? {} : { [`GET ${SURVEY_URL}`]: header }),
    },
    session,
  );
}

async function open(options: Options = {}, client?: QueryClient) {
  const fake = api(options);
  await renderPanel(SURVEY_PATH, fake, client === undefined ? {} : { queryClient: client });
  await screen.findByRole('region', { name: /^Wizja lokalna — brak klienta|^Wizja odrzucona/ }).catch(() => undefined);
  await userEvent.click(await screen.findByRole('tab', { name: 'Media i dokumenty' }));
  await screen.findByRole('heading', { level: 2, name: /^Dokumenty zlecenia/ });
  return fake;
}

const addButton = () => screen.findByRole('button', { name: 'Dodaj dokument' });

async function sendOffer(title = 'Oferta testowa') {
  await userEvent.click(await addButton());
  fireEvent.change(within(dialog()).getByLabelText('Plik dokumentu'), { target: { files: [file()] } });
  await userEvent.type(within(dialog()).getByRole('textbox', { name: 'Tytuł' }), title);
  await userEvent.click(within(dialog()).getByRole('button', { name: 'Dodaj dokument' }));
}

describe('EVM-148 AC1 "Dodaj dokument" in a site survey', () => {
  it('EVM-148 AC1 both buttons - the one of the empty state and the one at the heading - work in an open survey', async () => {
    await open();
    expect((await addButton()).getAttribute('aria-disabled')).toBeNull();
    expect(screen.queryByText(/Dokumenty dodasz po przypisaniu klienta/)).toBeNull();
  });

  it('EVM-148 AC1 with a document in the list the button at the heading works too', async () => {
    await open({ documents: [doc(1, { title: 'Oferta istniejąca', workOrderId: SURVEY_ID })] });
    const add = await addButton();
    expect(add.getAttribute('aria-disabled')).toBeNull();
    await userEvent.click(add);
    expect(dialog()).toBeTruthy();
  });

  it('EVM-148 AC1 a rejected survey: disabled with the reason as its visible description', async () => {
    await open({ order: surveyOrder({ status: 'cancelled', allowedTransitions: [] }) });
    const add = await addButton();
    expect(add.getAttribute('aria-disabled')).toBe('true');
    const hint = document.getElementById(add.getAttribute('aria-describedby') ?? '');
    expect(hint?.textContent).toBe('Wizja jest odrzucona — dokumentów nie można już dodawać.');
    add.focus();
    expect(document.activeElement).toBe(add);
  });

  it('EVM-148 AC1 an expired survey: disabled with the reason', async () => {
    await open({ order: surveyOrder({ siteSurvey: { expiresAt: '2027-01-20T10:00:00.000Z', extensionCount: 0, requesterPhone: null } }) });
    const add = await addButton();
    expect(add.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Termin wizji minął — dokumentów nie można już dodawać.')).toBeTruthy();
  });

  it('EVM-148 AC1 K1 when the data of the survey could not be read again the button is disabled, says so, and "Spróbuj ponownie" reads them again', async () => {
    let calls = 0;
    const header: Handler = () => {
      calls += 1;
      return calls === 1 ? json(200, surveyOrder(), { ETag: '"5"' }) : problem(500, 'internal_error');
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await open({ header }, client);
    expect((await addButton()).getAttribute('aria-disabled')).toBeNull();
    await client.invalidateQueries({ queryKey: ['work-order-header', SURVEY_ID] });
    await waitFor(() => {
      expect(screen.getByText('Nie wczytano danych wizji.')).toBeTruthy();
    });
    const add = await addButton();
    expect(add.getAttribute('aria-disabled')).toBe('true');
    expect(add.getAttribute('aria-describedby')).not.toBeNull();
    const before = calls;
    await userEvent.click(
      within(screen.getByRole('region', { name: /^Dokumenty zlecenia/ })).getByRole('button', { name: 'Spróbuj ponownie' }),
    );
    await waitFor(() => {
      expect(calls).toBeGreaterThan(before);
    });
  });

  it('EVM-148 AC1 K9 Tylko odczyt has no button (the survey is a 404 for that role)', async () => {
    const fake = surveyApi(surveyOrder(), { [`GET ${SURVEY_URL}`]: () => problem(404, 'not_found') }, roleSession('read_only'));
    await renderPanel(SURVEY_PATH, fake, { heading: false });
    expect(await screen.findByRole('heading', { level: 1, name: 'Nie znaleziono zlecenia.' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Dodaj dokument' })).toBeNull();
  });
});

describe('EVM-148 AC2 the form of an offer', () => {
  it('EVM-148 AC2 "Przypisz do" and "Rodzaj" are read-only text, there is no class and no stage, the warning and the hint of the description stand where the story puts them', async () => {
    await open();
    await userEvent.click(await addButton());
    const form = within(dialog());
    const anchor = form.getByRole('textbox', { name: 'Przypisz do' });
    const kind = form.getByRole('textbox', { name: 'Rodzaj' });
    expect((anchor as HTMLInputElement).value).toBe('Zlecenie');
    expect((anchor as HTMLInputElement).readOnly).toBe(true);
    expect((kind as HTMLInputElement).value).toBe('Oferta/wycena');
    expect((kind as HTMLInputElement).readOnly).toBe(true);
    expect(form.queryByRole('radio')).toBeNull();
    expect(form.queryByRole('combobox')).toBeNull();
    expect(form.queryByText(/Podnieś klasę/)).toBeNull();
    expect(form.queryByText(/Etap/)).toBeNull();
    expect(form.getByText('Dane osobowe w ofercie')).toBeTruthy();
    const warning = form.getByText(
      'Oferta może zawierać imię i nazwisko zamawiającego. Nie dodawaj skanów dokumentów tożsamości i nie wpisuj imion ani nazwisk w tytule i opisie.',
    );
    const title = form.getByRole('textbox', { name: 'Tytuł' });
    expect(warning.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const description = form.getByRole('textbox', { name: 'Opis (opcjonalnie)' });
    expect(document.getElementById(description.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'Nie wpisuj imion, nazwisk, PESEL ani numerów dokumentów.',
    );
    expect(await axeViolations(dialog())).toEqual([]);
  });

  it('EVM-148 AC2 K2 the request is the kind "quote" for the order and carries none of the fields a survey refuses', async () => {
    const fake = await open();
    await sendOffer();
    await waitFor(() => {
      expect(fake.calls(`POST ${DOCS}`)).toHaveLength(1);
    });
    const body = parseBody(fake.calls(`POST ${DOCS}`)[0]?.body ?? '{}') as Record<string, unknown>;
    expect(body).toMatchObject({ kindCode: 'quote', title: 'Oferta testowa' });
    for (const field of ['anchor', 'confidentialityOverride', 'procedureStageId', 'containsIdentityData'])
      expect(body).not.toHaveProperty(field);
  });

  it('EVM-148 AC2 the form asks for the file and the title, not for a kind', async () => {
    const fake = await open();
    await userEvent.click(await addButton());
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Dodaj dokument' }));
    expect(within(dialog()).getByText('Wybierz plik dokumentu.')).toBeTruthy();
    expect(within(dialog()).getByText('Wpisz tytuł dokumentu.')).toBeTruthy();
    expect(within(dialog()).queryByText('Wybierz rodzaj dokumentu.')).toBeNull();
    expect(fake.calls(`POST ${DOCS}`)).toHaveLength(0);
  });
});

describe('EVM-148 AC3 the empty state and the line about the deletion', () => {
  it('EVM-148 AC3 the empty state of an open survey says that the documents go with the survey, with the date', async () => {
    await open();
    expect(await screen.findByText('Brak dokumentów.')).toBeTruthy();
    expect(screen.getByText('Dokumenty znikną razem z wizją dnia 20.04.2027, jeśli nie przypiszesz klienta.')).toBeTruthy();
  });

  it('EVM-148 AC3 the empty state of a rejected survey', async () => {
    await open({ order: surveyOrder({ status: 'cancelled', allowedTransitions: [] }) });
    expect(await screen.findByText('Wizja jest odrzucona. Dokumenty zostaną usunięte razem z nią dnia 20.04.2027.')).toBeTruthy();
  });

  it('EVM-148 AC3 with documents the constant line stands under the heading', async () => {
    await open({ documents: [doc(1, { title: 'Oferta istniejąca', workOrderId: SURVEY_ID })] });
    const heading = await screen.findByRole('heading', { level: 2, name: 'Dokumenty zlecenia (1)' });
    const line = screen.getByText('Dokumenty znikną razem z wizją dnia 20.04.2027.');
    expect(heading.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('EVM-148 AC4 AC5 the reason of a failure and the next step', () => {
  const noRetry = (name: string) => {
    expect(within(screen.getByRole('list', { name: 'Wysyłanie dokumentu' })).queryByRole('button', { name })).toBeNull();
  };

  it.each([
    [
      '409 customer_required',
      () => problem(409, 'customer_required'),
      'Nie dodano dokumentu. Najpierw przypisz klienta do tej wizji.',
      false,
    ],
    [
      '400 requires_customer on /kindCode',
      () => problem(400, 'validation_failed', { errors: [{ pointer: '/kindCode', code: 'requires_customer' }] }),
      'Przed przypisaniem klienta można dodać tylko ofertę/wycenę. Zmień pole „Rodzaj”.',
      false,
    ],
    [
      '409 id_conflict',
      () => problem(409, 'id_conflict'),
      'Nie wysłano — dokument o tym identyfikatorze już istnieje. Dodaj go ponownie.',
      false,
    ],
    [
      '409 work_order_closed',
      () => problem(409, 'work_order_closed'),
      'Ta wizja jest odrzucona i jest tylko do odczytu — dokumentów nie można już dodawać.',
      false,
    ],
    ['409 unknown', () => problem(409, 'something_new'), 'Nie udało się wysłać dokumentu. Spróbuj ponownie.', true],
    ['403', () => problem(403, 'forbidden'), 'Nie masz uprawnień do dodawania dokumentów do tej wizji.', false],
    ['429', () => problem(429, 'rate_limited'), 'Zbyt wiele zapytań. Poczekaj chwilę i spróbuj ponownie.', true],
    [
      '429 Retry-After',
      () => problem(429, 'rate_limited', {}, { 'Retry-After': '30' }),
      'Zbyt wiele zapytań. Poczekaj i spróbuj ponownie za 30 s.',
      true,
    ],
    ['500', () => problem(500, 'internal_error'), 'Nie udało się wysłać dokumentu. Spróbuj ponownie.', true],
  ] as const)(
    'EVM-148 AC4 AC5 %s: its own text, an alert, "Ponów" only where it can help, no name of the file or the title',
    async (_name, answer, text, retry) => {
      await open({ create: () => answer() });
      await sendOffer('Tytuł do ukrycia');
      const list = await panel();
      const message = await within(list).findByText(text);
      expect(message.closest('[role="alert"]')).not.toBeNull();
      if (retry) expect(within(list).getByRole('button', { name: 'Ponów' })).toBeTruthy();
      else noRetry('Ponów');
      expect(within(list).getByRole('button', { name: 'Ukryj' })).toBeTruthy();
      // the title is the name of the line; the text of the failure itself carries neither the title nor the file
      expect(message.textContent).not.toContain('Tytuł do ukrycia');
      expect(message.closest('[role="alert"]')?.textContent).not.toContain('oferta-testowa.pdf');
      expect(await axeViolations(list)).toEqual([]);
    },
  );

  it('EVM-148 AC5 "customer_required" keeps the line until "Ukryj"; "Dodaj ponownie" opens the form filled in and sends a new document with a new key; nothing goes to the storage; nothing is logged', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const fake = await open({ create: () => problem(409, 'customer_required') });
    await sendOffer('Oferta testowa');
    const list = await panel();
    expect(await within(list).findByText(/Wybierz „Przypisz klienta” u góry strony/)).toBeTruthy();
    await userEvent.click(within(list).getByRole('button', { name: 'Dodaj ponownie' }));
    const form = within(dialog());
    expect(form.getByRole<HTMLInputElement>('textbox', { name: 'Tytuł' }).value).toBe('Oferta testowa');
    expect(form.getByText(/^oferta-testowa.pdf · /)).toBeTruthy();
    await userEvent.click(form.getByRole('button', { name: 'Dodaj dokument' }));
    await waitFor(() => {
      expect(fake.calls(`POST ${DOCS}`)).toHaveLength(2);
    });
    const [first, second] = fake.calls(`POST ${DOCS}`);
    expect((parseBody(first?.body ?? '{}') as { id: string }).id).not.toBe((parseBody(second?.body ?? '{}') as { id: string }).id);
    expect(second?.headers.get('Idempotency-Key')).not.toBe(first?.headers.get('Idempotency-Key'));
    // the old line stays until "Ukryj"
    await waitFor(() => {
      expect(within(screen.getByRole('list', { name: 'Wysyłanie dokumentu' })).getAllByRole('button', { name: 'Ukryj' })).toHaveLength(2);
    });
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(location.search).toBe('');
    for (const spy of [log, warn, info]) expect(spy).not.toHaveBeenCalled();
  });

  it('EVM-148 AC5 "Ponów" of a failure that can be retried keeps the file and the fields (the same document, the same key)', async () => {
    let attempts = 0;
    const fake = await open({
      create: (request) => {
        attempts += 1;
        return attempts === 1
          ? problem(500, 'internal_error')
          : json(201, doc(1, { id: (parseBody(request.body) as { id: string }).id, workOrderId: SURVEY_ID, fileState: 'pending_upload' }));
      },
    });
    await sendOffer();
    await userEvent.click(await within(await panel()).findByRole('button', { name: 'Ponów' }));
    await waitFor(() => {
      expect(fake.calls(`POST ${DOCS}`)).toHaveLength(2);
    });
    const [first, second] = fake.calls(`POST ${DOCS}`);
    expect(second?.headers.get('Idempotency-Key')).toBe(first?.headers.get('Idempotency-Key'));
    expect(second?.body).toBe(first?.body);
  });
});
