import type { WorkOrderDetails } from '@evia/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from './user.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetStepUp } from '../src/session/step-up.ts';
import { axeViolations } from './a11y.ts';
import { json, parseBody, problem, type Handler } from './api-fake.ts';
import { renderPanel } from './render.tsx';
import { NOW, roleSession, SURVEY_PATH, SURVEY_URL, surveyApi, surveyOrder } from './site-survey-api.ts';

const TRANSITIONS = `POST ${SURVEY_URL}/transitions`;
const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BANNER = 'Wizja lokalna — brak klienta';
const REJECTED = 'Wizja odrzucona';
/** NOW + 14 days: the deadline of a rejected survey. */
const REMOVAL = '2027-02-13T09:00:00.000Z';

const rejectedOrder = (over: Partial<WorkOrderDetails> = {}): WorkOrderDetails =>
  surveyOrder({
    status: 'cancelled',
    version: 6,
    allowedTransitions: ['on_hold'],
    siteSurvey: { expiresAt: REMOVAL, extensionCount: 0, requesterPhone: '+48600000002' },
    ...over,
  });

const answered =
  (order: WorkOrderDetails): Handler =>
  () =>
    json(200, order, { ETag: `"${String(order.version)}"` });

function stubWebAuthn() {
  const credential = {
    id: 'Y3JlZA',
    rawId: 'Y3JlZA',
    type: 'public-key',
    response: { clientDataJSON: 'Y2xpZW50', authenticatorData: 'YXV0aA', signature: 'c2ln' },
  };
  class Fake {
    static readonly parseRequestOptionsFromJSON = vi.fn((options: object) => ({ ...options, parsed: true }));
    toJSON() {
      return credential;
    }
  }
  vi.stubGlobal('PublicKeyCredential', Fake);
  Object.defineProperty(navigator, 'credentials', { value: { get: vi.fn(() => Promise.resolve(new Fake())) }, configurable: true });
}

beforeEach(() => {
  stubWebAuthn();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'credentials');
  resetStepUp();
});

const rejectDialog = () => screen.getByRole('alertdialog', { name: 'Odrzuć wizję lokalną' });

async function openReject(api: ReturnType<typeof surveyApi>) {
  await renderPanel(SURVEY_PATH, api);
  const banner = await screen.findByRole('region', { name: BANNER });
  await userEvent.click(within(banner).getByRole('button', { name: 'Odrzuć wizję…' }));
  return within(rejectDialog());
}

