import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { userEvent as userEventDefault } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from './a11y.ts';
import { json, parseBody, problem, type Handler } from './api-fake.ts';
import { NOW, STAGE_ID, TIMELINE, entry, journalApi, roleSession } from './journal-api.ts';
import { renderPanel } from './render.tsx';
import { HEADER, ORDER_ID } from './work-order-api.ts';
import { clearDrafts } from '../src/session/draft-store.ts';

const userEvent = userEventDefault.setup({ delay: null });
const PATH = `/work-orders/${ORDER_ID}`;
const POST = `POST ${TIMELINE}`;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

beforeEach(() => {
  // Only the clock is fake: "dziś" and "wczoraj" are counted from NOW (14:00 in Warsaw, 11 October 2026).
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  clearDrafts();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

async function openJournal(api = journalApi({ entries: [entry(1)] })) {
  await renderPanel(PATH, api);
  await screen.findByRole('heading', { level: 1, name: 'ZL-2026-0042' });
  await userEvent.click(await screen.findByRole('tab', { name: 'Dziennik' }));
  await screen.findByRole('heading', { level: 2, name: 'Dziennik' });
  return api;
}

const items = () => screen.queryAllByRole('listitem', { name: /^(Wpis|Komentarz|Poprawka wpisu|Wpis systemowy):/ });
const body = () => screen.getByRole('textbox', { name: 'Treść' });
const fill = (value: string) => {
  fireEvent.change(body(), { target: { value } });
};
const posted = (api: ReturnType<typeof journalApi>) => api.calls(POST).map((call) => call.body);

describe('W-08 Dziennik: dodaj wpis (EVM-037 AC1)', () => {
  it('EVM-037 AC1 a note with a category and a stage goes to the top with the author, the time, the category and the stage, and the toast says "Dodano wpis."', async () => {
    const api = await openJournal();
    expect(await screen.findByText('Wpis numer 1')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Rozmowa telefoniczna' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Etap (opcjonalnie)' }), STAGE_ID);
    await userEvent.type(body(), 'Uzgodniono termin przeglądu.');
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj wpis' }));

    expect(await screen.findByText('Dodano wpis.')).toBeTruthy();
    const [call] = api.calls(POST);
    const sent = parseBody(call?.body ?? '{}') as Record<string, unknown>;
    expect(sent).toMatchObject({
      kind: 'note',
      noteCategory: 'phone_call',
      body: 'Uzgodniono termin przeglądu.',
      procedureStageId: STAGE_ID,
    });
    expect(String(sent['id'])).toMatch(UUID_V7);
    expect(call?.headers.get('Idempotency-Key') ?? '').toMatch(UUID_V7);
    // The request carries nothing the server decides (author, time, origin).
    expect(Object.keys(sent).sort()).toEqual(['body', 'id', 'kind', 'noteCategory', 'procedureStageId']);

    await waitFor(() => {
      expect(items()).toHaveLength(2);
    });
    const first = items()[0] as HTMLElement;
    expect(first.getAttribute('aria-label')).toBe('Wpis: Anna Testowa, 11.10.2026 14:00');
    expect(within(first).getByText('Uzgodniono termin przeglądu.')).toBeTruthy();
    expect(within(first).getByText('Anna Testowa')).toBeTruthy();
    expect(within(first).getByText('Rozmowa telefoniczna · Etap: Warunki przyłączenia')).toBeTruthy();
    expect(within(first).getByText('dziś, 14:00')).toBeTruthy();
    // the field is empty again and no draft is shown
    expect((body() as HTMLTextAreaElement).value).toBe('');
    expect(screen.queryByText(/Szkic w tej karcie/)).toBeNull();
  });

  it('EVM-037 AC1 the field has the reminder about personal data, a counter and the five categories of the mockup', async () => {
    await openJournal();
    expect(screen.getByText('Nie wpisuj PESEL, numerów dokumentów ani kodów do bram i alarmów.')).toBeTruthy();
    expect(screen.getByText(/^0 z 10\s000 znaków$/)).toBeTruthy();
    for (const label of ['Rozmowa telefoniczna', 'Ustalenie', 'Spotkanie', 'Wizyta na miejscu', 'Inne'])
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    // "Ustalenie" is the preselected category of the mockup
    expect(screen.getByRole('button', { name: 'Ustalenie' }).getAttribute('aria-pressed')).toBe('true');
    // the stages of the order are offered, grouped by process
    const stage = screen.getByRole('combobox', { name: 'Etap (opcjonalnie)' });
    expect(within(stage).getByRole('option', { name: 'Bez etapu' })).toBeTruthy();
    expect(within(stage).getByRole('option', { name: 'Warunki przyłączenia' })).toBeTruthy();
    fill('Zażółć gęślą 😀');
    expect(screen.getByText(/^14 z 10\s000 znaków$/)).toBeTruthy();
  });

  it('EVM-037 AC1 an empty text is not sent and says what to do', async () => {
    const api = await openJournal();
    fill('   ');
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj wpis' }));
    expect(await screen.findByText('Wpisz treść wpisu.')).toBeTruthy();
    expect(api.calls(POST)).toHaveLength(0);
  });
});

