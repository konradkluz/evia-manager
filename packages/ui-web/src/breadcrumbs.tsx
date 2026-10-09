import { ChevronRight } from './icons.ts';
import { PlainLink, type LinkComponent } from './navigation.tsx';

export interface BreadcrumbItem {
  readonly label: string;
  /** Every item but the last one leads somewhere; the last one is the page itself (`aria-current="page"`). */
  readonly href?: string;
}

export interface BreadcrumbsProps {
  /** Name of the navigation landmark ("Okruszki"). */
  readonly label: string;
  readonly items: readonly BreadcrumbItem[];
  /** Router link of the application; a plain anchor by default. */
  readonly link?: LinkComponent;
}

/**
 * Breadcrumbs (styleguide § 3.17): an ordered list in a labelled `nav`, `text.body-sm`; the current page is plain text with
 * `aria-current="page"`, the separators are decorative icons.
 */
export function Breadcrumbs({ label, items, link: Link = PlainLink }: BreadcrumbsProps) {
  return (
    <nav aria-label={label}>
      <ol className="flex flex-wrap items-center gap-inline-sm text-body-sm text-text-secondary">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${String(index)}-${item.label}`} className="flex items-center gap-inline-sm">
              {item.href !== undefined && !last ? (
                <Link href={item.href} className="underline text-text-link focus-visible:focus-ring">
                  {item.label}
                </Link>
              ) : (
                <span aria-current={last ? 'page' : undefined} className="break-words">
                  {item.label}
                </span>
              )}
              {last ? null : <ChevronRight aria-hidden="true" className="size-icon-sm shrink-0" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
