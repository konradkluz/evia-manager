import type { MediaAsset } from '@evia/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetStepUp } from '../src/session/step-up.ts';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, json, problem, type Handler } from './api-fake.ts';
import { MEDIA_BASE, asset, mediaApi, type MediaServerOptions } from './media-api.ts';
import { MEDIA_POLL_MS } from '../src/work-orders/use-media.ts';
import { renderPanel } from './render.tsx';
import { userEvent } from './user.ts';
import { ORDER_ID } from './work-order-api.ts';

// W-09 quarantine (EVM-049 AC1, AC3, AC5, AC6, AC8): the tile "Wymaga uwagi", the filter, "Skanuj ponownie" with W-04, the purged tile.
const PATH = `/work-orders/${ORDER_ID}`;
const HELD_ID = '01968f3e-0000-7000-8000-00000c000001';
const RESCAN = `POST ${MEDIA_BASE}/${HELD_ID}/rescan`;
const LIST = `GET ${MEDIA_BASE}`;
const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const STEP_UP_TITLE = 'Potwierdź tożsamość, aby ponownie przeskanować plik';

const held = (extra: Partial<MediaAsset> = {}): MediaAsset =>
  asset(1, {
    id: HELD_ID,
    fileState: 'quarantined',
    needsAttention: true,
    quarantine: { state: 'held', expiresAt: '2026-10-30T23:00:00.000Z', purgedAt: null },
    ...extra,
  });
const purged = asset(2, {
  fileState: 'quarantined',
  needsAttention: false,
  quarantine: { state: 'purged', expiresAt: '2026-10-01T22:00:00.000Z', purgedAt: '2026-10-01T22:05:00.000Z' },
});
const role = (value: 'administrator' | 'editor' | 'read_only') => ({ ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role: value } });
const accepted: Handler = () => json(202, held({ fileState: 'scanning', needsAttention: false, quarantine: null }));

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

async function openMedia(options: MediaServerOptions = {}) {
  const api = mediaApi(options);
  api.set('POST /api/v1/auth/step-up/options', () =>
    json(200, {
      challenge: 'Y2hhbGxlbmdl',
      rpId: 'localhost',
      userVerification: 'required',
      allowCredentials: [{ id: 'Y3JlZA', type: 'public-key' }],
    }),
  );
  api.set('POST /api/v1/auth/step-up', () => json(200, { csrfToken: 'csrf-rotated' }));
  await renderPanel(PATH, api);
  await screen.findByRole('heading', { level: 1, name: 'ZL-2026-0042' });
  await userEvent.click(await screen.findByRole('tab', { name: 'Media i dokumenty' }));
  await screen.findByRole('heading', { level: 2, name: 'Media i dokumenty' });
  return api;
}

beforeEach(() => {
  stubWebAuthn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'credentials');
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  resetStepUp();
});

describe('EVM-049 AC1 the reason of the quarantine only for the Administrator', () => {
  it('EVM-049 AC1 Administrator sees "Wymaga uwagi", the reason in words, the day of the removal and "Skanuj ponownie"', async () => {
    await openMedia({ assets: [held({ quarantineReasonCode: 'malware_detected' })] });
    expect(await screen.findByText('Wymaga uwagi')).toBeTruthy();
    expect(screen.getByText(/Skan wykrył zagrożenie/)).toBeTruthy();
    expect(screen.getByText(/Plik zostanie usunięty 31\.10\.2026/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Skanuj ponownie/ })).toBeTruthy();
  });

  it('EVM-049 AC1 the reason type_mismatch has its own words and an unknown code only the general label (never the raw code)', async () => {
    await openMedia({
      assets: [
        held({ quarantineReasonCode: 'type_mismatch' }),
        asset(3, {
          fileState: 'quarantined',
          needsAttention: true,
          quarantine: { state: 'held', expiresAt: '2026-10-30T23:00:00.000Z', purgedAt: null },
          quarantineReasonCode: 'new_reason' as never,
        }),
      ],
    });
    expect(await screen.findByText(/Typ pliku niezgodny z rozszerzeniem/)).toBeTruthy();
    expect(screen.queryByText(/new_reason/)).toBeNull();
    expect(screen.getAllByText(/Plik zatrzymany przez skan bezpieczeństwa/).length).toBeGreaterThan(0);
  });

  it.each(['editor', 'read_only'] as const)(
    'EVM-049 AC1 %s sees only "Plik zatrzymany przez skan bezpieczeństwa. Administrator został powiadomiony." with no reason and no button',
    async (name) => {
      await openMedia({ session: role(name), assets: [held()] });
      expect(await screen.findByText('Wymaga uwagi')).toBeTruthy();
      expect(screen.getByText('Plik zatrzymany przez skan bezpieczeństwa. Administrator został powiadomiony.')).toBeTruthy();
      expect(screen.queryByRole('button', { name: /Skanuj ponownie/ })).toBeNull();
      expect(screen.queryByText(/zagrożenie|niezgodny z rozszerzeniem/)).toBeNull();
    },
  );
});

