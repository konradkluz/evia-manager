/**
 * @evia/ui-web — web component library of EVia Manager (ADR-0006; styleguide § 3, § 7.2; EVM-008).
 * Components take every text as props (the library has no i18n of its own); styles only through src/styles.css.
 */
export { AppShell, MAIN_CONTENT_ID, type AppShellLabels, type AppShellProps } from './app-shell.tsx';
export { Banner } from './banner.tsx';
export { Button, IconButton, type IconButtonProps } from './button.tsx';
export { EmptyState, type EmptyStateProps } from './empty-state.tsx';
export { CircleAlert, ClipboardList, Menu, WifiOff, X, type Icon } from './icons.ts';
export { PlainLink, type LinkComponent, type LinkProps, type NavigationItem } from './navigation.tsx';
