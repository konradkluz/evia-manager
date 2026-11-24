import type { Page } from '@playwright/test';
import { expect } from './fixtures.ts';
import { SURVEY_NUMBER, SURVEY_PATH } from './mock-site-surveys.ts';

// Helpers of the specs of the offer in a site survey (EVM-148). Synthetic data only.
export const OFFER = { name: 'oferta-testowa.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 synthetic') };

export async function openDocuments(page: Page) {
  await page.goto(SURVEY_PATH);
  await expect(page.getByRole('heading', { level: 1, name: SURVEY_NUMBER })).toBeVisible();
  await page.getByRole('tab', { name: 'Media i dokumenty' }).click();
  await expect(page.getByRole('heading', { level: 2, name: /^Dokumenty zlecenia/ })).toBeVisible();
}

export async function sendOffer(page: Page) {
  await page.getByRole('button', { name: 'Dodaj dokument' }).click();
  const dialog = page.getByRole('dialog', { name: 'Dodaj dokument' });
  await dialog.getByLabel('Plik dokumentu').setInputFiles(OFFER);
  await dialog.getByRole('textbox', { name: 'Tytuł' }).fill('Oferta testowa');
  await dialog.getByRole('button', { name: 'Dodaj dokument' }).click();
}