describe('W-08 Dziennik: komentarz (EVM-037 AC2)', () => {
  it('EVM-037 AC2 a comment has no category, goes out as a comment and has its own marker (message-square-text)', async () => {
    const api = await openJournal();
    await userEvent.click(screen.getByRole('radio', { name: 'Komentarz' }));
    expect(screen.queryByRole('button', { name: 'Rozmowa telefoniczna' })).toBeNull();
    await userEvent.type(body(), 'Proszę o potwierdzenie terminu.');
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj komentarz' }));
    expect(await screen.findByText('Dodano komentarz.')).toBeTruthy();
    expect(parseBody(posted(api)[0] ?? '{}')).toMatchObject({ kind: 'comment', body: 'Proszę o potwierdzenie terminu.' });
    expect(Object.keys(parseBody(posted(api)[0] ?? '{}') as object)).not.toContain('noteCategory');
    await waitFor(() => {
      expect(items()).toHaveLength(2);
    });
    const comment = items()[0] as HTMLElement;
    expect(comment.getAttribute('aria-label')).toMatch(/^Komentarz: Anna Testowa/);
    expect(comment.querySelector('svg.lucide-message-square-text')).not.toBeNull();
    // a note has the pencil
    expect((items()[1] as HTMLElement).querySelector('svg.lucide-pencil')).not.toBeNull();
  });
});