describe('W-06 site survey: "Odrzuć wizję" (EVM-138 AC5)', () => {
  it('EVM-138 AC5 the dialog warns about 14 days and asks for a reason; without one nothing is sent and the focus goes to the group', async () => {
    const api = surveyApi();
    const box = await openReject(api);
    expect(
      box.getByText(
        'Wizja zostanie trwale usunięta po 14 dniach — razem ze zdjęciami, filmami i wpisami. Przywrócić ją w tym czasie może tylko administrator.',
      ),
    ).toBeTruthy();
    const group = box.getByRole('group', { name: 'Powód' });
    expect(
      within(group)
        .getAllByRole('radio')
        .map((radio) => radio.parentElement?.textContent),
    ).toEqual(['Oferta odrzucona', 'Rezygnacja klienta']);
    // no reason is chosen by default (a conscious decision); the focus starts on the first one
    expect(
      within(group)
        .getAllByRole<HTMLInputElement>('radio')
        .every((radio) => !radio.checked),
    ).toBe(true);
    expect(document.activeElement).toBe(within(group).getAllByRole('radio')[0]);
    await userEvent.click(box.getByRole('button', { name: 'Odrzuć wizję' }));
    expect(box.getByText('Wybierz powód odrzucenia.')).toBeTruthy();
    expect(api.calls(TRANSITIONS)).toHaveLength(0);
  });

  it('EVM-138 AC5 a reason: {to:"cancelled", reasonCode} with If-Match and a key; "Anulowane" with "Odrzucona", the date of the removal, the toast', async () => {
    const api = surveyApi(surveyOrder(), { [TRANSITIONS]: answered(rejectedOrder()) });
    const box = await openReject(api);
    await userEvent.click(box.getByRole('radio', { name: 'Rezygnacja klienta' }));
    await userEvent.click(box.getByRole('button', { name: 'Odrzuć wizję' }));
    const banner = await screen.findByRole('region', { name: REJECTED });
    expect(
      within(banner).getByText('Wizja zostanie trwale usunięta dnia 13.02.2027 (za 14 dni) — razem ze zdjęciami, filmami i wpisami.'),
    ).toBeTruthy();
    const [call] = api.calls(TRANSITIONS);
    expect(parseBody(call?.body ?? '{}')).toEqual({ to: 'cancelled', reasonCode: 'customer_withdrew' });
    expect(call?.headers.get('If-Match')).toBe('"5"');
    expect(call?.headers.get('Idempotency-Key') ?? '').toMatch(UUIDV7);
    expect(screen.getByText('Odrzucono wizję. Zostanie usunięta dnia 13.02.2027.')).toBeTruthy();
    // no "Cofnij": only the Administrator restores, with the step-up
    expect(screen.queryByRole('button', { name: 'Cofnij' })).toBeNull();
    const main = within(screen.getByRole('main'));
    expect(main.getByText('Anulowane')).toBeTruthy();
    expect(main.getByText('Odrzucona')).toBeTruthy();
    expect(main.getAllByText('Wizja lokalna').length).toBeGreaterThan(0);
    // the banner of an open survey and its actions are gone; the focus is on the heading of the banner
    expect(screen.queryByRole('region', { name: BANNER })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Przypisz klienta' })).toBeNull();
    expect(document.activeElement).toBe(within(banner).getByText(REJECTED));
  });

  it('EVM-138 AC5 "Oferta odrzucona" is sent as offer_rejected', async () => {
    const api = surveyApi(surveyOrder(), { [TRANSITIONS]: answered(rejectedOrder()) });
    const box = await openReject(api);
    await userEvent.click(box.getByRole('radio', { name: 'Oferta odrzucona' }));
    await userEvent.click(box.getByRole('button', { name: 'Odrzuć wizję' }));
    await screen.findByRole('region', { name: REJECTED });
    expect(parseBody(api.calls(TRANSITIONS)[0]?.body ?? '{}')).toEqual({ to: 'cancelled', reasonCode: 'offer_rejected' });
  });

  it.each([
    ['412', () => problem(412, 'version_conflict'), 'Tę wizję zmieniono w międzyczasie.'],
    ['409 invalid_state_transition', () => problem(409, 'invalid_state_transition'), 'Tę wizję zmieniono w międzyczasie.'],
    ['403', () => problem(403, 'forbidden'), 'Nie możesz odrzucić wizji. Poproś administratora.'],
    [
      '400 reasonCode',
      () => problem(400, 'validation_failed', { errors: [{ pointer: '/reasonCode', code: 'invalid_value' }] }),
      'Nie przyjęliśmy powodu odrzucenia.',
    ],
    ['429', () => problem(429, 'rate_limited', {}, { 'Retry-After': '20' }), 'Zbyt wiele prób. Spróbuj ponownie za 20 s.'],
    ['500', () => problem(500, 'internal_error'), 'Nie udało się odrzucić wizji. Spróbuj ponownie.'],
  ])('EVM-138 AC5 %s: a message in the dialog, the reason stays', async (_name, answer, text) => {
    const api = surveyApi(surveyOrder(), { [TRANSITIONS]: answer });
    const box = await openReject(api);
    await userEvent.click(box.getByRole('radio', { name: 'Oferta odrzucona' }));
    await userEvent.click(box.getByRole('button', { name: 'Odrzuć wizję' }));
    const alert = await within(rejectDialog()).findByRole('alert');
    expect(alert.textContent).toContain(text);
    expect(within(rejectDialog()).getByRole<HTMLInputElement>('radio', { name: 'Oferta odrzucona' }).checked).toBe(true);
    expect(screen.getByRole('region', { name: BANNER })).toBeTruthy();
  });

  it('EVM-138 AC5 412: "Odśwież zlecenie" reads the order again, the retry carries the new version', async () => {
    let reads = 0;
    const api = surveyApi(surveyOrder(), {
      [TRANSITIONS]: () => problem(412, 'version_conflict'),
      [`GET ${SURVEY_URL}`]: () => {
        reads += 1;
        const version = reads === 1 ? 5 : 6;
        return json(200, surveyOrder({ version }), { ETag: `"${String(version)}"` });
      },
    });
    const box = await openReject(api);
    await userEvent.click(box.getByRole('radio', { name: 'Oferta odrzucona' }));
    await userEvent.click(box.getByRole('button', { name: 'Odrzuć wizję' }));
    await within(rejectDialog()).findByRole('alert');
    await waitFor(() => {
      expect(reads).toBeGreaterThanOrEqual(2);
    });
    api.set(TRANSITIONS, answered(rejectedOrder({ version: 7 })));
    await userEvent.click(within(rejectDialog()).getByRole('button', { name: 'Odrzuć wizję' }));
    await screen.findByRole('region', { name: REJECTED });
    const calls = api.calls(TRANSITIONS);
    expect(calls[0]?.headers.get('If-Match')).toBe('"5"');
    expect(calls[1]?.headers.get('If-Match')).toBe('"6"');
  });

  it('EVM-138 AC5 a lost answer: the retry sends the same Idempotency-Key', async () => {
    const answers: Handler[] = [() => problem(500, 'internal_error'), answered(rejectedOrder())];
    let call = 0;
    const api = surveyApi(surveyOrder(), { [TRANSITIONS]: (request) => answers[call++]?.(request) ?? problem(500, 'x') });
    const box = await openReject(api);
    await userEvent.click(box.getByRole('radio', { name: 'Oferta odrzucona' }));
    await userEvent.click(box.getByRole('button', { name: 'Odrzuć wizję' }));
    await within(rejectDialog()).findByRole('alert');
    await userEvent.click(within(rejectDialog()).getByRole('button', { name: 'Odrzuć wizję' }));
    await screen.findByRole('region', { name: REJECTED });
    const [first, second] = api.calls(TRANSITIONS);
    expect(first?.headers.get('Idempotency-Key')).toBe(second?.headers.get('Idempotency-Key'));
  });

  it('EVM-138 AC5 offline "Odrzuć wizję…" is disabled and says why; Anuluj and Esc send nothing', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const api = surveyApi();
    await renderPanel(SURVEY_PATH, api);
    const banner = await screen.findByRole('region', { name: BANNER });
    expect(within(banner).getByRole('button', { name: 'Odrzuć wizję…' }).getAttribute('aria-disabled')).toBe('true');
    expect(within(banner).getByText('Odrzucisz po powrocie połączenia.')).toBeTruthy();
  });

  it('EVM-138 AC5 "Anuluj" closes the dialog without a request and the focus returns to the button', async () => {
    const api = surveyApi();
    const box = await openReject(api);
    await userEvent.click(box.getByRole('button', { name: 'Anuluj' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(api.calls(TRANSITIONS)).toHaveLength(0);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Odrzuć wizję…' }));
  });

  it('EVM-138 AC5 the dialog has no axe violations', async () => {
    const box = await openReject(surveyApi());
    await userEvent.click(box.getByRole('button', { name: 'Odrzuć wizję' }));
    expect(await axeViolations(rejectDialog())).toEqual([]);
  });
});

describe('W-06 site survey: a rejected survey and "Przywróć wizję…" (EVM-138 AC5)', () => {
  it('EVM-138 AC5 the banner of a rejected survey has one action, the menu of the status has no "Przywróć zlecenie…"', async () => {
    await renderPanel(SURVEY_PATH, surveyApi(rejectedOrder()));
    const banner = await screen.findByRole('region', { name: REJECTED });
    expect(within(banner).getByRole('button', { name: 'Przywróć wizję…' })).toBeTruthy();
    expect(within(banner).queryByRole('button', { name: 'Przypisz klienta' })).toBeNull();
    expect(within(banner).queryByRole('button', { name: 'Odrzuć wizję…' })).toBeNull();
    // the status is a plain badge: there is no menu, so no second way of restoring
    expect(screen.queryByRole('button', { name: /Zmień status/ })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Stan zlecenia' })).toBeNull();
    const main = within(screen.getByRole('main'));
    expect(main.getByText('Anulowane')).toBeTruthy();
    expect(main.getByText('Odrzucona')).toBeTruthy();
  });

  it('EVM-138 AC5 the Administrator restores: the dialog, the step-up once, then {to:"on_hold"} again; the open banner is back', async () => {
    let call = 0;
    const answers: Handler[] = [
      () => problem(403, 'step_up_required'),
      answered(
        surveyOrder({
          status: 'on_hold',
          version: 7,
          allowedTransitions: ['quoting', 'cancelled'],
          siteSurvey: { expiresAt: '2027-04-20T10:00:00.000Z', extensionCount: 0, requesterPhone: '+48600000002' },
        }),
      ),
    ];
    const api = surveyApi(rejectedOrder(), { [TRANSITIONS]: (request) => answers[Math.min(call++, 1)]?.(request) ?? problem(500, 'x') });
    api.set('POST /api/v1/auth/step-up/options', () =>
      json(200, {
        challenge: 'Y2hhbGxlbmdl',
        rpId: 'localhost',
        userVerification: 'required',
        allowCredentials: [{ id: 'Y3JlZA', type: 'public-key' }],
      }),
    );
    api.set('POST /api/v1/auth/step-up', () => json(200, { csrfToken: 'csrf-rotated' }));
    await renderPanel(SURVEY_PATH, api);
    await userEvent.click(await screen.findByRole('button', { name: 'Przywróć wizję…' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Przywrócić wizję?' });
    expect(within(confirm).getByText(/Wizja wróci do statusu „Wstrzymane”/)).toBeTruthy();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Przywróć wizję' }));
    const stepUp = await screen.findByRole('alertdialog', { name: 'Potwierdź tożsamość, aby przywrócić wizję' });
    expect(api.calls(TRANSITIONS)).toHaveLength(1);
    await userEvent.click(within(stepUp).getByRole('button', { name: 'Użyj klucza dostępu' }));
    expect(await screen.findByRole('region', { name: BANNER })).toBeTruthy();
    expect(api.calls(TRANSITIONS)).toHaveLength(2);
    expect(parseBody(api.calls(TRANSITIONS)[1]?.body ?? '{}')).toEqual({ to: 'on_hold' });
    expect(api.calls(TRANSITIONS)[1]?.headers.get('If-Match')).toBe('"6"');
    expect(screen.getByText('Przywrócono wizję. Termin usunięcia: 20.04.2027.')).toBeTruthy();
  });

  it('EVM-138 AC5 the Editor sees "Przywróć wizję…" disabled with "Przywrócić wizję może tylko administrator." and it sends nothing', async () => {
    const api = surveyApi(rejectedOrder({ allowedTransitions: [] }), {}, roleSession('editor'));
    await renderPanel(SURVEY_PATH, api);
    const banner = await screen.findByRole('region', { name: REJECTED });
    const button = within(banner).getByRole('button', { name: 'Przywróć wizję…' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-describedby')).not.toBeNull();
    expect(within(banner).getByText('Przywrócić wizję może tylko administrator.')).toBeTruthy();
    button.focus();
    expect(document.activeElement).toBe(button);
    await userEvent.click(button);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(api.calls(TRANSITIONS)).toHaveLength(0);
  });

  it('EVM-138 AC5 the restore refused (403 forbidden, 412): a message in the dialog', async () => {
    const api = surveyApi(rejectedOrder(), { [TRANSITIONS]: () => problem(403, 'forbidden') });
    await renderPanel(SURVEY_PATH, api);
    await userEvent.click(await screen.findByRole('button', { name: 'Przywróć wizję…' }));
    await userEvent.click(
      within(await screen.findByRole('alertdialog', { name: 'Przywrócić wizję?' })).getByRole('button', { name: 'Przywróć wizję' }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Nie możesz przywrócić wizji. Poproś administratora.');
    api.set(TRANSITIONS, () => problem(412, 'version_conflict'));
    await userEvent.click(
      within(screen.getByRole('alertdialog', { name: 'Przywrócić wizję?' })).getByRole('button', { name: 'Przywróć wizję' }),
    );
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('Tę wizję zmieniono w międzyczasie.');
    });
  });

  it('EVM-138 AC5 the dialog of the restore has no axe violations', async () => {
    await renderPanel(SURVEY_PATH, surveyApi(rejectedOrder()));
    await userEvent.click(await screen.findByRole('button', { name: 'Przywróć wizję…' }));
    expect(await axeViolations(await screen.findByRole('alertdialog', { name: 'Przywrócić wizję?' }))).toEqual([]);
  });
});
