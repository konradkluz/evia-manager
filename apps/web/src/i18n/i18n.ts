/**
 * i18next with the Polish catalogue (ADR-0006, styleguide § 6). The language is fixed — no browser language detector,
 * nothing stored in localStorage or cookies (SR-WEB-05). Synchronous init: the resources are bundled.
 */
import i18next, { type i18n } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { pl } from './pl.ts';

export const LANGUAGE = 'pl';

export function createI18n(): i18n {
  const instance = i18next.createInstance();
  void instance.use(initReactI18next).init({
    lng: LANGUAGE,
    fallbackLng: LANGUAGE,
    supportedLngs: [LANGUAGE],
    resources: { [LANGUAGE]: { translation: pl } },
    initAsync: false,
    // React escapes rendered text itself.
    interpolation: { escapeValue: false },
  });
  return instance;
}
