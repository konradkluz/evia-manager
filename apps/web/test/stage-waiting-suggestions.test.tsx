import type { CurrentSession, ProcedureList, ProcedureStage, ProcedureStageTemplate, SiteCard } from '@evia/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import { userEvent } from './user.ts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { todayWarsaw } from '../src/work-orders/transition-actions.ts';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, json, parseBody, problem, SESSION_ROUTE, type Handler, type Recorded } from './api-fake.ts';
import { activeSessionApi, renderPanel } from './render.tsx';
import { HEADER, ORDER_ID, SITE, workOrderRoutes } from './work-order-api.ts';

const PATH = `/work-orders/${ORDER_ID}`;
const BASE = `/api/v1/work-orders/${ORDER_ID}`;
const STAGE_ID = '01968f3e-0000-7000-8000-0000000f0001';
const TRANSITIONS = `POST ${BASE}/procedure-stages/${STAGE_ID}/transitions`;
const PARTY_CREATE = 'POST /api/v1/parties';
const OSD_ID = '01968f3e-0000-7000-8000-00000000c001';
const MANAGER_ID = '01968f3e-0000-7000-8000-00000000c002';
const NAME = 'Warunki przyłączenia i projekt umowy';
const OSD_NAME = 'Stoen Operator';
const MANAGER_NAME = 'Wspólnota Mieszkaniowa „Zielony Dziedziniec”';
const OSD_LINE = `${OSD_NAME} · OSD`;
const MANAGER_LINE = `${MANAGER_NAME} · Wspólnota / spółdzielnia`;
const TODAY = (): string => todayWarsaw(Date.now());

const CARD: SiteCard = {
  ...SITE,
  distributionSystemOperator: { id: OSD_ID, displayName: OSD_NAME },
  manager: { id: MANAGER_ID, displayName: MANAGER_NAME },
};

const MANAGER_PARTY = {
  id: MANAGER_ID,
  kind: 'housing_community',
  legalForm: 'organization',
  displayName: MANAGER_NAME,
  contactPersonName: 'Anna Kontakt',
  phone: '+48500000011',
  notes: 'Notatka testowa.',
  version: 1,
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-01T10:00:00.000Z',
};

const stage = (): ProcedureStage => ({
  id: STAGE_ID,
  code: 'connection_conditions',
  name: NAME,
  position: 1,
  status: 'in_progress',
  dueDate: null,
  overdue: false,
  responsibleUser: null,
  waitingOn: null,
  waitingParty: null,
  waitingSince: null,
  waitingDays: null,
  blockedReason: null,
  startedAt: null,
  completedOn: null,
  version: 1,
});

const templateStage = (extra: Partial<ProcedureStageTemplate> = {}): ProcedureStageTemplate => ({
  code: 'connection_conditions',
  name: NAME,
  position: 1,
  defaultWaitingOn: null,
  defaultWaitingOnPartyKind: null,
  outputDocumentKindCodes: [],
  ...extra,
});

interface Setup {
  readonly card?: SiteCard | (() => SiteCard);
  readonly template?: Partial<ProcedureStageTemplate>;
  readonly manager?: Handler;
  readonly create?: Handler[];
  readonly post?: Handler;
  readonly session?: CurrentSession;
}

function server({ card = CARD, template = {}, manager, create = [], post, session = ACTIVE_SESSION }: Setup = {}) {
  let created = 0;
  const list: ProcedureList = {
    items: [
      {
        id: '01968f3e-0000-7000-8000-0000000a0001',
        code: 'osd',
        name: 'Uzgodnienia z OSD',
        position: 1,
        progress: { done: 0, total: 1 },
        stages: [stage()],
      },
    ],
    openStageCount: 1,
  };
  return activeSessionApi({
    [SESSION_ROUTE]: () => json(200, session),
    ...workOrderRoutes(ORDER_ID, {
      procedures: () => json(200, list),
      header: () => json(200, { ...HEADER, status: 'in_progress' }, { ETag: '"3"' }),
      site: () => json(200, typeof card === 'function' ? card() : card),
    }),
    'GET /api/v1/catalog/procedure-templates': () =>
      json(200, { items: [{ code: 'osd', name: 'Uzgodnienia z OSD', stages: [templateStage(template)] }], nextCursor: null }),
    [`GET /api/v1/parties/${MANAGER_ID}`]: manager ?? (() => json(200, MANAGER_PARTY)),
    'POST /api/v1/parties/search': () => json(200, { items: [], nextCursor: null }),
    [PARTY_CREATE]: async (request) => {
      const handler = create[Math.min(created++, create.length - 1)];
      return handler === undefined ? problem(500, 'internal_error') : handler(request);
    },
    [TRANSITIONS]: post ?? (() => problem(500, 'internal_error')),
  });
}

