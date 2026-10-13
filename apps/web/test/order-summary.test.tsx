import type { Procedure, ProcedureList, ProcedureStage } from '@evia/contracts';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent as userEventDefault } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { OrderSummary, currentStageOf } from '../src/work-orders/order-summary.tsx';
import { createI18n } from '../src/i18n/i18n.ts';
import { I18nextProvider } from 'react-i18next';
import type { UseQueryResult } from '@tanstack/react-query';
import { axeViolations } from './a11y.ts';
import { json, problem, type Handler } from './api-fake.ts';
import { renderPanel, activeSessionApi } from './render.tsx';
import { ORDER_ID, workOrderRoutes } from './work-order-api.ts';

const userEvent = userEventDefault.setup({ delay: null });
const PATH = `/work-orders/${ORDER_ID}`;

const stage = (id: string, extra: Partial<ProcedureStage> = {}): ProcedureStage => ({
  id,
  code: `stage_${id}`,
  name: `Etap ${id}`,
  position: 1,
  status: 'todo',
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
  ...extra,
});

const waiting = (id: string, who: string | null, days: number, extra: Partial<ProcedureStage> = {}): ProcedureStage =>
  stage(id, {
    status: 'waiting',
    waitingOn: who === null ? 'customer' : 'party',
    waitingParty: who === null ? null : { id: `party-${id}`, displayName: who },
    waitingSince: '2026-09-18',
    waitingDays: days,
    ...extra,
  });

function process(index: number, stages: ProcedureStage[], extra: Partial<Procedure> = {}): Procedure {
  return {
    id: `01968f3e-0000-7000-8000-0000000a${String(index).padStart(4, '0')}`,
    code: `process_${String(index)}`,
    name: `Proces ${String(index)}`,
    position: index,
    progress: { done: 0, total: stages.length },
    stages,
    ...extra,
  };
}

/** Nine processes, each with an open first stage (the scenario C of the story). */
function nineProcesses(): ProcedureList {
  const items = Array.from({ length: 9 }, (_unused, index) =>
    process(index + 1, [stage(`${String(index + 1)}a`, { name: `Pierwszy etap ${String(index + 1)}`, status: 'in_progress' })], {
      currentStageId: `${String(index + 1)}a`,
    }),
  );
  return { items, openStageCount: 9 };
}

function summaryApi(procedures: Handler) {
  return activeSessionApi({ ...workOrderRoutes(ORDER_ID, { procedures }) });
}

const card = async () => within(await screen.findByRole('region', { name: /^Podsumowanie/ }));
const tile = async (name: string) => within((await card()).getByRole('region', { name }));

