import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axeViolations } from './a11y.ts';
import { ACTIVE_SESSION, createFakeApi, json, problem, SESSION_ROUTE } from './api-fake.ts';
import { renderPanel } from './render.tsx';
import { setupUser } from './user.ts';

// "Instrukcja dla biura" in the panel (EVM-066 AC6): opened from W-19 "Pomoc" by every role and without a session.

const unauthenticated = () => createFakeApi({ [SESSION_ROUTE]: () => problem(401, 'unauthenticated') });
const withRole = (role: 'administrator' | 'editor' | 'read_only') =>
  createFakeApi({ [SESSION_ROUTE]: () => json(200, { ...ACTIVE_SESSION, user: { ...ACTIVE_SESSION.user, role } }) });
const SOURCE = readFileSync(resolve(import.meta.dirname, '../../../docs/user/instrukcja-dla-biura.md'), 'utf8');
const SECTIONS = [...SOURCE.matchAll(/^## (.+)$/gm)].map((match) => match[1] ?? '');

async function openFromHelp(api: ReturnType<typeof createFakeApi>) {
  const user = setupUser();
  await renderPanel('/privacy', api);
  await user.click(await screen.findByRole('link', { name: 'Instrukcja dla biura' }));
  await screen.findByRole('heading', { level: 2, name: 'Spis treści' });
  return user;
}

describe('"Instrukcja dla biura" opened from W-19 (EVM-066 AC6)', () => {
  it.each(['administrator', 'editor', 'read_only'] as const)(
    'EVM-066 AC6 the role %s opens it from "Pomoc" as a page of the panel with the title of the card and the table of contents',
    async (role) => {
      const api = withRole(role);
      await openFromHelp(api);
      expect(screen.getByRole('heading', { level: 1, name: 'Instrukcja dla biura' })).toBeTruthy();
      expect(document.title).toBe('Instrukcja dla biura · EVia Manager');
      expect(screen.getByRole('navigation', { name: 'Główna nawigacja' })).toBeTruthy();
      expect(screen.getByRole('navigation', { name: 'Spis treści' })).toBeTruthy();
      // the page reads only the session: the content is static and comes with the panel
      expect(new Set(api.requests.map((entry) => `${entry.method} ${entry.path}`))).toEqual(new Set(['GET /api/v1/auth/session']));
    },
  );

  it('EVM-066 AC6 without a session it opens in the public layout with the way back to the login', async () => {
    await openFromHelp(unauthenticated());
    expect(screen.getByRole('heading', { level: 1, name: 'Instrukcja dla biura' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Wróć do logowania' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Główna nawigacja' })).toBeNull();
  });

  it('EVM-066 AC6 the content is made from the source in the repository: every section of the source is a heading and in the table of contents', async () => {
    await openFromHelp(unauthenticated());
    expect(SECTIONS).toHaveLength(8);
    const toc = within(screen.getByRole('navigation', { name: 'Spis treści' }));
    for (const section of SECTIONS) {
      expect(screen.getByRole('heading', { level: 2, name: section })).toBeTruthy();
      expect(toc.getByRole('link', { name: section })).toBeTruthy();
    }
    // the hierarchy: an h1 and then h2 sections with h3 inside; no level is skipped
    const levels = screen.getAllByRole('heading').map((heading) => Number(heading.tagName.slice(1)));
    expect(levels.filter((level) => level === 1)).toHaveLength(1);
    expect(levels.every((level, index) => index === 0 || level - (levels[index - 1] ?? 0) <= 1)).toBe(true);
  });

  it('EVM-066 AC6 the content has no scripts, images, iframes or external links; the table of the scenarios is a real table', async () => {
    const { container } = await renderPanel('/guide', unauthenticated());
    await screen.findByRole('heading', { level: 2, name: 'Spis treści' });
    expect(container.querySelectorAll('script, img, iframe, link, style, object, embed')).toHaveLength(0);
    const external = [...container.querySelectorAll('a[href]')].filter((link) => !/^(#|\/)/.test(link.getAttribute('href') ?? ''));
    expect(external).toEqual([]);
    expect(screen.getByRole('table', { name: 'Szablony zleceń w typowych sytuacjach' })).toBeTruthy();
    expect(screen.getByText('https://panel.eviacharge.pl').tagName).toBe('STRONG');
  });

  it('EVM-066 AC6 a link of the table of contents moves focus to its section', async () => {
    const user = await openFromHelp(unauthenticated());
    const last = SECTIONS[6] ?? '';
    await user.click(within(screen.getByRole('navigation', { name: 'Spis treści' })).getByRole('link', { name: last }));
    const heading = await screen.findByRole('heading', { level: 2, name: last });
    expect(document.activeElement).toBe(heading);
  });

  it('EVM-066 AC6 the page has no accessibility violations', async () => {
    const { container } = await renderPanel('/guide', unauthenticated());
    await screen.findByRole('heading', { level: 2, name: 'Spis treści' });
    expect(await axeViolations(container)).toEqual([]);
  });
});
