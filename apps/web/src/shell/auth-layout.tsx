import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Layout of the pages before the panel (W-13): the card in a column of `size.form.max-width` on the brand background
 * (styleguide § 3.8). Bare assets of the panel only — no external fonts, images or links (README M1, link tokens).
 */
export function AuthLayout({ children }: { readonly children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col min-h-screen bg-bg-brand">
      <main className="flex flex-col items-center gap-stack-lg px-grid-compact-margin medium:px-grid-medium-margin py-stack-2xl">
        <p className="text-label-lg font-semibold text-text-on-brand">{t('app.name')}</p>
        <div className="w-full max-w-form-max-width">{children}</div>
      </main>
    </div>
  );
}