describe('W-06 card "Podsumowanie" (EVM-034 AC5)', () => {
  it('EVM-034 AC5 nine processes: the current stage of three of them and "+ 6 procesów"', async () => {
    await renderPanel(
      PATH,
      summaryApi(() => json(200, nineProcesses())),
    );
    const stages = await tile('Na jakim etapie');
    expect(await stages.findByText('Pierwszy etap 1')).toBeTruthy();
    expect(stages.getAllByRole('listitem')).toHaveLength(3);
    expect(stages.getByText('Pierwszy etap 3')).toBeTruthy();
    expect(stages.queryByText('Pierwszy etap 4')).toBeNull();
    expect(stages.getByText('Proces 2')).toBeTruthy();
    expect(stages.getAllByText('W toku')).toHaveLength(3);
    expect(stages.getByRole('button', { name: '+ 6 procesów' })).toBeTruthy();
  });

  it('EVM-034 AC5 "+ 6 procesów" opens the section of the processes and moves the focus there', async () => {
    await renderPanel(
      PATH,
      summaryApi(() => json(200, nineProcesses())),
    );
    const stages = await tile('Na jakim etapie');
    await userEvent.click(await stages.findByRole('button', { name: '+ 6 procesów' }));
    const heading = await screen.findByRole('heading', { level: 2, name: 'Procesy i etapy (9)' });
    await waitFor(() => {
      expect(document.activeElement).toBe(heading);
    });
  });

  it('EVM-034 AC5 the tile "Na kogo czekamy" lists every wait, the longest first, with the warning above 14 days and no empty rows', async () => {
    const procedures: ProcedureList = {
      items: [
        process(1, [waiting('w1', 'Wspólnota Testowa', 3), stage('t1', { status: 'in_progress' })], { currentStageId: 'w1' }),
        process(2, [waiting('w2', 'Operator Testowy', 15)], { currentStageId: 'w2' }),
        process(3, [waiting('w3', null, 14)], { currentStageId: 'w3' }),
      ],
      openStageCount: 4,
    };
    await renderPanel(
      PATH,
      summaryApi(() => json(200, procedures)),
    );
    const waits = await tile('Na kogo czekamy');
    const rows = await waits.findAllByRole('listitem');
    expect(rows.map((entry) => entry.textContent)).toEqual([
      'Czekamy na: Operator Testowy · od 15 dniCzekamy dłużej niż 14 dni.',
      'Czekamy na: klient · od 14 dni',
      'Czekamy na: Wspólnota Testowa · od 3 dni',
    ]);
    expect(rows[0]?.querySelector('svg')).not.toBeNull();
    expect(rows[1]?.querySelector('svg')).toBeNull();
    expect(waits.queryByText(/klient: —/)).toBeNull();
  });

  it('EVM-034 AC5 nobody to wait for: "Piłka po naszej stronie — nie czekamy na nikogo."', async () => {
    await renderPanel(
      PATH,
      summaryApi(() => json(200, nineProcesses())),
    );
    const waits = await tile('Na kogo czekamy');
    expect(await waits.findByText('Piłka po naszej stronie — nie czekamy na nikogo.')).toBeTruthy();
    expect(waits.queryByRole('list')).toBeNull();
  });

  it('EVM-034 AC5 the tile "Terminy": the nearest due date of an open stage and the stages after their date, with alarm-clock', async () => {
    const procedures: ProcedureList = {
      items: [
        process(
          1,
          [
            stage('d1', { name: 'Wniosek do OSD', status: 'in_progress', dueDate: '2026-09-30', overdue: true }),
            stage('d2', { name: 'Zgoda administracji', dueDate: '2026-10-20' }),
            stage('d3', { name: 'Projekt', dueDate: '2026-11-05' }),
            stage('d4', { name: 'Ukończony etap', status: 'done', dueDate: '2026-09-01', overdue: false }),
          ],
          { currentStageId: 'd1' },
        ),
      ],
      openStageCount: 3,
    };
    await renderPanel(
      PATH,
      summaryApi(() => json(200, procedures)),
    );
    const due = await tile('Terminy');
    expect(await due.findByText('Najbliższy: 20.10.2026 — Zgoda administracji')).toBeTruthy();
    expect(due.getByText('Po terminie:')).toBeTruthy();
    const overdue = due.getByText('Wniosek do OSD — 30.09.2026');
    expect(overdue.closest('li')?.querySelector('svg')).not.toBeNull();
    expect(due.queryByText(/Ukończony etap/)).toBeNull();
  });

  it('EVM-034 AC5 no due dates and nothing overdue: "Najbliższy: brak" and "Po terminie: brak"', async () => {
    await renderPanel(
      PATH,
      summaryApi(() => json(200, nineProcesses())),
    );
    const due = await tile('Terminy');
    expect(await due.findByText('Najbliższy: brak')).toBeTruthy();
    expect(due.getByText('Po terminie: brak')).toBeTruthy();
  });

  it('EVM-034 AC5 an order without processes and one with every stage finished say so', async () => {
    await renderPanel(
      PATH,
      summaryApi(() => json(200, { items: [], openStageCount: 0 })),
    );
    expect(await (await tile('Na jakim etapie')).findByText('Zlecenie nie ma jeszcze procesów.')).toBeTruthy();
  });

  it('EVM-034 AC5 a process with every stage finished has no current stage; with all of them: "Wszystkie zakończone"', async () => {
    const done = process(1, [stage('x1', { status: 'done' })], { currentStageId: null });
    await renderPanel(
      PATH,
      summaryApi(() => json(200, { items: [done], openStageCount: 0 })),
    );
    expect(await (await tile('Na jakim etapie')).findByText('Wszystkie zakończone')).toBeTruthy();
  });

  it('EVM-034 AC5 the current stage comes from currentStageId; an older server without it is read by the same rule', () => {
    const first = stage('s1', { status: 'done' });
    const second = stage('s2', { status: 'in_progress' });
    const third = stage('s3', { status: 'todo' });
    expect(currentStageOf(process(1, [first, second, third], { currentStageId: 's3' }))?.id).toBe('s3');
    expect(currentStageOf(process(1, [first, second, third]))?.id).toBe('s2');
    expect(currentStageOf(process(1, [first, second, third], { currentStageId: null }))).toBeUndefined();
    expect(currentStageOf(process(1, [first, second, third], { currentStageId: 'unknown' }))).toBeUndefined();
  });

  it('EVM-034 AC5 a stage status this panel does not know is the badge of an unknown value, never the raw code', async () => {
    const odd = process(1, [stage('u1', { status: 'future_status' as ProcedureStage['status'] })], { currentStageId: 'u1' });
    await renderPanel(
      PATH,
      summaryApi(() => json(200, { items: [odd], openStageCount: 1 })),
    );
    const stages = await tile('Na jakim etapie');
    expect(await stages.findByText('Nieznany status')).toBeTruthy();
    expect(document.body.textContent).not.toContain('future_status');
  });

  it('EVM-034 AC5 names are shown as text, never as markup (SR-WEB-03)', async () => {
    const markup = '<img src=x onerror=alert(1)>';
    const odd = process(1, [waiting('m1', markup, 20, { name: markup })], { name: markup, currentStageId: 'm1' });
    await renderPanel(
      PATH,
      summaryApi(() => json(200, { items: [odd], openStageCount: 1 })),
    );
    const card1 = await card();
    expect(await card1.findAllByText(markup, { exact: false })).not.toHaveLength(0);
    expect(document.querySelector('img')).toBeNull();
  });
});

