// Typed translation keys: t('…') accepts only keys of the Polish catalogue.
import 'i18next';
import type { pl } from './pl.ts';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof pl };
  }
}
