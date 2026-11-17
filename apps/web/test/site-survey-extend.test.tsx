import type { WorkOrderDetails } from '@evia/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from './a11y.ts';
import { json, parseBody, problem, type Handler } from './api-fake.ts';
import { renderPanel } from './render.tsx';
import { NOW, roleSession, SURVEY_PATH, SURVEY_URL, surveyApi, surveyOrder } from './site-survey-api.ts';
import { userEvent } from './user.ts';

// EVM-140 AC6: "Przedłuż o 90 dni" on the details of a site survey (W-06).
const EXTEND = `POST ${SURVEY_URL}/site-survey/extensions`;
const HEADER_READ = `GET ${SURVEY_URL}`;
const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BANNER = 'Wizja lokalna — brak klienta';
const TITLE = 'Przedłuż wizję o 90 dni';
const FIRST_DEADLINE = '2027-04-20T10:00:00.000Z';
const SECOND_DEADLINE = '2027-07-19T10:00:00.000Z';
const THIRD_DEADLINE = '2027-10-17T10:00:00.000Z';

const survey = (extensionCount: number, expiresAt = FIRST_DEADLINE, version = 5): WorkOrderDetails =>
  surveyOrder({ version, siteSurvey: { expiresAt, extensionCount, requesterPhone: '+48600000002' } });

const answered =
  (order: WorkOrderDetails): Handler =>
  () =>
    json(200, order, { ETag: `"${String(order.version)}"` });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});
afterEach(() => {
  vi.useRealTimers();
});

const dialog = () => screen.getByRole('alertdialog', { name: TITLE });
const bannerOf = () => screen.findByRole('region', { name: BANNER });

async function openExtend(api: ReturnType<typeof surveyApi>) {
  await renderPanel(SURVEY_PATH, api);
  const banner = await bannerOf();
  await userEvent.click(within(banner).getByRole('button', { name: 'Przedłuż o 90 dni' }));
  return within(await screen.findByRole('alertdialog', { name: TITLE }));
}