describe('W-08 Dziennik: poprawka zamiast edycji (EVM-037 AC3)', () => {
  const original = entry(2, {
    id: 'e0000000-0000-7000-8000-000000000002',
    body: 'Trasa kabla przez szacht A.',
    supersededByEntryId: 'e0000000-0000-7000-8000-000000000001',
  });
  const correction = entry(1, {
    id: 'e0000000-0000-7000-8000-000000000001',
    body: 'Trasa kabla przez szacht B.',
    supersedesEntryId: original.id,
  });

  it('EVM-037 AC3 the replaced entry is collapsed with "Zastąpiony poprawką z …" and "Pokaż treść"; the correction says "Poprawka wpisu z …:"', async () => {
    await openJournal(journalApi({ entries: [correction, original] }));
    const [latest, old] = await waitFor(() => {
      const found = items();
      expect(found).toHaveLength(2);
      return found;
    });
    expect(latest?.getAttribute('aria-label')).toMatch(/^Poprawka wpisu: Anna Testowa/);
    expect(within(latest as HTMLElement).getByText('Poprawka wpisu z dziś, 13:58:')).toBeTruthy();
    expect(within(latest as HTMLElement).getByText('Trasa kabla przez szacht B.')).toBeTruthy();
    const view = within(old as HTMLElement);
    expect(view.getByText('Zastąpiony poprawką z dziś, 13:59')).toBeTruthy();
    expect(view.queryByText('Trasa kabla przez szacht A.')).toBeNull();
    const show = view.getByRole('button', { name: 'Pokaż treść' });
    expect(show.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(show);
    expect(view.getByText('Trasa kabla przez szacht A.')).toBeTruthy();
    expect(view.getByRole('button', { name: 'Ukryj treść' }).getAttribute('aria-expanded')).toBe('true');
    // only the newest version of an entry can be corrected
    expect(view.queryByRole('button', { name: /^Akcje wpisu/ })).toBeNull();
  });

  it('EVM-037 AC3 "Popraw wpis" opens the text, sends a NEW entry that points at the old one and offers nothing else', async () => {
    const api = await openJournal(journalApi({ entries: [correction, original] }));
    await userEvent.click(await screen.findByRole('button', { name: 'Akcje wpisu: Anna Testowa, dziś, 13:59' }));
    // the menu has the correction only: the text of an entry cannot be edited or deleted
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Popraw wpis']);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Popraw wpis' }));
    const dialog = await screen.findByRole('dialog', { name: 'Popraw wpis' });
    const field = within(dialog).getByRole('textbox', { name: 'Treść poprawki' });
    expect((field as HTMLTextAreaElement).value).toBe('Trasa kabla przez szacht B.');
    fireEvent.change(field, { target: { value: 'Trasa kabla przez szacht C.' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz poprawkę' }));
    expect(await screen.findByText('Dodano poprawkę wpisu.')).toBeTruthy();
    expect(parseBody(posted(api)[0] ?? '{}')).toMatchObject({
      kind: 'note',
      noteCategory: 'arrangement',
      body: 'Trasa kabla przez szacht C.',
      supersedesEntryId: correction.id,
    });
    await waitFor(() => {
      expect(items()).toHaveLength(3);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('EVM-037 AC3 a correction that somebody made first is told in words and keeps the text', async () => {
    const api = await openJournal(
      journalApi({ entries: [entry(1, { id: 'e0000000-0000-7000-8000-000000000009' })], post: () => problem(409, 'entry_superseded') }),
    );
    await userEvent.click(await screen.findByRole('button', { name: /^Akcje wpisu/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Popraw wpis' }));
    const dialog = await screen.findByRole('dialog', { name: 'Popraw wpis' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Treść poprawki' }), { target: { value: 'Inna treść.' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz poprawkę' }));
    expect(await within(dialog).findByText(/Ten wpis został już poprawiony/)).toBeTruthy();
    expect(within(dialog).getByRole<HTMLTextAreaElement>('textbox', { name: 'Treść poprawki' }).value).toBe('Inna treść.');
    expect(api.calls(POST)).toHaveLength(1);
  });

  it('EVM-037 AC3 closing the correction with changes asks first; without changes it closes', async () => {
    await openJournal();
    await userEvent.click(await screen.findByRole('button', { name: /^Akcje wpisu/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Popraw wpis' }));
    let dialog = await screen.findByRole('dialog', { name: 'Popraw wpis' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anuluj' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /^Akcje wpisu/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Popraw wpis' }));
    dialog = await screen.findByRole('dialog', { name: 'Popraw wpis' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Treść poprawki' }), { target: { value: 'Zmieniono.' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Anuluj' }));
    expect(await screen.findByRole('dialog', { name: 'Odrzucić zmiany?' })).toBeTruthy();
  });
});

describe('W-08 Dziennik: poprawka — walidacja i połączenie (EVM-037 AC3, AC8)', () => {
  it('EVM-037 AC8 an empty or too long correction is not sent; offline the dialog says so and "Zapisz poprawkę" is disabled', async () => {
    const api = await openJournal();
    await userEvent.click(await screen.findByRole('button', { name: /^Akcje wpisu/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Popraw wpis' }));
    const dialog = await screen.findByRole('dialog', { name: 'Popraw wpis' });
    const field = within(dialog).getByRole('textbox', { name: 'Treść poprawki' });
    fireEvent.change(field, { target: { value: '   ' } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz poprawkę' }));
    expect(await within(dialog).findByText('Wpisz treść wpisu.')).toBeTruthy();
    fireEvent.change(field, { target: { value: 'b'.repeat(10_001) } });
    expect(await within(dialog).findByText(/najwyżej 10\s000 znaków/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz poprawkę' }));
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      globalThis.dispatchEvent(new Event('offline'));
    });
    expect(await within(dialog).findAllByText('Zapiszesz poprawkę po powrocie połączenia.')).not.toHaveLength(0);
    expect(within(dialog).getByRole('button', { name: 'Zapisz poprawkę' }).getAttribute('aria-disabled')).toBe('true');
    expect(api.calls(POST)).toHaveLength(0);
  });
});

describe('W-08 Dziennik: treść jako tekst (EVM-037 AC4; SR-WEB-03)', () => {
  it('EVM-037 AC4 a script and a javascript: address are text, only https, tel and mailto are links, nothing runs', async () => {
    const alert = vi.spyOn(globalThis, 'alert').mockImplementation(() => undefined);
    const text =
      '<script>alert(1)</script> zobacz javascript:alert(1) oraz https://example.invalid/mapa. tel:+48600000001 mailto:biuro@example.invalid?cc=x@example.invalid\nDruga linia';
    await openJournal(journalApi({ entries: [entry(1, { body: text })] }));
    const view = within(
      (
        await waitFor(() => {
          const found = items();
          expect(found).toHaveLength(1);
          return found;
        })
      )[0] as HTMLElement,
    );
    expect(view.getByText(/<script>alert\(1\)<\/script> zobacz javascript:alert\(1\)/)).toBeTruthy();
    expect(document.querySelector('script[src], main script')).toBeNull();
    const links = view.getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      'https://example.invalid/mapa',
      'tel:+48600000001',
      'mailto:biuro@example.invalid',
    ]);
    for (const link of links) expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(alert).not.toHaveBeenCalled();
    // line breaks are kept
    expect(view.getByText(/Druga linia/).className).toContain('whitespace-pre-line');
  });

  it('EVM-037 AC4 an entry whose text was redacted says so and shows no text; an unknown kind is a neutral system entry', async () => {
    await openJournal(
      journalApi({
        entries: [
          entry(1, { body: null, redactedAt: '2026-10-03T08:00:00.000Z' }),
          entry(2, { kind: 'event' as 'note', noteCategory: null, body: null, author: null }),
        ],
      }),
    );
    expect(await screen.findByText('Treść usunięta przez administratora 03.10.2026.')).toBeTruthy();
    const system = items().find((item) => /^Wpis systemowy:/.test(item.getAttribute('aria-label') ?? ''));
    expect(system).toBeTruthy();
    expect(within(system as HTMLElement).getByText('System')).toBeTruthy();
    expect(screen.queryByText('event')).toBeNull();
  });
});

describe('W-08 Dziennik: ponowienie bez duplikatu (EVM-037 AC5)', () => {
  it('EVM-037 AC5 after a lost answer the retry has the same id and the same Idempotency-Key and the text stays', async () => {
    let attempts = 0;
    const handler: Handler = (request) => {
      attempts += 1;
      if (attempts === 1) throw new TypeError('Failed to fetch');
      const sent = parseBody(request.body) as { id: string; body: string };
      return json(201, entry(0, { id: sent.id, body: sent.body }));
    };
    const api = await openJournal(journalApi({ entries: [], post: handler }));
    await userEvent.type(body(), 'Ustalenie z administratorem.');
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj wpis' }));
    expect(await screen.findByText('Nie udało się dodać wpisu. Spróbuj ponownie — nie dodamy go dwa razy.')).toBeTruthy();
    expect((body() as HTMLTextAreaElement).value).toBe('Ustalenie z administratorem.');

    await userEvent.click(screen.getByRole('button', { name: 'Dodaj wpis' }));
    expect(await screen.findByText('Dodano wpis.')).toBeTruthy();
    const [first, second] = api.calls(POST);
    expect(first?.body).toBe(second?.body);
    expect(first?.headers.get('Idempotency-Key')).toBe(second?.headers.get('Idempotency-Key'));
    expect(screen.queryByText(/nie dodamy go dwa razy/)).toBeNull();
    expect((body() as HTMLTextAreaElement).value).toBe('');
  });

  it('EVM-037 AC5 changed text is a new attempt with a new id and key', async () => {
    const api = await openJournal(journalApi({ entries: [], post: () => problem(503, 'service_unavailable') }));
    await userEvent.type(body(), 'Pierwsza wersja.');
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj wpis' }));
    await screen.findByText(/nie dodamy go dwa razy|Nie udało się dodać wpisu/);
    await userEvent.type(body(), ' Dopisek.');
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj wpis' }));
    await waitFor(() => {
      expect(api.calls(POST)).toHaveLength(2);
    });
    const [first, second] = api.calls(POST);
    expect(parseBody(first?.body ?? '{}')).not.toMatchObject({ id: (parseBody(second?.body ?? '{}') as { id: string }).id });
    expect(first?.headers.get('Idempotency-Key')).not.toBe(second?.headers.get('Idempotency-Key'));
  });

  it.each<readonly [string, () => Response, RegExp]>([
    ['403', () => problem(403, 'forbidden'), /Nie masz uprawnień do dodawania wpisów\./],
    ['404', () => problem(404, 'not_found'), /Nie znaleziono zlecenia\./],
    [
      'unknown stage',
      () => problem(400, 'validation_failed', { errors: [{ pointer: '/procedureStageId', code: 'unknown_stage' }] }),
      /Wybrany etap nie należy do tego zlecenia\./,
    ],
    [
      'too_long',
      () => problem(400, 'validation_failed', { errors: [{ pointer: '/body', code: 'too_long' }] }),
      /Treść może mieć najwyżej 10\s000 znaków\./,
    ],
    [
      'invalid_characters',
      () => problem(400, 'validation_failed', { errors: [{ pointer: '/body', code: 'invalid_characters' }] }),
      /niedozwolone znaki/,
    ],
    ['required', () => problem(400, 'validation_failed', { errors: [{ pointer: '/body', code: 'required' }] }), /Wpisz treść wpisu\./],
    ['429', () => problem(429, 'rate_limited', {}, { 'Retry-After': '12' }), /Spróbuj ponownie za 12 s\./],
    ['500', () => problem(500, 'internal_error'), /Nie udało się dodać wpisu\./],
    ['409 in progress', () => problem(409, 'idempotency_in_progress'), /nie dodamy go dwa razy/],
  ])('EVM-037 AC5 the failure %s is told in words, the request is not repeated and the text stays', async (_name, answer, expected) => {
    const api = await openJournal(journalApi({ entries: [], post: () => answer() }));
    await userEvent.type(body(), 'Treść.');
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj wpis' }));
    expect((await screen.findAllByText(expected)).length).toBeGreaterThan(0);
    expect(api.calls(POST)).toHaveLength(1);
    expect((body() as HTMLTextAreaElement).value).toBe('Treść.');
  });
});

describe('W-08 Dziennik: oś czasu i filtry (EVM-037 AC6)', () => {
  /** 60 entries: the first 54 within a day of NOW (today and yesterday), the last six on 2 October. */
  const sixty = Array.from({ length: 60 }, (_unused, index) => {
    const n = index + 1;
    return n <= 54
      ? entry(n * 30, {
          kind: n % 5 === 0 ? 'comment' : 'note',
          noteCategory: n % 5 === 0 ? null : 'arrangement',
          body: `Wpis numer ${String(n)}`,
        })
      : entry(n, { createdAt: new Date(Date.UTC(2026, 9, 2, 8, 0) - n * 60_000).toISOString() });
  });

  it('EVM-037 AC6 25 entries first, grouped by day from the newest, "Pokaż starsze" adds the next pages with the cursor until the end', async () => {
    const api = await openJournal(journalApi({ entries: sixty }));
    await waitFor(() => {
      expect(items()).toHaveLength(25);
    });
    expect(screen.getByRole('heading', { level: 3, name: 'Dziś' })).toBeTruthy();
    expect((items()[0] as HTMLElement).textContent).toContain('Wpis numer 1');
    expect(api.calls(`GET ${TIMELINE}`)[0]?.query.get('cursor')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Pokaż starsze' }));
    await waitFor(() => {
      expect(items()).toHaveLength(50);
    });
    expect(api.calls(`GET ${TIMELINE}`).at(-1)?.query.get('cursor')).toBe('25');
    // the readers keeps the place: the first 25 entries are still where they were
    expect((items()[0] as HTMLElement).textContent).toContain('Wpis numer 1');
    expect(screen.getByRole('heading', { level: 3, name: 'Wczoraj' })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Pokaż starsze' }));
    await waitFor(() => {
      expect(items()).toHaveLength(60);
    });
    expect(screen.queryByRole('button', { name: 'Pokaż starsze' })).toBeNull();
    expect(screen.getByRole('heading', { level: 3, name: '02.10.2026' })).toBeTruthy();
    // the focus did not fall to the page: it is on the first entry that was loaded last
    expect(document.activeElement).toBe(items()[50]);
  });

  it('EVM-037 AC6 the days are the days of Europe/Warsaw: an entry at 22:30 UTC is already the next day', async () => {
    vi.setSystemTime(new Date('2026-10-11T22:30:00.000Z'));
    await openJournal(
      journalApi({
        entries: [
          entry(1, { createdAt: '2026-10-11T22:10:00.000Z', body: 'Po północy w Warszawie.' }),
          entry(2, { createdAt: '2026-10-11T12:00:00.000Z', body: 'Przed północą.' }),
        ],
      }),
    );
    // now is 00:30 on 12 October in Warsaw: the first entry is "dziś, 0:10", the second "wczoraj, 14:00"
    expect(await screen.findByText('dziś, 0:10')).toBeTruthy();
    expect(screen.getByText('wczoraj, 14:00')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Dziś' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Wczoraj' })).toBeTruthy();
  });

  it('EVM-037 AC6 "Wpisy", "Komentarze" and the stage narrow the list in the request; "Wszystko" and "Pokaż wszystko" bring it back', async () => {
    const withStage = entry(3, { procedureStageId: STAGE_ID, procedureStageName: 'Warunki przyłączenia', body: 'Wpis przy etapie' });
    const api = await openJournal(
      journalApi({ entries: [entry(1), entry(2, { kind: 'comment', noteCategory: null, body: 'Komentarz biura' }), withStage] }),
    );
    await waitFor(() => {
      expect(items()).toHaveLength(3);
    });
    await userEvent.click(screen.getByRole('button', { name: 'Komentarze' }));
    await waitFor(() => {
      expect(items()).toHaveLength(1);
    });
    expect(api.calls(`GET ${TIMELINE}`).at(-1)?.query.get('kind')).toBe('comment');
    expect(screen.getByRole('button', { name: 'Komentarze' }).getAttribute('aria-pressed')).toBe('true');

    await userEvent.click(screen.getByRole('button', { name: 'Wpisy' }));
    await waitFor(() => {
      expect(items()).toHaveLength(2);
    });
    expect(api.calls(`GET ${TIMELINE}`).at(-1)?.query.get('kind')).toBe('note');

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Etap' }), STAGE_ID);
    await waitFor(() => {
      expect(items()).toHaveLength(1);
    });
    const last = api.calls(`GET ${TIMELINE}`).at(-1);
    expect(last?.query.get('procedureStageId')).toBe(STAGE_ID);
    expect(last?.query.get('kind')).toBe('note');
    expect(screen.getByText(/Etap: Warunki przyłączenia/)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Komentarze' }));
    expect(await screen.findByText('Brak wpisów tego typu.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Pokaż wszystko' }));
    await waitFor(() => {
      expect(items()).toHaveLength(3);
    });
    expect(api.calls(`GET ${TIMELINE}`).at(-1)?.query.get('kind')).toBeNull();
    expect(api.calls(`GET ${TIMELINE}`).at(-1)?.query.get('procedureStageId')).toBeNull();
  });

  it('EVM-037 AC6 a failed read has "Spróbuj ponownie"; a failed next page keeps the list', async () => {
    let failing = true;
    const list: Handler = (request) => {
      if (failing) return problem(500, 'internal_error');
      return request.query.get('cursor') === null
        ? json(200, { items: [entry(1)], nextCursor: 'next' })
        : json(200, { items: [entry(2, { body: 'Starszy wpis' })], nextCursor: null });
    };
    await openJournal(journalApi({ entries: [], list }));
    expect(await screen.findByText('Nie udało się wczytać dziennika.')).toBeTruthy();
    failing = false;
    await userEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }));
    await screen.findByText('Wpis numer 1');
    failing = true;
    await userEvent.click(screen.getByRole('button', { name: 'Pokaż starsze' }));
    expect(await screen.findByText('Nie udało się wczytać starszych wpisów.')).toBeTruthy();
    expect(screen.getByText('Wpis numer 1')).toBeTruthy();
    failing = false;
    await userEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Spróbuj ponownie' }));
    expect(await screen.findByText('Starszy wpis')).toBeTruthy();
  });

  it('EVM-037 AC6 an expired cursor (400 invalid_cursor) reads the journal again from the first page and says so, instead of repeating the same request', async () => {
    let firstPages = 0;
    const list: Handler = (request) => {
      if (request.query.get('cursor') !== null) return problem(400, 'invalid_cursor');
      firstPages += 1;
      return firstPages === 1
        ? json(200, { items: [entry(1)], nextCursor: 'expired' })
        : json(200, { items: [entry(3, { body: 'Wpis po odświeżeniu' })], nextCursor: null });
    };
    const api = await openJournal(journalApi({ entries: [], list }));
    await screen.findByText('Wpis numer 1');
    await userEvent.click(screen.getByRole('button', { name: 'Pokaż starsze' }));
    expect(await screen.findByText('Wpis po odświeżeniu')).toBeTruthy();
    expect(screen.getByText('Lista się zmieniła — wczytano ją od początku.')).toBeTruthy();
    expect(screen.queryByText('Nie udało się wczytać starszych wpisów.')).toBeNull();
    expect(screen.queryByText('Wpis numer 1')).toBeNull();
    // one request with the expired cursor, then the first page again — no loop
    expect(api.calls(`GET ${TIMELINE}`).filter((call) => call.query.get('cursor') !== null)).toHaveLength(1);
  });
});

describe('W-08 Dziennik: zlecenie zamknięte (EVM-037 AC7)', () => {
  it('EVM-037 AC7 a settled order still takes entries: the field is there and the entry goes out', async () => {
    const api = await openJournal(
      journalApi({
        entries: [],
        header: () => json(200, { ...HEADER, status: 'settled', allowedTransitions: [] }, { ETag: '"3"' }),
      }),
    );
    expect(screen.getByRole('button', { name: 'Dodaj wpis' }).getAttribute('aria-disabled')).toBeNull();
    await userEvent.type(body(), 'Wpis po rozliczeniu.');
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj wpis' }));
    expect(await screen.findByText('Dodano wpis.')).toBeTruthy();
    expect(api.calls(POST)).toHaveLength(1);
  });
});

describe('W-08 Dziennik: uprawnienia i stany (EVM-037 AC8)', () => {
  it('EVM-037 AC8 Edytor adds and corrects like Administrator', async () => {
    await openJournal(journalApi({ entries: [entry(1)], session: roleSession('editor') }));
    expect(screen.getByRole('button', { name: 'Dodaj wpis' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: /^Akcje wpisu/ })).toBeTruthy();
  });

  it('EVM-037 AC8 Tylko odczyt sees the timeline and the filters, without the field and without the menu of an entry', async () => {
    await openJournal(journalApi({ entries: [entry(1)], session: roleSession('read_only') }));
    expect(await screen.findByText('Wpis numer 1')).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Treść' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dodaj wpis' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Akcje wpisu/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Wpisy' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Etap' })).toBeTruthy();
  });

  it('EVM-037 AC8 an empty journal says "Brak wpisów. Dodaj pierwszą notatkę."; Tylko odczyt gets "Brak wpisów."', async () => {
    await openJournal(journalApi({ entries: [] }));
    expect(await screen.findByText('Brak wpisów. Dodaj pierwszą notatkę.')).toBeTruthy();
    document.body.innerHTML = '';
    await openJournal(journalApi({ entries: [], session: roleSession('read_only') }));
    expect(await screen.findByText('Brak wpisów.')).toBeTruthy();
    expect(screen.queryByText(/Dodaj pierwszą notatkę/)).toBeNull();
  });

  it('EVM-037 AC8 offline "Dodaj wpis" is disabled with the reason, the text stays and the entry goes out after the connection returns', async () => {
    const api = await openJournal(journalApi({ entries: [] }));
    await userEvent.type(body(), 'Wpis z korytarza bez zasięgu.');
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      globalThis.dispatchEvent(new Event('offline'));
    });
    const button = await screen.findByRole('button', { name: 'Dodaj wpis' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Dodasz wpis po powrocie połączenia.')).toBeTruthy();
    await userEvent.click(button);
    expect(api.calls(POST)).toHaveLength(0);
    expect((body() as HTMLTextAreaElement).value).toBe('Wpis z korytarza bez zasięgu.');

    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    act(() => {
      globalThis.dispatchEvent(new Event('online'));
    });
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj wpis' }));
    expect(await screen.findByText('Dodano wpis.')).toBeTruthy();
  });

  it('EVM-037 AC8 a text over the limit gets a message with the limit and is not sent', async () => {
    const api = await openJournal(journalApi({ entries: [] }));
    fill('a'.repeat(10_001));
    expect(await screen.findByText(/Treść może mieć najwyżej 10\s000 znaków\./)).toBeTruthy();
    expect(screen.getByText(/10\s001 z 10\s000 znaków/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj wpis' }));
    expect(api.calls(POST)).toHaveLength(0);
    // exactly the limit is fine (an emoji is one character)
    fill('😀'.repeat(10_000));
    expect(screen.queryByText(/Treść może mieć najwyżej/)).toBeNull();
  });

  it('EVM-037 AC8 the draft stays in the memory of the tab when the person looks at "Przegląd", says so, and is never in a store of the browser', async () => {
    await openJournal();
    await userEvent.click(screen.getByRole('radio', { name: 'Komentarz' }));
    await userEvent.type(body(), 'Niedokończona myśl');
    expect(screen.getByText(/Szkic w tej karcie · /)).toBeTruthy();
    await userEvent.click(screen.getByRole('tab', { name: 'Przegląd' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Dziennik' }));
    expect((body() as HTMLTextAreaElement).value).toBe('Niedokończona myśl');
    expect(screen.getByRole('radio', { name: 'Komentarz' }).getAttribute('checked')).not.toBeNull();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.title).not.toContain('Niedokończona');
    expect(globalThis.location.href).not.toContain('Niedokona');
  });

  it('EVM-037 AC5 a lost answer, then leaving the tab and coming back: the retry of the same text sends the same id and key', async () => {
    let attempts = 0;
    const post: Handler = (request) => {
      attempts += 1;
      if (attempts === 1) throw new TypeError('Failed to fetch');
      const sent = parseBody(request.body) as { id: string; body: string };
      return json(201, entry(0, { id: sent.id, body: sent.body }));
    };
    const api = await openJournal(journalApi({ entries: [], post }));
    await userEvent.type(body(), 'Odpowiedź zgubiona po drodze.');
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj wpis' }));
    await waitFor(() => {
      expect(api.calls(POST)).toHaveLength(1);
    });
    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('tab', { name: 'Przegląd' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Dziennik' }));
    expect((body() as HTMLTextAreaElement).value).toBe('Odpowiedź zgubiona po drodze.');
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj wpis' }));
    expect(await screen.findByText('Dodano wpis.')).toBeTruthy();
    const [first, second] = api.calls(POST);
    expect(second?.headers.get('Idempotency-Key')).toBe(first?.headers.get('Idempotency-Key'));
    expect((parseBody(second?.body ?? '{}') as { id: string }).id).toBe((parseBody(first?.body ?? '{}') as { id: string }).id);
  });

  it('EVM-037 AC5 an answer that comes after the tab was left clears the draft and says "Dodano wpis." — the entry is not added twice', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const post: Handler = async (request) => {
      await gate;
      const sent = parseBody(request.body) as { id: string; body: string };
      return json(201, entry(0, { id: sent.id, body: sent.body }));
    };
    const api = await openJournal(journalApi({ entries: [], post }));
    await userEvent.type(body(), 'Wysłane i porzucone.');
    await userEvent.click(screen.getByRole('button', { name: 'Dodaj wpis' }));
    await waitFor(() => {
      expect(api.calls(POST)).toHaveLength(1);
    });
    await userEvent.click(screen.getByRole('tab', { name: 'Przegląd' }));
    release();
    expect(await screen.findByText('Dodano wpis.')).toBeTruthy();
    await userEvent.click(screen.getByRole('tab', { name: 'Dziennik' }));
    expect((body() as HTMLTextAreaElement).value).toBe('');
    expect(screen.queryByText(/Szkic w tej karcie/)).toBeNull();
    expect(api.calls(POST)).toHaveLength(1);
  });

  it('EVM-037 AC8 the journal is not kept in the cache once the tab is left (memory of the tab only)', async () => {
    const api = await openJournal();
    await screen.findByText('Wpis numer 1');
    await userEvent.click(screen.getByRole('tab', { name: 'Przegląd' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Dziennik' }));
    await screen.findByText('Wpis numer 1');
    // gcTime 0: leaving the tab dropped the entries, so the journal was asked for again
    await waitFor(() => {
      expect(api.calls(`GET ${TIMELINE}`).length).toBeGreaterThanOrEqual(2);
    });
  });

  it('EVM-037 AC8 the screen has no accessibility violations and the timeline is a list of days with their entries', async () => {
    await openJournal(journalApi({ entries: [entry(1), entry(2, { kind: 'comment', noteCategory: null })] }));
    await waitFor(() => {
      expect(items()).toHaveLength(2);
    });
    const container = screen.getByRole('main');
    expect(await axeViolations(container)).toEqual([]);
    expect(within(container).getByRole('region', { name: 'Dziś' })).toBeTruthy();
  });
});
