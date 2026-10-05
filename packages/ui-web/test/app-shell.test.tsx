import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AppShell, ClipboardList, type LinkProps, type NavigationItem } from '../src/index.ts';
import { axeViolations } from './a11y.ts';

const LABELS = { skipToContent: 'Przejdź do treści', navigation: 'Główna nawigacja', openMenu: 'Menu', closeMenu: 'Zamknij menu' };
const NAVIGATION: NavigationItem[] = [{ id: 'work-orders', label: 'Zlecenia', href: '/work-orders', icon: ClipboardList, current: true }];

function shell(props: { banner?: ReactNode; navigation?: NavigationItem[]; linkComponent?: (props: LinkProps) => ReactNode } = {}) {
  return render(
    <AppShell
      brand="EVia Manager"
      labels={LABELS}
      navigation={props.navigation ?? NAVIGATION}
      banner={props.banner}
      linkComponent={props.linkComponent}
    >
      <h1>Zlecenia</h1>
    </AppShell>,
  );
}

describe('AppShell — Sidebar, TopBar, skip link and navigation drawer (styleguide § 3.17; EVM-008 AC3)', () => {
  it('EVM-008 AC3 shell has landmarks header, nav and main, one navigation item "Zlecenia" marked as the current page', async () => {
    shell();
    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.getByRole('main').id).toBe('main-content');
    const nav = screen.getByRole('navigation', { name: 'Główna nawigacja' });
    const link = within(nav).getByRole('link', { name: 'Zlecenia' });
    expect(link.getAttribute('href')).toBe('/work-orders');
    expect(link.getAttribute('aria-current')).toBe('page');
    expect(within(nav).getAllByRole('link')).toHaveLength(1);
    expect(screen.getAllByText('EVia Manager').length).toBeGreaterThan(0);
    expect(await axeViolations(document.body, { bestPractice: true })).toEqual([]);
  });

  it('EVM-008 AC3 the skip link is the first focusable element and moves focus to the main content', async () => {
    shell();
    await userEvent.tab();
    const skip = screen.getByRole('link', { name: 'Przejdź do treści' });
    expect(document.activeElement).toBe(skip);
    expect(skip.className).toContain('focus:not-sr-only');
    await userEvent.keyboard('{Enter}');
    expect(document.activeElement).toBe(screen.getByRole('main'));
  });

  it('EVM-008 AC3 sidebar: expanded from breakpoint.expanded, collapsed with a tooltip on breakpoint.medium, hidden below', () => {
    shell();
    const nav = screen.getByRole('navigation', { name: 'Główna nawigacja' });
    expect(nav.className).toMatch(/(^| )hidden( |$)/);
    expect(nav.className).toContain('medium:flex');
    expect(nav.className).toContain('w-sidebar-width-collapsed');
    expect(nav.className).toContain('expanded:w-sidebar-width-expanded');
    expect(nav.className).toContain('bg-bg-brand-strong');
    const label = within(nav).getByText('Zlecenia');
    expect(label.className).toContain('max-expanded:group-hover:opacity-100');
    expect(label.className).toContain('max-expanded:group-focus-visible:opacity-100');
    const link = within(nav).getByRole('link', { name: 'Zlecenia' });
    expect(link.className).toContain('focus-visible:focus-ring-inverse');
    expect(link.className).toContain('font-semibold');
  });

  it('EVM-008 AC3 collapsed sidebar tooltip is hoverable (WCAG 1.4.13): padding instead of a gap, pointer events while shown', () => {
    shell();
    const nav = screen.getByRole('navigation', { name: 'Główna nawigacja' });
    const label = within(nav).getByText('Zlecenia');
    const tooltip = label.parentElement as HTMLElement;
    expect(tooltip.className).toContain('max-expanded:ps-inline-sm');
    expect(tooltip.className).not.toContain('ms-inline-sm');
    expect(tooltip.className).toContain('max-expanded:group-hover:pointer-events-auto');
    expect(tooltip.className).toContain('max-expanded:group-focus-visible:pointer-events-auto');
  });

  it('EVM-008 AC3 collapsed sidebar tooltip is dismissed with Escape without moving focus and returns after blur', async () => {
    shell();
    const nav = screen.getByRole('navigation', { name: 'Główna nawigacja' });
    const link = within(nav).getByRole('link', { name: 'Zlecenia' });
    const label = within(nav).getByText('Zlecenia');
    act(() => link.focus());
    await userEvent.keyboard('{Escape}');
    expect(document.activeElement).toBe(link);
    expect(label.className).not.toContain('group-focus-visible:opacity-100');
    expect(label.className).not.toContain('group-hover:opacity-100');
    expect((label.parentElement as HTMLElement).className).not.toContain('pointer-events-auto');
    act(() => link.blur());
    expect(label.className).toContain('max-expanded:group-focus-visible:opacity-100');
    fireEvent.keyDown(link, { key: 'Escape' });
    expect(label.className).not.toContain('group-hover:opacity-100');
    fireEvent.mouseLeave(link);
    expect(label.className).toContain('max-expanded:group-hover:opacity-100');
  });

  it('EVM-008 AC3 drawer links ignore Escape for the tooltip (no tooltip outside the collapsed sidebar)', () => {
    shell();
    const nav = screen.getByRole('navigation', { name: 'Główna nawigacja' });
    const link = within(nav).getByRole('link', { name: 'Zlecenia' });
    fireEvent.keyDown(link, { key: 'Enter' });
    expect(within(nav).getByText('Zlecenia').className).toContain('max-expanded:group-hover:opacity-100');
  });

  it('EVM-008 AC3 an inactive item has no aria-current and no active indicator', () => {
    shell({ navigation: NAVIGATION.map((item) => ({ ...item, current: false })) });
    const link = within(screen.getByRole('navigation', { name: 'Główna nawigacja' })).getByRole('link', { name: 'Zlecenia' });
    expect(link.getAttribute('aria-current')).toBeNull();
    expect(link.className).not.toContain('font-semibold');
    expect(link.querySelector('[data-indicator]')).toBeNull();
  });

  it('EVM-008 AC3 below breakpoint.medium the "Menu" button opens a drawer; focus moves inside and Esc closes it and returns focus', async () => {
    shell();
    const menu = screen.getByRole('button', { name: 'Menu' });
    expect(menu.className).toContain('medium:hidden');
    expect(menu.getAttribute('aria-haspopup')).toBe('dialog');
    expect(menu.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(menu);
    const drawer = screen.getByRole('dialog', { name: 'Główna nawigacja' });
    expect(drawer.hasAttribute('open')).toBe(true);
    expect(menu.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(within(drawer).getByRole('button', { name: 'Zamknij menu' }));
    expect(within(drawer).getByRole('link', { name: 'Zlecenia' }).getAttribute('aria-current')).toBe('page');
    // Esc on a modal dialog: the browser fires "cancel" and closes it ("close").
    act(() => {
      fireEvent(drawer, new Event('cancel'));
      (drawer as HTMLDialogElement).close();
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(menu);
    expect(menu.getAttribute('aria-expanded')).toBe('false');
  });

  it('EVM-008 AC3 the drawer closes with its close button, after choosing an item and on a click on the backdrop', async () => {
    const onNavigate = vi.fn();
    const Link = ({ href, children, onClick, ...rest }: LinkProps) => (
      <a
        href={href}
        {...rest}
        onClick={(event) => {
          event.preventDefault();
          onNavigate(href);
          onClick?.(event);
        }}
      >
        {children}
      </a>
    );
    shell({ linkComponent: Link });
    const menu = screen.getByRole('button', { name: 'Menu' });

    await userEvent.click(menu);
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Zamknij menu' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    await userEvent.click(menu);
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('link', { name: 'Zlecenia' }));
    expect(onNavigate).toHaveBeenCalledWith('/work-orders');
    expect(screen.queryByRole('dialog')).toBeNull();

    await userEvent.click(menu);
    const drawer = screen.getByRole('dialog');
    await userEvent.click(within(drawer).getByRole('navigation'));
    expect(screen.getByRole('dialog')).toBe(drawer);
    fireEvent.click(drawer);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('EVM-008 AC3 a banner (e.g. offline) is shown above the content', () => {
    shell({ banner: <div role="status">Brak połączenia.</div> });
    expect(screen.getByRole('status').textContent).toBe('Brak połączenia.');
    expect(screen.getByRole('status').compareDocumentPosition(screen.getByRole('main')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
