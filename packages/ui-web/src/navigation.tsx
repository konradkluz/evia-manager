import type { MouseEvent, ReactNode } from 'react';
import { classNames } from './class-names.ts';
import type { Icon } from './icons.ts';

export interface NavigationItem {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly icon: Icon;
  /** The page of this item is open: aria-current="page" and the active indicator. */
  readonly current: boolean;
}

export interface LinkProps {
  readonly href: string;
  readonly className: string;
  readonly 'aria-current'?: 'page';
  readonly onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
  readonly children: ReactNode;
}

/** Router link supplied by the application (the library does not depend on a router); a plain anchor by default. */
export type LinkComponent = (props: LinkProps) => ReactNode;

export const PlainLink: LinkComponent = ({ href, children, ...rest }) => (
  <a href={href} {...rest}>
    {children}
  </a>
);

/**
 * Navigation item on the brand surface (styleguide § 3.17): icon size.icon.md + label text.label-lg on-brand;
 * active — accent indicator border-width.indicator, semibold, aria-current="page"; hover color.bg.brand; focus ring
 * inverse. `collapsible`: in the collapsed Sidebar (breakpoint.medium … < expanded) the label becomes a tooltip
 * shown on hover and keyboard focus — it stays in the accessibility tree as the link's name.
 */
export function NavigationLink({
  item,
  link: Link,
  collapsible,
  onNavigate,
}: {
  readonly item: NavigationItem;
  readonly link: LinkComponent;
  readonly collapsible: boolean;
  readonly onNavigate?: () => void;
}) {
  const { icon: IconComponent } = item;
  return (
    <Link
      href={item.href}
      aria-current={item.current ? 'page' : undefined}
      onClick={onNavigate}
      className={classNames(
        'group relative flex items-center gap-inline-md min-h-touch-target-min px-inset-md text-label-lg text-text-on-brand',
        'hover:bg-bg-brand focus-visible:focus-ring-inverse',
        collapsible && 'medium:max-expanded:justify-center',
        item.current && 'font-semibold',
      )}
    >
      {item.current && <span data-indicator className="absolute inset-y-0 start-0 w-border-width-indicator bg-brand-accent" />}
      <IconComponent aria-hidden="true" className="size-icon-md shrink-0" />
      <span
        className={classNames(
          'whitespace-nowrap',
          collapsible &&
            [
              'medium:max-expanded:absolute medium:max-expanded:start-full medium:max-expanded:ms-inline-sm',
              'medium:max-expanded:px-inset-sm medium:max-expanded:py-inset-xs medium:max-expanded:rounded-control',
              'medium:max-expanded:bg-bg-inverse medium:max-expanded:text-text-inverse medium:max-expanded:text-label',
              'medium:max-expanded:opacity-0 medium:max-expanded:pointer-events-none',
              'medium:max-expanded:group-hover:opacity-100 medium:max-expanded:group-focus-visible:opacity-100',
            ].join(' '),
        )}
      >
        {item.label}
      </span>
    </Link>
  );
}

/** List of navigation items (one list for the Sidebar and for the drawer). */
export function NavigationList({
  items,
  link,
  collapsible,
  onNavigate,
}: {
  readonly items: readonly NavigationItem[];
  readonly link: LinkComponent;
  readonly collapsible: boolean;
  readonly onNavigate?: () => void;
}) {
  return (
    <ul className="flex flex-col gap-stack-xs py-stack-sm">
      {items.map((item) => (
        <li key={item.id}>
          <NavigationLink item={item} link={link} collapsible={collapsible} onNavigate={onNavigate} />
        </li>
      ))}
    </ul>
  );
}