describe('EVM-049 AC3 AC8 "Skanuj ponownie"', () => {
  it('EVM-049 AC3 403 step_up_required opens W-04 once and the same request goes again with the same key', async () => {
    const rescan = vi.fn<Handler>();
    rescan.mockImplementationOnce(() => problem(403, 'step_up_required')).mockImplementation(accepted);
    const api = await openMedia({ assets: [held({ quarantineReasonCode: 'malware_detected' })], rescan });
    await userEvent.click(await screen.findByRole('button', { name: /^Skanuj ponownie/ }));
    const stepUp = await screen.findByRole('alertdialog', { name: STEP_UP_TITLE });
    expect(api.calls(RESCAN)).toHaveLength(1);
    await userEvent.click(within(stepUp).getByRole('button', { name: 'Użyj klucza dostępu' }));
    await waitFor(() => {
      expect(api.calls(RESCAN)).toHaveLength(2);
    });
    const [first, second] = api.calls(RESCAN);
    expect(first?.headers.get('Idempotency-Key')).toMatch(UUIDV7);
    expect(second?.headers.get('Idempotency-Key')).toBe(first?.headers.get('Idempotency-Key'));
    expect(second?.headers.get('If-Match')).toBeNull();
  });

  it('EVM-049 AC3 cancelling W-04 sends nothing more; no loop', async () => {
    const api = await openMedia({ assets: [held()], rescan: () => problem(403, 'step_up_required') });
    await userEvent.click(await screen.findByRole('button', { name: /^Skanuj ponownie/ }));
    const stepUp = await screen.findByRole('alertdialog', { name: STEP_UP_TITLE });
    await userEvent.click(within(stepUp).getByRole('button', { name: 'Anuluj' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(api.calls(RESCAN)).toHaveLength(1);
    expect(screen.getByRole('button', { name: /^Skanuj ponownie/ })).toBeTruthy();
  });

  it('EVM-049 AC3 an accepted request reads the list again', async () => {
    const api = await openMedia({ assets: [held()], rescan: accepted });
    const before = api.calls(LIST).length;
    await userEvent.click(await screen.findByRole('button', { name: /^Skanuj ponownie/ }));
    await waitFor(() => {
      expect(api.calls(LIST).length).toBeGreaterThan(before);
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('EVM-049 AC3 a file held and scanned again shows "Sprawdzanie pliku" and "Trwa ponowne skanowanie" with no button for the Administrator', async () => {
    await openMedia({ assets: [held({ fileState: 'scanning', needsAttention: false })] });
    expect(await screen.findByText('Sprawdzanie pliku')).toBeTruthy();
    expect(screen.getByText('Trwa ponowne skanowanie')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Skanuj ponownie/ })).toBeNull();
    expect(screen.queryByText('Wymaga uwagi')).toBeNull();
  });

  it('EVM-049 AC3 a file held and uploaded (not yet scanned) offers no rescan either', async () => {
    await openMedia({ assets: [held({ fileState: 'uploaded' })] });
    expect(await screen.findByText('Sprawdzanie pliku')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Skanuj ponownie/ })).toBeNull();
  });

  it('EVM-049 AC3 an accepted rescan confirms with a status and the list shows the file being scanned again', async () => {
    const api = await openMedia({ assets: [held()], rescan: accepted });
    api.set(LIST, () =>
      json(200, { items: [held({ fileState: 'scanning', needsAttention: false })], nextCursor: null, needsAttentionCount: 0 }),
    );
    await userEvent.click(await screen.findByRole('button', { name: /^Skanuj ponownie/ }));
    const text = await screen.findByText('Plik jest skanowany ponownie');
    expect(text.closest('[role="status"]')).not.toBeNull();
    expect(await screen.findByText('Sprawdzanie pliku')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Skanuj ponownie/ })).toBeNull();
  });

  it('EVM-049 AC3 the list is read again while a file held is scanned', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const api = await openMedia({ assets: [held({ fileState: 'scanning', needsAttention: false })] });
      const before = api.calls(LIST).length;
      await vi.advanceTimersByTimeAsync(MEDIA_POLL_MS + 100);
      expect(api.calls(LIST).length).toBeGreaterThan(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it('EVM-049 AC3 409 invalid_state_transition says the state changed and reads the list again', async () => {
    const api = await openMedia({ assets: [held()], rescan: () => problem(409, 'invalid_state_transition') });
    const before = api.calls(LIST).length;
    await userEvent.click(await screen.findByRole('button', { name: /^Skanuj ponownie/ }));
    expect(await screen.findByText('Stan pliku się zmienił — odświeżyliśmy listę. Ponowny skan nie jest teraz możliwy.')).toBeTruthy();
    await waitFor(() => {
      expect(api.calls(LIST).length).toBeGreaterThan(before);
    });
  });

  it.each([
    [404, 'not_found', 'Nie znaleziono pliku. Mógł zostać usunięty.'],
    [403, 'forbidden', 'Ponowny skan może zlecić tylko administrator.'],
    [0, 'network_error', 'Nie zlecono ponownego skanu. Sprawdź połączenie i spróbuj ponownie.'],
    [500, 'internal_error', 'Nie zlecono ponownego skanu. Spróbuj ponownie za chwilę.'],
  ])('EVM-049 AC3 %i %s is told in words', async (status, code, text) => {
    const rescan: Handler = () => {
      if (status === 0) throw new TypeError('Failed to fetch');
      return problem(status, code);
    };
    await openMedia({ assets: [held()], rescan });
    await userEvent.click(await screen.findByRole('button', { name: /^Skanuj ponownie/ }));
    expect(await screen.findByText(text)).toBeTruthy();
  });

  it('EVM-049 AC3 429 tells when to try again', async () => {
    await openMedia({ assets: [held()], rescan: () => problem(429, 'rate_limited', {}, { 'Retry-After': '30' }) });
    await userEvent.click(await screen.findByRole('button', { name: /^Skanuj ponownie/ }));
    expect(await screen.findByText('Zbyt wiele zapytań. Spróbuj ponownie za 30 s.')).toBeTruthy();
  });

  it('EVM-049 AC8 offline the button is disabled and sends nothing', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const api = await openMedia({ assets: [held()], rescan: accepted });
    const button = await screen.findByRole('button', { name: /^Skanuj ponownie/ });
    expect(button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true').toBe(true);
    await userEvent.click(button);
    expect(api.calls(RESCAN)).toHaveLength(0);
  });
});

describe('EVM-049 AC5 the purged tile', () => {
  it.each(['administrator', 'editor', 'read_only'] as const)(
    'EVM-049 AC5 %s sees "Plik usunięty po 30 dniach kwarantanny" with no action',
    async (name) => {
      await openMedia({ session: role(name), assets: [purged] });
      expect(await screen.findByText('Plik usunięty po 30 dniach kwarantanny')).toBeTruthy();
      expect(screen.queryByRole('button', { name: /Skanuj ponownie/ })).toBeNull();
      expect(screen.queryByText('Wymaga uwagi')).toBeNull();
    },
  );
});

describe('EVM-049 AC6 the filter "Wymaga uwagi (n)"', () => {
  it('EVM-049 AC6 the chip shows the count, selects the files held and "Wszystkie" brings the list back', async () => {
    const api = await openMedia({ assets: [held(), asset(4, { fileState: 'ready' })] });
    const chip = await screen.findByRole('button', { name: 'Wymaga uwagi (1)' });
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(chip);
    await waitFor(() => {
      expect(api.calls(LIST).some((entry) => entry.query.get('needsAttention') === 'true')).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Wymaga uwagi (1)' }).getAttribute('aria-pressed')).toBe('true');
      expect(within(screen.getByRole('list', { name: 'Media i dokumenty' })).getAllByRole('listitem')).toHaveLength(1);
    });
    await userEvent.click(screen.getByRole('button', { name: 'Wszystkie' }));
    await waitFor(() => {
      expect(within(screen.getByRole('list', { name: 'Media i dokumenty' })).getAllByRole('listitem')).toHaveLength(2);
    });
  });

  it('EVM-049 AC6 without files held there is no filter', async () => {
    await openMedia({ assets: [asset(4, { fileState: 'ready' })] });
    await screen.findByRole('list', { name: 'Media i dokumenty' });
    expect(screen.queryByRole('button', { name: /^Wymaga uwagi/ })).toBeNull();
  });

  it('EVM-049 AC6 when no file is held the filter says "Brak plików wymagających uwagi." with "Pokaż wszystkie"', async () => {
    const assets: MediaAsset[] = [held()];
    const rescan: Handler = () => {
      assets.length = 0;
      return accepted(undefined as never);
    };
    await openMedia({ assets, rescan });
    await userEvent.click(await screen.findByRole('button', { name: 'Wymaga uwagi (1)' }));
    await userEvent.click(await screen.findByRole('button', { name: /^Skanuj ponownie/ }));
    expect(await screen.findByText('Brak plików wymagających uwagi.')).toBeTruthy();
    expect(screen.queryByText('To zlecenie nie ma jeszcze zdjęć.')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Pokaż wszystkie' }));
    expect(await screen.findByText('To zlecenie nie ma jeszcze zdjęć.')).toBeTruthy();
  });
});

describe('EVM-049 AC1 accessibility', () => {
  it('EVM-049 AC1 the tab with a tile held, a tile purged and the filter has no axe violations', async () => {
    await openMedia({ assets: [held({ quarantineReasonCode: 'malware_detected' }), purged] });
    const heading = await screen.findByRole('heading', { level: 2, name: 'Media i dokumenty' });
    await screen.findByRole('button', { name: 'Wymaga uwagi (1)' });
    expect(await axeViolations(heading.closest('section') as HTMLElement)).toEqual([]);
  });
});
