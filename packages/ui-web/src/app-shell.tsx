import { useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { IconButton } from './button.tsx';
import { Menu } from './icons.ts';
import { NavigationDrawer } from './navigation-drawer.tsx';
import { NavigationList, PlainLink, type LinkComponent, type NavigationItem } from './navigation.tsx';

export const MAIN_CONTENT_ID = 'main-content';

export interface AppShellLabels {
  readonly skipToContent: string;
  /** Name of the navigation landmark and of the drawer. */
  readonly navigation: string;
  readonly openMenu: string;
  readonly closeMenu: string;
}

export interface AppShellProps {
  /** Product name shown as text until the brand identity is approved (no invented logo). */
  readonly brand: string;
  readonly navigation: readonly NavigationItem[];
  readonly labels: AppShellLabels;
  /** E.g. the offline banner (§ 4.10), shown above the content. */
  readonly banner?: ReactNode;
  /** Account menu at the end of the TopBar (shown once there is a session, E1). */
  readonly account?: ReactNode;
  readonly linkComponent?: LinkComponent | undefined;
  readonly children: ReactNode;
}

/**
 * Panel shell (styleguide § 3.17, 1.3.0 proposal): skip link → Sidebar (expanded ≥ breakpoint.expanded, collapsed on
 * breakpoint.medium, hidden below) → TopBar (size.app-bar.height.web, without search and account before E1; "Menu"
 * opening the drawer below breakpoint.medium) → banner → main (grid margins per breakpoint).
 */
export function AppShell({ brand, navigation, labels, banner, account, linkComponent = PlainLink, children }: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);

  const skipToContent = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    document.getElementById(MAIN_CONTENT_ID)?.focus();
  };
  const closeDrawer = () => {
    setDrawerOpen(false);
    menuButton.current?.focus();
  };

  return (
    <div className="flex min-h-screen bg-bg-canvas text-text-primary">
      <a
        href={`#${MAIN_CONTENT_ID}`}
        onClick={skipToContent}
        className="sr-only focus:not-sr-only focus:absolute focus:start-0 focus:top-0 focus:p-inset-md focus:bg-bg-surface focus:text-text-primary focus:text-label-lg focus-visible:focus-ring"
      >
        {labels.skipToContent}
      </a>
      <nav
        aria-label={labels.navigation}
        className="hidden medium:flex flex-col shrink-0 w-sidebar-width-collapsed expanded:w-sidebar-width-expanded bg-bg-brand-strong text-text-on-brand"
      >
        <p className="hidden expanded:flex items-center h-app-bar-height-web px-inset-md text-label-lg font-semibold">{brand}</p>
        <div className="expanded:hidden h-app-bar-height-web" />
        <NavigationList items={navigation} link={linkComponent} collapsible />
      </nav>
      <div className="flex flex-col flex-1 min-w-0">
        <header className="flex items-center gap-inline-sm h-app-bar-height-web px-grid-compact-margin medium:px-grid-medium-margin expanded:px-grid-expanded-margin wide:px-grid-wide-margin bg-bg-surface">
          <IconButton
            ref={menuButton}
            icon={Menu}
            label={labels.openMenu}
            aria-haspopup="dialog"
            aria-expanded={drawerOpen}
            onClick={() => {
              setDrawerOpen(true);
            }}
            className="medium:hidden"
          />
          <p className="expanded:hidden text-label-lg font-semibold">{brand}</p>
          {account ? <div className="ms-auto">{account}</div> : null}
        </header>
        {banner}
        <main
          id={MAIN_CONTENT_ID}
          tabIndex={-1}
          className="flex-1 px-grid-compact-margin medium:px-grid-medium-margin expanded:px-grid-expanded-margin wide:px-grid-wide-margin py-stack-lg focus-visible:focus-ring"
        >
          {children}
        </main>
      </div>
      <NavigationDrawer
        open={drawerOpen}
        label={labels.navigation}
        closeLabel={labels.closeMenu}
        items={navigation}
        link={linkComponent}
        onClose={closeDrawer}
      />
    </div>
  );
}
