import type { ReactNode } from 'react';
import { type LinkComponent } from './navigation.tsx';

const CLASSES = 'break-words underline text-text-link focus-visible:focus-ring';

/**
 * Link in running text (styleguide § 3.17, § 3.5): `color.text.link`, underlined, focus ring. The caller decides WHICH address
 * may become a link (the panel allows only `https:`, `tel:` and `mailto:` — see `safeHref` in the app); this component adds
 * `rel="noopener noreferrer"` to every link, so a link that comes from data never gets a handle on the page that opened it.
 * `link` is the router link of the application for a page inside it (no new tab, no `rel` needed); without it the anchor is plain.
 */
export function TextLink({
  href,
  children,
  link: Link,
}: {
  readonly href: string;
  readonly children: ReactNode;
  readonly link?: LinkComponent;
}) {
  if (Link !== undefined) {
    return (
      <Link href={href} className={CLASSES}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} rel="noopener noreferrer" className={CLASSES}>
      {children}
    </a>
  );
}