const body = (request: Recorded | undefined): Record<string, unknown> => parseBody(request?.body ?? '{}') as Record<string, unknown>;

async function openWait(): Promise<HTMLElement> {
  await userEvent.click(await screen.findByRole('button', { name: `Status etapu ${NAME}: W toku. Zmień status` }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Czekamy na…' }));
  return screen.findByRole('dialog', { name: 'Na kogo czekamy?' });
}

/** The party the server created from the request of the panel: the same `id`, the server fills the rest. */
const created: Handler = (request) =>
  json(201, {
    ...body(request),
    version: 1,
    createdAt: '2026-10-12T10:00:00.000Z',
    updatedAt: '2026-10-12T10:00:00.000Z',
  });

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

describe('W-07 suggestions from the location (EVM-033 AC1, AC4, AC5)', () => {
  it('EVM-033 AC1 "Stronę" shows the OSD and the manager with the kind above the search of all the parties', async () => {
    await renderPanel(PATH, server());
    const dialog = await openWait();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Stronę' }));
    const group = await within(dialog).findByRole('group', { name: 'Podpowiedzi z lokalizacji' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((radio) => radio.closest('label')?.textContent)).toEqual([OSD_LINE, MANAGER_LINE]);
    const search = within(dialog).getByRole('combobox', { name: 'Strona' });
    expect(group.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // nothing is chosen on the person's behalf when the template has no default
    expect(radios.every((radio) => !(radio as HTMLInputElement).checked)).toBe(true);
  });

  it('EVM-033 AC1 choosing a suggestion chooses the party and sends its identifier', async () => {
    const saved = {
      ...stage(),
      status: 'waiting',
      waitingOn: 'party',
      waitingParty: { id: MANAGER_ID, displayName: MANAGER_NAME },
      version: 2,
    };
    const api = server({ post: () => json(200, saved, { ETag: '"2"' }) });
    await renderPanel(PATH, api);
    const dialog = await openWait();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Stronę' }));
    await userEvent.click(await within(dialog).findByRole('radio', { name: MANAGER_LINE }));
    expect(within(dialog).getByText(MANAGER_LINE, { selector: 'p' })).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    await waitFor(() => {
      expect(api.calls(TRANSITIONS)).toHaveLength(1);
    });
    expect(body(api.calls(TRANSITIONS)[0])).toEqual({
      to: 'waiting',
      waitingOn: 'party',
      waitingOnPartyId: MANAGER_ID,
      waitingSince: TODAY(),
    });
  });

  it('EVM-033 AC1 the manager is read for its kind only: one read of the party, a non-persisting query', async () => {
    const api = server();
    await renderPanel(PATH, api);
    const dialog = await openWait();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Stronę' }));
    await within(dialog).findByRole('radio', { name: MANAGER_LINE });
    expect(api.calls(`GET /api/v1/parties/${MANAGER_ID}`)).toHaveLength(1);
    // neither the contact nor the notes of the manager reach the window
    expect(within(dialog).queryByText(/Anna Kontakt|500000011|Notatka testowa/)).toBeNull();
    expect(window.localStorage.length + window.sessionStorage.length).toBe(0);
  });

  it('EVM-033 AC4 a location without the OSD and the manager: no section, only the search and "Dodaj stronę"', async () => {
    await renderPanel(PATH, server({ card: { ...CARD, distributionSystemOperator: null, manager: null } }));
    const dialog = await openWait();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Stronę' }));
    expect(within(dialog).getByRole('combobox', { name: 'Strona' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Dodaj stronę: Strona' })).toBeTruthy();
    expect(within(dialog).queryByRole('group', { name: 'Podpowiedzi z lokalizacji' })).toBeNull();
  });

  it('EVM-033 AC5 a manager that was deleted (404 of the party) and an OSD that is gone are not suggested', async () => {
    const api = server({
      card: { ...CARD, distributionSystemOperator: null },
      manager: () => problem(404, 'not_found'),
    });
    await renderPanel(PATH, api);
    const dialog = await openWait();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Stronę' }));
    await waitFor(() => {
      expect(api.calls(`GET /api/v1/parties/${MANAGER_ID}`)).toHaveLength(1);
    });
    expect(within(dialog).queryByRole('group', { name: 'Podpowiedzi z lokalizacji' })).toBeNull();
    expect(within(dialog).queryByText(new RegExp(MANAGER_NAME))).toBeNull();
  });

  it('EVM-033 AC5 sending a party that was deleted meanwhile (400 unknown_party): one message, the choice is cleared, the suggestions are read again', async () => {
    let card = CARD;
    const api = server({
      card: () => card,
      post: () => problem(400, 'validation_failed', { errors: [{ pointer: '/waitingOnPartyId', code: 'unknown_party' }] }),
    });
    await renderPanel(PATH, api);
    const dialog = await openWait();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Stronę' }));
    await userEvent.click(await within(dialog).findByRole('radio', { name: OSD_LINE }));
    card = { ...CARD, distributionSystemOperator: null };
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    expect(await within(dialog).findByText('Ta strona nie jest już dostępna. Wybierz inną stronę.')).toBeTruthy();
    expect(within(dialog).getByRole('combobox', { name: 'Strona' })).toBeTruthy();
    await waitFor(() => {
      expect(within(dialog).queryByRole('radio', { name: OSD_LINE })).toBeNull();
    });
    expect(within(dialog).getByRole('radio', { name: MANAGER_LINE })).toBeTruthy();
  });

  it('EVM-033 AC1 the window with suggestions has no violation of WCAG (axe)', async () => {
    await renderPanel(PATH, server({ template: { defaultWaitingOn: 'party', defaultWaitingOnPartyKind: 'distribution_system_operator' } }));
    const dialog = await openWait();
    await within(dialog).findByRole('radio', { name: MANAGER_LINE });
    expect(await axeViolations(dialog)).toEqual([]);
  });
});

describe('W-07 the default of the stage template (EVM-033 AC2)', () => {
  it('EVM-033 AC2 a stage that waits for an OSD by default opens with "Stronę" and the OSD of the location chosen', async () => {
    await renderPanel(PATH, server({ template: { defaultWaitingOn: 'party', defaultWaitingOnPartyKind: 'distribution_system_operator' } }));
    const dialog = await openWait();
    await waitFor(() => {
      expect(within(dialog).getByRole<HTMLInputElement>('radio', { name: 'Stronę' }).checked).toBe(true);
    });
    expect(await within(dialog).findByRole<HTMLInputElement>('radio', { name: OSD_LINE })).toHaveProperty('checked', true);
    expect(within(dialog).getByText(OSD_LINE, { selector: 'p' })).toBeTruthy();
  });

  it('EVM-033 AC2 the person can choose another party or the customer; the default is not applied again', async () => {
    const saved = { ...stage(), status: 'waiting', waitingOn: 'customer', waitingSince: TODAY(), waitingDays: 0, version: 2 };
    const api = server({
      template: { defaultWaitingOn: 'party', defaultWaitingOnPartyKind: 'distribution_system_operator' },
      post: () => json(200, saved, { ETag: '"2"' }),
    });
    await renderPanel(PATH, api);
    const dialog = await openWait();
    await within(dialog).findByText(OSD_LINE, { selector: 'p' });
    await userEvent.click(within(dialog).getByRole('radio', { name: MANAGER_LINE }));
    expect(within(dialog).getByText(MANAGER_LINE, { selector: 'p' })).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Klienta' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    await waitFor(() => {
      expect(api.calls(TRANSITIONS)).toHaveLength(1);
    });
    expect(body(api.calls(TRANSITIONS)[0])).toEqual({ to: 'waiting', waitingOn: 'customer', waitingSince: TODAY() });
  });

  it('EVM-033 AC2 the default is a hint only: opening the window sends nothing', async () => {
    const api = server({ template: { defaultWaitingOn: 'party', defaultWaitingOnPartyKind: 'distribution_system_operator' } });
    await renderPanel(PATH, api);
    const dialog = await openWait();
    await within(dialog).findByText(OSD_LINE, { selector: 'p' });
    expect(api.calls(TRANSITIONS)).toHaveLength(0);
  });

  it('EVM-033 AC2 a default of the customer chooses "Klienta"', async () => {
    await renderPanel(PATH, server({ template: { defaultWaitingOn: 'customer' } }));
    const dialog = await openWait();
    await waitFor(() => {
      expect(within(dialog).getByRole<HTMLInputElement>('radio', { name: 'Klienta' }).checked).toBe(true);
    });
  });

  it('EVM-033 AC2 a default kind that the location does not have chooses "Stronę" and no party', async () => {
    await renderPanel(PATH, server({ template: { defaultWaitingOn: 'party', defaultWaitingOnPartyKind: 'fire_safety_expert' } }));
    const dialog = await openWait();
    await waitFor(() => {
      expect(within(dialog).getByRole<HTMLInputElement>('radio', { name: 'Stronę' }).checked).toBe(true);
    });
    await within(dialog).findByRole('radio', { name: MANAGER_LINE });
    expect(within(dialog).getByRole('combobox', { name: 'Strona' })).toBeTruthy();
  });
});

describe('W-07 "Dodaj stronę" in the window (EVM-033 AC3, AC6)', () => {
  async function startAdding(api: ReturnType<typeof server>) {
    await renderPanel(PATH, api);
    const dialog = await openWait();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Stronę' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dodaj stronę: Strona' }));
    return screen.findByRole('dialog', { name: 'Na kogo czekamy? › Dodaj stronę' });
  }

  it('EVM-033 AC3 the form replaces the window (one dialog), the kind comes from the template, the notes carry the warning', async () => {
    const adding = await startAdding(server({ template: { defaultWaitingOn: 'party', defaultWaitingOnPartyKind: 'fire_safety_expert' } }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.queryByRole('dialog', { name: 'Na kogo czekamy?' })).toBeNull();
    expect(within(adding).getByRole<HTMLSelectElement>('combobox', { name: 'Rodzaj strony' }).value).toBe('fire_safety_expert');
    const notes = within(adding).getByRole('textbox', { name: 'Notatki (opcjonalnie)' });
    const hintId = notes.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(hintId.split(' ')[0] ?? '')?.textContent).toContain('Nie wpisuj PESEL');
    expect(within(adding).getByRole('button', { name: 'Wróć do pytania o stronę' })).toBeTruthy();
  });

  it('EVM-033 AC3 after the save the window is back with the new party chosen and the typed day kept; the stage is saved with it', async () => {
    const savedStage = { ...stage(), status: 'waiting', waitingOn: 'party', version: 2 };
    const api = server({ create: [created], post: () => json(200, savedStage, { ETag: '"2"' }) });
    await renderPanel(PATH, api);
    const dialog = await openWait();
    const day = '2026-10-01';
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Stronę' }));
    const date = within(dialog).getByLabelText('Od kiedy');
    await userEvent.clear(date);
    await userEvent.type(date, day);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dodaj stronę: Strona' }));
    const adding = await screen.findByRole('dialog', { name: 'Na kogo czekamy? › Dodaj stronę' });
    await userEvent.type(within(adding).getByRole('textbox', { name: 'Nazwa' }), 'Rzeczoznawca Testowy');
    await userEvent.click(within(adding).getByRole('button', { name: 'Dodaj stronę' }));
    const back = await screen.findByRole('dialog', { name: 'Na kogo czekamy?' });
    expect(within(back).getByText(/Rzeczoznawca Testowy · /, { selector: 'p' })).toBeTruthy();
    expect(within(back).getByText(/Dodano stronę „Rzeczoznawca Testowy”/)).toBeTruthy();
    expect(within(back).getByLabelText<HTMLInputElement>('Od kiedy').value).toBe(day);
    await waitFor(() => {
      expect(document.activeElement?.textContent).toMatch(/^Rzeczoznawca Testowy/);
    });
    await userEvent.click(within(back).getByRole('button', { name: 'Zapisz' }));
    await waitFor(() => {
      expect(api.calls(TRANSITIONS)).toHaveLength(1);
    });
    const sent = body(api.calls(TRANSITIONS)[0]);
    expect(sent).toMatchObject({ to: 'waiting', waitingOn: 'party', waitingSince: day });
    expect(sent.waitingOnPartyId).toBe(body(api.calls(PARTY_CREATE)[0]).id);
  });

  it('EVM-033 AC3 a retry after a lost answer sends the same id and Idempotency-Key, so no duplicate appears', async () => {
    const lost: Handler = () => {
      throw new TypeError('network down');
    };
    const api = server({ create: [lost, created] });
    const adding = await startAdding(api);
    await userEvent.type(within(adding).getByRole('textbox', { name: 'Nazwa' }), 'Rzeczoznawca Testowy');
    await userEvent.click(within(adding).getByRole('button', { name: 'Dodaj stronę' }));
    expect(await within(adding).findByText(/Nie udało się dodać strony/)).toBeTruthy();
    expect(within(adding).getByRole<HTMLInputElement>('textbox', { name: 'Nazwa' }).value).toBe('Rzeczoznawca Testowy');
    await userEvent.click(within(adding).getByRole('button', { name: 'Dodaj stronę' }));
    await screen.findByRole('dialog', { name: 'Na kogo czekamy?' });
    const [first, second] = api.calls(PARTY_CREATE);
    expect(api.calls(PARTY_CREATE)).toHaveLength(2);
    expect(body(second).id).toBe(body(first).id);
    expect(second?.headers.get('Idempotency-Key')).toBe(first?.headers.get('Idempotency-Key'));
    expect(first?.headers.get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('EVM-033 AC3 changed content gets a new key', async () => {
    const lost: Handler = () => {
      throw new TypeError('network down');
    };
    const api = server({ create: [lost, created] });
    const adding = await startAdding(api);
    const name = within(adding).getByRole('textbox', { name: 'Nazwa' });
    await userEvent.type(name, 'Rzeczoznawca Testowy');
    await userEvent.click(within(adding).getByRole('button', { name: 'Dodaj stronę' }));
    await within(adding).findByText(/Nie udało się dodać strony/);
    await userEvent.type(name, ' 2');
    await userEvent.click(within(adding).getByRole('button', { name: 'Dodaj stronę' }));
    await screen.findByRole('dialog', { name: 'Na kogo czekamy?' });
    const [first, second] = api.calls(PARTY_CREATE);
    expect(second?.headers.get('Idempotency-Key')).not.toBe(first?.headers.get('Idempotency-Key'));
  });

  it.each([
    [403, 'forbidden', 'Nie możesz dodawać stron. Poproś administratora o uprawnienia.'],
    [500, 'internal_error', 'Nie udało się dodać strony. Spróbuj ponownie — nie dodamy jej dwa razy.'],
  ] as const)('EVM-033 AC6 a refusal %i is a general message and the typed data stay', async (status, code, text) => {
    const adding = await startAdding(server({ create: [() => problem(status, code)] }));
    await userEvent.type(within(adding).getByRole('textbox', { name: 'Nazwa' }), 'Rzeczoznawca Testowy');
    await userEvent.click(within(adding).getByRole('button', { name: 'Dodaj stronę' }));
    expect((await within(adding).findByRole('alert')).textContent).toContain(text);
    expect(within(adding).getByRole<HTMLInputElement>('textbox', { name: 'Nazwa' }).value).toBe('Rzeczoznawca Testowy');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('EVM-033 AC3 "Wróć do pytania o stronę" returns to the window and the focus to the button that was used', async () => {
    const adding = await startAdding(server());
    await userEvent.click(within(adding).getByRole('button', { name: 'Wróć do pytania o stronę' }));
    const back = await screen.findByRole('dialog', { name: 'Na kogo czekamy?' });
    await waitFor(() => {
      expect(document.activeElement).toBe(within(back).getByRole('button', { name: 'Dodaj stronę: Strona' }));
    });
  });

  it('EVM-033 AC6 offline "Dodaj stronę" is disabled with the reason and what was typed stays', async () => {
    await renderPanel(PATH, server());
    const dialog = await openWait();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Stronę' }));
    const date = within(dialog).getByLabelText('Od kiedy');
    await userEvent.clear(date);
    await userEvent.type(date, '2026-10-01');
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    window.dispatchEvent(new Event('offline'));
    const add = await within(dialog).findByRole('button', { name: 'Dodaj stronę: Strona' });
    await waitFor(() => {
      expect(add.getAttribute('aria-disabled')).toBe('true');
    });
    expect(add.getAttribute('title')).toBe('Stronę dodasz po powrocie połączenia — wpisane dane zostają.');
    await userEvent.click(add);
    expect(screen.queryByRole('dialog', { name: 'Na kogo czekamy? › Dodaj stronę' })).toBeNull();
    expect(within(dialog).getByLabelText<HTMLInputElement>('Od kiedy').value).toBe('2026-10-01');
  });

  it('EVM-033 AC6 Tylko odczyt has no menu of the stage, so no suggestions and no "Dodaj stronę"', async () => {
    const readOnly: CurrentSession = { ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role: 'read_only' } };
    const api = server({ session: readOnly });
    await renderPanel(PATH, api);
    await within(await screen.findByRole('region', { name: /^Procesy i etapy/ })).findByText(NAME);
    expect(screen.queryByRole('button', { name: /Status etapu/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Dodaj stronę/ })).toBeNull();
    expect(api.calls(`GET /api/v1/parties/${MANAGER_ID}`)).toHaveLength(0);
    expect(api.calls('GET /api/v1/catalog/procedure-templates')).toHaveLength(0);
  });

  it('EVM-033 AC6 the form of "Dodaj stronę" has no violation of WCAG (axe)', async () => {
    const adding = await startAdding(server());
    expect(await axeViolations(adding)).toEqual([]);
  });
});
