import { screen, waitFor } from '@testing-library/react';
import { userEvent } from './user.ts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { json } from './api-fake.ts';
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

const TEMPLATES = { items: [{ code: 'ppoz', name: 'Opinia ppoż', stages: [] }], nextCursor: null };

describe('W-08 Dziennik: ręczne procesy i etapy (EVM-042 AC5)', () => {
  it('EVM-042 AC5 the six events are told with the name of the process from the catalogue and the current name of the stage, never a value', async () => {
    await renderPanel(
      PATH,
      journalApi({
        entries: [
          eventEntry(1, { code: 'procedure_added', objectType: 'procedure', procedureCodes: ['ppoz'] }),
          eventEntry(2, { code: 'procedure_removed', objectType: 'procedure', procedureCodes: ['ppoz'] }),
          eventEntry(3, { code: 'procedure_restored', objectType: 'procedure', procedureCodes: ['ppoz'] }),
          eventEntry(
            4,
            { code: 'stage_added', objectType: 'procedure_stage', procedureCodes: ['ppoz'] },
            { procedureStageName: 'Korekta wniosku' },
          ),
          eventEntry(
            5,
            { code: 'stage_removed', objectType: 'procedure_stage', procedureCodes: ['ppoz'] },
            { procedureStageName: 'Korekta wniosku' },
          ),
          eventEntry(
            6,
            { code: 'stage_restored', objectType: 'procedure_stage', procedureCodes: ['ppoz'] },
            { procedureStageName: 'Korekta wniosku' },
          ),
          eventEntry(7, { code: 'procedure_added', objectType: 'procedure', procedureCodes: ['retired'] }),
          eventEntry(8, { code: 'stage_added', objectType: 'procedure_stage' }),
        ],
        routes: { 'GET /api/v1/catalog/procedure-templates': () => json(200, TEMPLATES) },
      }),
    );
    await screen.findByRole('heading', { level: 1, name: 'ZL-2026-0042' });
    await userEvent.click(await screen.findByRole('tab', { name: 'Dziennik' }));
    await screen.findByRole('heading', { level: 2, name: 'Dziennik' });
    const items = () => screen.queryAllByRole('listitem', { name: /^Zmiana w zleceniu:/ });
    await waitFor(() => {
      expect(items()).toHaveLength(8);
      expect(items()[0]?.textContent).toContain('Dodano proces „Opinia ppoż”');
    });
    const text = items().map((item) => item.textContent);
    expect(text[1]).toContain('Usunięto proces „Opinia ppoż”');
    expect(text[2]).toContain('Przywrócono proces „Opinia ppoż”');
    expect(text[3]).toContain('Dodano etap „Korekta wniosku”');
    expect(text[4]).toContain('Usunięto etap „Korekta wniosku”');
    expect(text[5]).toContain('Przywrócono etap „Korekta wniosku”');
    // a process that left the catalogue and a stage without a name are told neutrally, never by the code
    expect(text[6]).toContain('Dodano proces');
    expect(text[6]).not.toContain('„');
    expect(text[6]).not.toContain('retired');
    expect(text[7]).toContain('Dodano etap');
    expect(text[7]).not.toContain('„');
  });
});
