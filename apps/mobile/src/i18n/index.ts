import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { pl } from './pl';

/** Polish is the only language of the app (AC1: texts through i18n pl). */
void i18next.use(initReactI18next).init({
  lng: 'pl',
  fallbackLng: 'pl',
  resources: { pl: { translation: pl } },
  interpolation: { escapeValue: false },
  initAsync: false,
});

export { i18next };
