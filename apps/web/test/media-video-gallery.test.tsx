import type { MediaAsset } from '@evia/contracts';
import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from './a11y.ts';
import { asset, mediaApi } from './media-api.ts';
import { renderPanel } from './render.tsx';
import { userEvent } from './user.ts';
import { ORDER_ID } from './work-order-api.ts';

// W-09 gallery with films (EVM-046 AC3, AC4, AC5, AC6).
const PATH = `/work-orders/${ORDER_ID}`;

afterEach(() => {
  vi.unstubAllGlobals();
});

const clip = (n: number, extra: Partial<MediaAsset> = {}) =>
  asset(n, { mediaType: 'video', fileState: 'ready', category: 'measurement', durationSeconds: 242, ...extra });

async function openMedia(options: Parameters<typeof mediaApi>[0] = {}) {
  const api = mediaApi(options);
  await renderPanel(PATH, api);
  await screen.findByRole('heading', { level: 1, name: 'ZL-2026-0042' });
  await userEvent.click(await screen.findByRole('tab', { name: 'Media i dokumenty' }));
  await screen.findByRole('heading', { level: 2, name: 'Media i dokumenty' });
  return api;
}

describe('EVM-046 AC4 the tile of a film', () => {
  it('EVM-046 AC4 a film that is ready is a tile in the gallery with its duration "4:02" and a name that says it is a film', async () => {
    await openMedia({ assets: [clip(1), asset(2, { fileState: 'ready' })] });
    const tile = await screen.findByRole('button', { name: /^Odtwórz: Film · Pomiary · .* · 4:02$/ });
    expect(within(tile).getByText('4:02')).toBeTruthy();
    expect(await screen.findByRole('heading', { level: 3, name: 'Zdjęcia i filmy · 1 zdjęcie, 1 film' })).toBeTruthy();
    // the group of the film is told by the category, the photo keeps its own group
    expect(screen.getByRole('region', { name: 'Pomiary' })).toBeTruthy();
    expect(await axeViolations(screen.getByRole('region', { name: 'Pomiary' }))).toEqual([]);
  });

  it('EVM-046 AC4 a film whose duration is not known shows the tile without a time', async () => {
    await openMedia({ assets: [clip(1, { durationSeconds: null })] });
    const tile = await screen.findByRole('button', { name: /^Odtwórz: Film · Pomiary/ });
    expect(tile.textContent).not.toMatch(/\d:\d\d/);
  });

  it('EVM-046 AC4 a film that is `clean` or `processing` shows "Wysłano" and the promise of a preview (the server makes it)', async () => {
    await openMedia({ assets: [clip(1, { fileState: 'processing', durationSeconds: null })] });
    expect(await screen.findByText('Wysłano')).toBeTruthy();
    expect(screen.getByText('Przygotowujemy podgląd.')).toBeTruthy();
  });

  it('EVM-046 AC5 a film whose processing failed (limit of time) says so in W-09, without promising another try', async () => {
    await openMedia({
      assets: [clip(1, { fileState: 'failed', stateReasonCode: null, processingFailed: true, durationSeconds: null })],
    });
    expect(await screen.findByText('Nie udało się przygotować podglądu filmu.')).toBeTruthy();
    expect(screen.queryByText(/Spróbujemy ponownie/)).toBeNull();
  });
});

describe('EVM-046 AC3 a film that was not scanned by the antivirus (over 2 GB)', () => {
  it('EVM-046 AC3 the tile carries the mark "Nieskanowany antywirusem — plik za duży" as text; a scanned film has none', async () => {
    await openMedia({ assets: [clip(1, { avScanned: false, declaredSize: 2_500_000_000 }), clip(2, { category: 'defect' })] });
    await screen.findAllByRole('button', { name: /^Odtwórz: Film/ });
    expect(screen.getAllByText('Nieskanowany antywirusem — plik za duży')).toHaveLength(1);
  });
});