describe('W-06 site survey: "Przedłuż o 90 dni" (EVM-140 AC6)', () => {
  it.each([
    ['Administrator', undefined],
    ['Edytor', roleSession('editor')],
  ] as const)('EVM-140 AC6 %s sees the action between "Przypisz klienta" and "Odrzuć wizję…"', async (_role, session) => {
    await renderPanel(SURVEY_PATH, session === undefined ? surveyApi() : surveyApi(survey(0), {}, session));
    const banner = await bannerOf();
    expect(
      within(banner)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Przypisz klienta', 'Przedłuż o 90 dni', 'Odrzuć wizję…']);
    expect(within(banner).getByRole('button', { name: 'Przedłuż o 90 dni' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('EVM-140 AC6 counter 0: the dialog names the dates, offers three reasons without a default and puts the focus on the first', async () => {
    const box = await openExtend(surveyApi());
    expect(box.getByText('Termin usunięcia zmieni się z 20.04.2027 na 19.07.2027.')).toBeTruthy();
    expect(box.getByText('To przedłużenie 1 z 2 — po drugim nie przedłużysz wizji ponownie.')).toBeTruthy();
    const group = box.getByRole('group', { name: 'Powód przedłużenia' });
    const radios = within(group).getAllByRole<HTMLInputElement>('radio');
    expect(radios.map((radio) => radio.parentElement?.textContent)).toEqual([
      'Czeka na decyzję klienta',
      'Czeka na uchwałę wspólnoty lub zarządcy',
      'Wymaga drugiej wizyty',
    ]);
    expect(radios.every((radio) => !radio.checked)).toBe(true);
    expect(document.activeElement).toBe(radios[0]);
  });

  it('EVM-140 AC6 without a reason nothing is sent: "Wybierz powód przedłużenia." and the focus goes to the group', async () => {
    const api = surveyApi();
    const box = await openExtend(api);
    await userEvent.click(box.getByRole('button', { name: 'Przedłuż o 90 dni' }));
    expect(box.getByText('Wybierz powód przedłużenia.')).toBeTruthy();
    expect(api.calls(EXTEND)).toHaveLength(0);
    expect(document.activeElement).toBe(box.getAllByRole('radio')[0]);
  });

  it('EVM-140 AC6 counter 0 -> 1: {reason, version} with a key; the banner has the new date and "Przedłużono 1 z 2 razy", the toast, the focus on the title', async () => {
    const api = surveyApi(survey(0), { [EXTEND]: answered(survey(1, SECOND_DEADLINE, 6)) });
    const box = await openExtend(api);
    await userEvent.click(box.getByRole('radio', { name: 'Czeka na uchwałę wspólnoty lub zarządcy' }));
    await userEvent.click(box.getByRole('button', { name: 'Przedłuż o 90 dni' }));
    const banner = await bannerOf();
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(within(banner).getByText(/Wizja zostanie trwale usunięta dnia 19\.07\.2027 \(za 170 dni\)/)).toBeTruthy();
    expect(within(banner).getByText(/Przedłużono 1 z 2 razy\./)).toBeTruthy();
    expect(screen.getByText('Przedłużono wizję do 19.07.2027.')).toBeTruthy();
    const [call] = api.calls(EXTEND);
    expect(parseBody(call?.body ?? '{}')).toEqual({ reason: 'awaiting_community_decision', version: 5 });
    expect(call?.headers.get('Idempotency-Key') ?? '').toMatch(UUIDV7);
    expect(document.activeElement).toBe(within(banner).getByText(BANNER));
    // the action is still there: one more extension is possible
    expect(within(banner).getByRole('button', { name: 'Przedłuż o 90 dni' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('EVM-140 AC6 counter 1: the dialog says it is the last extension; after it the action is disabled with the hint', async () => {
    const api = surveyApi(survey(1, SECOND_DEADLINE, 6), { [EXTEND]: answered(survey(2, THIRD_DEADLINE, 7)) });
    const box = await openExtend(api);
    expect(box.getByText('Termin usunięcia zmieni się z 19.07.2027 na 17.10.2027.')).toBeTruthy();
    expect(box.getByText('To ostatnie przedłużenie — potem zostaje przypisanie klienta albo odrzucenie wizji.')).toBeTruthy();
    await userEvent.click(box.getByRole('radio', { name: 'Wymaga drugiej wizyty' }));
    await userEvent.click(box.getByRole('button', { name: 'Przedłuż o 90 dni' }));
    const banner = await bannerOf();
    await waitFor(() => {
      expect(within(banner).getByText(/Przedłużono 2 z 2 razy\./)).toBeTruthy();
    });
    expect(parseBody(api.calls(EXTEND)[0]?.body ?? '{}')).toEqual({ reason: 'second_visit_needed', version: 6 });
    const button = within(banner).getByRole('button', { name: 'Przedłuż o 90 dni' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(within(banner).getByText('Przypisz klienta albo odrzuć wizję.')).toBeTruthy();
  });

  it('EVM-140 AC6 counter 2: the action is disabled but focusable, named and described by the hint; it opens nothing', async () => {
    const api = surveyApi(survey(2, THIRD_DEADLINE, 7));
    await renderPanel(SURVEY_PATH, api);
    const banner = await bannerOf();
    const button = within(banner).getByRole('button', { name: 'Przedłuż o 90 dni' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    const hint = within(banner).getByText('Przypisz klienta albo odrzuć wizję.');
    expect(button.getAttribute('aria-describedby')).toBe(hint.id);
    button.focus();
    expect(document.activeElement).toBe(button);
    await userEvent.click(button);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.calls(EXTEND)).toHaveLength(0);
    // the other two actions still work
    expect(within(banner).getByRole('button', { name: 'Przypisz klienta' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('EVM-140 AC6 offline the action is disabled and says "Przedłużysz po powrocie połączenia."', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    await renderPanel(SURVEY_PATH, surveyApi());
    const banner = await bannerOf();
    expect(within(banner).getByRole('button', { name: 'Przedłuż o 90 dni' }).getAttribute('aria-disabled')).toBe('true');
    expect(within(banner).getByText('Przedłużysz po powrocie połączenia.')).toBeTruthy();
  });

  it('EVM-140 AC6 a rejected survey has no extension (it is restored, not extended)', async () => {
    const rejected = surveyOrder({ status: 'cancelled', allowedTransitions: ['on_hold'] });
    await renderPanel(SURVEY_PATH, surveyApi(rejected));
    const banner = await screen.findByRole('region', { name: 'Wizja odrzucona' });
    expect(within(banner).queryByRole('button', { name: /Przedłuż/ })).toBeNull();
  });

  it.each([
    ['412', () => problem(412, 'version_conflict'), 'Tę wizję zmieniono w międzyczasie.'],
    [
      '409 extension_limit_reached',
      () => problem(409, 'extension_limit_reached'),
      'Ta wizja była już dwukrotnie przedłużona. Przypisz klienta albo odrzuć wizję.',
    ],
    ['409 invalid_state_transition', () => problem(409, 'invalid_state_transition'), 'Tej wizji nie można już przedłużyć. Odśwież stronę.'],
    ['403', () => problem(403, 'forbidden'), 'Nie możesz przedłużyć wizji. Poproś administratora.'],
    ['400', () => problem(400, 'validation_failed'), 'Nie udało się przedłużyć wizji. Spróbuj ponownie.'],
    ['429', () => problem(429, 'rate_limited', {}, { 'Retry-After': '20' }), 'Zbyt wiele prób. Spróbuj ponownie za 20 s.'],
    ['500', () => problem(500, 'internal_error'), 'Nie udało się przedłużyć wizji. Spróbuj ponownie.'],
  ])('EVM-140 AC6 %s: a message in the dialog, the reason stays', async (_name, answer, text) => {
    const api = surveyApi(survey(0), { [EXTEND]: answer });
    const box = await openExtend(api);
    await userEvent.click(box.getByRole('radio', { name: 'Czeka na decyzję klienta' }));
    await userEvent.click(box.getByRole('button', { name: 'Przedłuż o 90 dni' }));
    const alert = await within(dialog()).findByRole('alert');
    expect(alert.textContent).toContain(text);
    expect(within(dialog()).getByRole<HTMLInputElement>('radio', { name: 'Czeka na decyzję klienta' }).checked).toBe(true);
    expect(screen.getByRole('region', { name: BANNER, hidden: true })).toBeTruthy();
  });

  it.each([
    ['412', () => problem(412, 'version_conflict')],
    ['409 extension_limit_reached', () => problem(409, 'extension_limit_reached')],
    ['409 invalid_state_transition', () => problem(409, 'invalid_state_transition')],
  ])('EVM-140 AC6 %s refreshes the header of the order', async (_name, answer) => {
    let reads = 0;
    const api = surveyApi(survey(0), {
      [EXTEND]: answer,
      [HEADER_READ]: () => {
        reads += 1;
        return json(200, survey(reads === 1 ? 0 : 2, THIRD_DEADLINE, reads === 1 ? 5 : 8), { ETag: '"5"' });
      },
    });
    const box = await openExtend(api);
    await userEvent.click(box.getByRole('radio', { name: 'Czeka na decyzję klienta' }));
    await userEvent.click(box.getByRole('button', { name: 'Przedłuż o 90 dni' }));
    await within(dialog()).findByRole('alert');
    await waitFor(() => {
      expect(reads).toBeGreaterThanOrEqual(2);
    });
    // the banner behind the dialog shows the fresh counter
    await waitFor(() => {
      expect(within(screen.getByRole('region', { name: BANNER, hidden: true })).getByText(/Przedłużono 2 z 2 razy\./)).toBeTruthy();
    });
  });

  it('EVM-140 AC6 412: "Odśwież zlecenie", then the retry carries the new version and a new key', async () => {
    let reads = 0;
    const api = surveyApi(survey(0), {
      [EXTEND]: () => problem(412, 'version_conflict'),
      [HEADER_READ]: () => {
        reads += 1;
        const version = reads === 1 ? 5 : 6;
        return json(200, survey(0, FIRST_DEADLINE, version), { ETag: `"${String(version)}"` });
      },
    });
    const box = await openExtend(api);
    await userEvent.click(box.getByRole('radio', { name: 'Czeka na decyzję klienta' }));
    await userEvent.click(box.getByRole('button', { name: 'Przedłuż o 90 dni' }));
    await within(dialog()).findByRole('button', { name: 'Odśwież zlecenie' });
    await waitFor(() => {
      expect(reads).toBeGreaterThanOrEqual(2);
    });
    api.set(EXTEND, answered(survey(1, SECOND_DEADLINE, 7)));
    await userEvent.click(within(dialog()).getByRole('button', { name: 'Przedłuż o 90 dni' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    const [first, second] = api.calls(EXTEND);
    expect(parseBody(first?.body ?? '{}')).toMatchObject({ version: 5 });
    expect(parseBody(second?.body ?? '{}')).toMatchObject({ version: 6 });
    expect(second?.headers.get('Idempotency-Key')).not.toBe(first?.headers.get('Idempotency-Key'));
  });

  it('EVM-140 AC6 404: the order is gone — the dialog closes and the header is read again', async () => {
    let reads = 0;
    const api = surveyApi(survey(0), {
      [EXTEND]: () => problem(404, 'not_found'),
      [HEADER_READ]: () => {
        reads += 1;
        return reads === 1 ? json(200, survey(0), { ETag: '"5"' }) : problem(404, 'not_found');
      },
    });
    const box = await openExtend(api);
    await userEvent.click(box.getByRole('radio', { name: 'Czeka na decyzję klienta' }));
    await userEvent.click(box.getByRole('button', { name: 'Przedłuż o 90 dni' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    await waitFor(() => {
      expect(reads).toBeGreaterThanOrEqual(2);
    });
  });

  it('EVM-140 AC6 a lost answer: "Spróbuj ponownie" sends the same Idempotency-Key and finishes the extension', async () => {
    const answers: Handler[] = [() => problem(500, 'internal_error'), answered(survey(1, SECOND_DEADLINE, 6))];
    let call = 0;
    const api = surveyApi(survey(0), { [EXTEND]: (request) => answers[call++]?.(request) ?? problem(500, 'x') });
    const box = await openExtend(api);
    await userEvent.click(box.getByRole('radio', { name: 'Wymaga drugiej wizyty' }));
    await userEvent.click(box.getByRole('button', { name: 'Przedłuż o 90 dni' }));
    await userEvent.click(await within(dialog()).findByRole('button', { name: 'Spróbuj ponownie' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    const [first, second] = api.calls(EXTEND);
    expect(first?.headers.get('Idempotency-Key')).toBe(second?.headers.get('Idempotency-Key'));
    expect(screen.getByText('Przedłużono wizję do 19.07.2027.')).toBeTruthy();
  });

  it('EVM-140 AC6 keyboard: arrows change the reason, Esc closes without a request and the focus returns to the button', async () => {
    const api = surveyApi();
    const box = await openExtend(api);
    const radios = box.getAllByRole<HTMLInputElement>('radio');
    expect(document.activeElement).toBe(radios[0]);
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(radios[1]);
    expect(radios[1]?.checked).toBe(true);
    // jsdom does not turn Esc into the `cancel` of a <dialog>; the real key is in the Playwright specification
    fireEvent(dialog(), new Event('cancel', { cancelable: true }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(api.calls(EXTEND)).toHaveLength(0);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Przedłuż o 90 dni' }));
  });

  it('EVM-140 AC6 "Anuluj" closes the dialog and the focus returns to the button', async () => {
    const box = await openExtend(surveyApi());
    await userEvent.click(box.getByRole('button', { name: 'Anuluj' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Przedłuż o 90 dni' }));
  });

  it('EVM-140 AC6 the dialog (also with an error) has no axe violations', async () => {
    const api = surveyApi(survey(0), { [EXTEND]: () => problem(409, 'extension_limit_reached') });
    const box = await openExtend(api);
    expect(await axeViolations(dialog())).toEqual([]);
    await userEvent.click(box.getByRole('radio', { name: 'Czeka na decyzję klienta' }));
    await userEvent.click(box.getByRole('button', { name: 'Przedłuż o 90 dni' }));
    await within(dialog()).findByRole('alert');
    expect(await axeViolations(dialog())).toEqual([]);
  });

  it('EVM-140 AC6 the banner with the disabled action has no axe violations', async () => {
    await renderPanel(SURVEY_PATH, surveyApi(survey(2, THIRD_DEADLINE, 7)));
    expect(await axeViolations(await bannerOf())).toEqual([]);
  });
});

describe('W-06 site survey: other failures and edges of "Przedłuż o 90 dni" (EVM-140 AC6)', () => {
  async function submitWith(api: ReturnType<typeof surveyApi>) {
    const box = await openExtend(api);
    await userEvent.click(box.getByRole('radio', { name: 'Czeka na decyzję klienta' }));
    await userEvent.click(box.getByRole('button', { name: 'Przedłuż o 90 dni' }));
    return box;
  }

  it('EVM-140 AC6 429 without Retry-After waits 60 s by default', async () => {
    await submitWith(surveyApi(survey(0), { [EXTEND]: () => problem(429, 'rate_limited') }));
    expect((await within(dialog()).findByRole('alert')).textContent).toContain('Zbyt wiele prób. Spróbuj ponownie za 60 s.');
  });

  it.each(['idempotency_mismatch', 'idempotency_in_progress'])(
    'EVM-140 AC6 409 %s is a retryable failure: the network message with "Spróbuj ponownie"',
    async (code) => {
      await submitWith(surveyApi(survey(0), { [EXTEND]: () => problem(409, code) }));
      const alert = await within(dialog()).findByRole('alert');
      expect(alert.textContent).toContain('Nie udało się przedłużyć wizji. Spróbuj ponownie.');
      expect(within(alert).getByRole('button', { name: 'Spróbuj ponownie' })).toBeTruthy();
    },
  );

  it('EVM-140 AC6 an idempotency_mismatch makes the retry a new attempt with a new key', async () => {
    const answers: Handler[] = [() => problem(409, 'idempotency_mismatch'), answered(survey(1, SECOND_DEADLINE, 6))];
    let call = 0;
    const api = surveyApi(survey(0), { [EXTEND]: (request) => answers[call++]?.(request) ?? problem(500, 'x') });
    await submitWith(api);
    await userEvent.click(await within(dialog()).findByRole('button', { name: 'Spróbuj ponownie' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    const [first, second] = api.calls(EXTEND);
    expect(second?.headers.get('Idempotency-Key')).not.toBe(first?.headers.get('Idempotency-Key'));
  });

  it('EVM-140 AC6 an unknown 4xx names the trace id (8 characters) and offers a retry', async () => {
    await submitWith(surveyApi(survey(0), { [EXTEND]: () => problem(422, 'unexpected') }));
    const alert = await within(dialog()).findByRole('alert');
    expect(alert.textContent).toContain('Nie udało się przedłużyć wizji. Spróbuj ponownie. Kod błędu: abcdef01.');
    expect(within(alert).getByRole('button', { name: 'Spróbuj ponownie' })).toBeTruthy();
  });

  it('EVM-140 AC6 an unknown 4xx without a trace id names its code', async () => {
    await submitWith(surveyApi(survey(0), { [EXTEND]: () => problem(422, 'unexpected', { traceId: undefined }) }));
    expect((await within(dialog()).findByRole('alert')).textContent).toContain('Kod błędu: unexpected.');
  });

  it('EVM-140 AC6 "Odśwież zlecenie" clears the message and reads the header again', async () => {
    let reads = 0;
    const api = surveyApi(survey(0), {
      [EXTEND]: () => problem(412, 'version_conflict'),
      [HEADER_READ]: () => {
        reads += 1;
        return json(200, survey(0), { ETag: '"5"' });
      },
    });
    await submitWith(api);
    const refresh = await within(dialog()).findByRole('button', { name: 'Odśwież zlecenie' });
    await waitFor(() => {
      expect(reads).toBeGreaterThanOrEqual(2);
    });
    const before = reads;
    await userEvent.click(refresh);
    expect(within(dialog()).queryByRole('alert')).toBeNull();
    await waitFor(() => {
      expect(reads).toBeGreaterThan(before);
    });
  });

  it('EVM-140 AC6 an answer without a deadline shows "Przedłużono wizję." without a date', async () => {
    const api = surveyApi(survey(0), { [EXTEND]: answered(surveyOrder({ version: 6, siteSurvey: null })) });
    await submitWith(api);
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(screen.getByText('Przedłużono wizję.')).toBeTruthy();
  });

  it('EVM-140 AC6 going offline with the dialog open puts the hint on the confirm button', async () => {
    const box = await openExtend(surveyApi());
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    fireEvent(globalThis as unknown as Window, new Event('offline'));
    const confirm = await box.findByRole('button', { name: 'Przedłuż o 90 dni' });
    await waitFor(() => {
      expect(confirm.getAttribute('aria-disabled')).toBe('true');
    });
    expect(box.getByText('Przedłużysz po powrocie połączenia.')).toBeTruthy();
  });
});
