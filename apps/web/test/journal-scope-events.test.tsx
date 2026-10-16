import { screen, waitFor } from '@testing-library/react';
import { userEvent } from './user.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json, problem } from './api-fake.ts';
import { NOW, eventEntry, journalApi } from './journal-api.ts';
import { renderPanel } from './render.tsx';
import { ORDER_ID } from './work-order-api.ts';

const PATH = `/work-orders/${ORDER_ID}`;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function openJournal(api: ReturnType<typeof journalApi>) {
  await renderPanel(PATH, api);
  await screen.findByRole('heading', { level: 1, name: 'ZL-2026-0042' });
  await userEvent.click(await screen.findByRole('tab', { name: 'Dziennik' }));
  await screen.findByRole('heading', { level: 2, name: 'Dziennik' });
}

const items = () => screen.queryAllByRole('listitem', { name: /^Zmiana w zleceniu:/ });

const CATALOG = {
  items: [
    {
      code: 'supply_installation',
      name: 'Instalacja zasilająca',
      category: 'installation',
      parameterSetCode: 'supply_circuit',
      procedureTemplateCodes: [],
    },
  ],
  nextCursor: null,
};

const TEMPLATES = {
  items: [
    { code: 'electrical_installation', name: 'Instalacja zasilająca (proces)', stages: [] },
    { code: 'osd', name: 'Uzgodnienia z OSD', stages: [] },
  ],
  nextCursor: null,
};

describe('W-08 Dziennik: zmiany danych i zakresu (EVM-035 AC7)', () => {
  it('EVM-035 AC7 the events of the data and of the scope are told with names of fields and catalogue names only, never values', async () => {
    await openJournal(
      journalApi({
        entries: [
          eventEntry(1, { code: 'work_order_fields_changed', objectType: 'work_order', changedFields: ['title', 'plannedDate'] }),
          eventEntry(2, {
            code: 'scope_item_added',
            objectType: 'scope_item',
            itemCode: 'supply_installation',
            procedureCodes: ['electrical_installation', 'osd'],
          }),
          eventEntry(3, {
            code: 'scope_item_updated',
            objectType: 'scope_item',
            itemCode: 'supply_installation',
            changedFields: ['parameters', 'notes'],
          }),
          eventEntry(4, { code: 'scope_item_removed', objectType: 'scope_item', itemCode: 'supply_installation' }),
          eventEntry(5, { code: 'scope_item_removed', objectType: 'scope_item', itemCode: 'retired_item' }),
          eventEntry(6, { code: 'work_order_fields_changed', objectType: 'work_order', changedFields: ['coordinator', 'description'] }),
        ],
        routes: {
          'GET /api/v1/catalog/service-items': () => json(200, CATALOG),
          'GET /api/v1/catalog/procedure-templates': () => json(200, TEMPLATES),
        },
      }),
    );
    await waitFor(() => {
      expect(items()).toHaveLength(6);
      expect(items()[1]?.textContent).toContain('Dodano pozycję zakresu „Instalacja zasilająca”');
    });
    const text = items().map((item) => item.textContent);
    expect(text[0]).toContain('Zmiana danych zlecenia: tytuł, planowana data');
    expect(text[1]).toContain(
      'Dodano pozycję zakresu „Instalacja zasilająca” i procesy: Instalacja zasilająca (proces), Uzgodnienia z OSD',
    );
    expect(text[2]).toContain('Zmiana parametrów i notatek pozycji zakresu „Instalacja zasilająca”');
    expect(text[3]).toContain('Usunięto pozycję zakresu „Instalacja zasilająca”');
    // an item that left the catalogue is told neutrally — never by its code
    expect(text[4]).toContain('Usunięto pozycję zakresu');
    expect(text[4]).not.toContain('retired_item');
    expect(text[5]).toContain('Zmiana danych zlecenia: opis, opiekun');
  });

  it('EVM-035 AC7 a failure of the catalogue leaves the events readable without names', async () => {
    await openJournal(
      journalApi({
        entries: [
          eventEntry(1, { code: 'scope_item_added', objectType: 'scope_item', itemCode: 'supply_installation', procedureCodes: [] }),
        ],
        routes: { 'GET /api/v1/catalog/service-items': () => problem(500, 'internal_error') },
      }),
    );
    await waitFor(() => {
      expect(items()).toHaveLength(1);
    });
    expect(items()[0]?.textContent).toContain('Dodano pozycję zakresu');
    expect(items()[0]?.textContent).not.toContain('„');
  });
});