describe('W-06 card "Podsumowanie" — states (EVM-034 AC8)', () => {
  it('EVM-034 AC8 while the processes load every tile has a skeleton with a text status; the card passes axe', async () => {
    let release: (response: Response) => void = () => undefined;
    await renderPanel(
      PATH,
      summaryApi(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      ),
    );
    const stages = await tile('Na jakim etapie');
    expect(stages.getByRole('status').textContent).toBe('Wczytujemy sekcję…');
    release(json(200, nineProcesses()));
    await stages.findByText('Pierwszy etap 1');
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-034 AC8 a failed read is an alert in each tile with its own retry; the header and the cards keep working', async () => {
    let fail = true;
    await renderPanel(
      PATH,
      summaryApi(() => (fail ? problem(500, 'internal_error') : json(200, nineProcesses()))),
    );
    const summary = await card();
    expect(await summary.findAllByText('Nie udało się wczytać tego kafla.')).toHaveLength(3);
    expect(screen.getByRole('heading', { level: 1, name: 'ZL-2026-0042' })).toBeTruthy();
    expect(await screen.findByText('Operator Testowy')).toBeTruthy();
    fail = false;
    await userEvent.click((await tile('Na kogo czekamy')).getByRole('button', { name: 'Wczytaj kafel ponownie' }));
    expect(await (await tile('Na jakim etapie')).findByText('Pierwszy etap 1')).toBeTruthy();
    expect(summary.queryByText('Nie udało się wczytać tego kafla.')).toBeNull();
  });

  it('EVM-034 AC5 the card needs no store of the browser', async () => {
    await renderPanel(
      PATH,
      summaryApi(() => json(200, nineProcesses())),
    );
    await (await tile('Na jakim etapie')).findByText('Pierwszy etap 1');
    expect(globalThis.localStorage.length + globalThis.sessionStorage.length).toBe(0);
  });
});

describe('OrderSummary as a component (EVM-034 AC8)', () => {
  it('EVM-034 AC8 a rendering fault of a tile stays in the tile', () => {
    const query = {
      data: { items: [{ id: 'p', name: 'P', stages: null }], openStageCount: 0 },
      isError: false,
      refetch: () => Promise.resolve(),
    } as unknown as UseQueryResult<ProcedureList>;
    const errors = console.error;
    console.error = () => undefined;
    try {
      render(
        <I18nextProvider i18n={createI18n()}>
          <OrderSummary query={query} onShowProcesses={() => undefined} />
        </I18nextProvider>,
      );
    } finally {
      console.error = errors;
    }
    expect(screen.getByRole('heading', { level: 3, name: 'Na jakim etapie' })).toBeTruthy();
    expect(screen.getAllByText('Nie udało się wczytać tego kafla.').length).toBeGreaterThan(0);
  });
});
