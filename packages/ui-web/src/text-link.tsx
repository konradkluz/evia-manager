import type { ReactNode } from 'react';

/**
 * Link in running text (styleguide § 3.17, § 3.5): `color.text.link`, underlined, focus ring. The caller decides WHICH address
 * may become a link (the panel allows only `https:`, `tel:` and `mailto:` — see `safeHref` in the app); this component adds
 * `rel="noopener noreferrer"` to every link, so a link that comes from data never gets a handle on the page that opened it.
 */
export function TextLink({ href, children }: { readonly href: string; readonly children: ReactNode }) {
  return (
    <a href={href} rel="noopener noreferrer" className="break-words underline text-text-link focus-visible:focus-ring">
      {children}
    </a>
  );
}
