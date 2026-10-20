/**
 * The browser and the system of a session for the list "Moje sesje" and for e-mail 8 (EVM-028 AC6; SR-INPUT-07, SR-DATA-03, P9): a family out of a CLOSED
 * dictionary, without a version — never the raw `User-Agent`, which is a free text of the client (it could carry anything, and it fingerprints). A string
 * that matches nothing is "Nieznana przeglądarka" / "Nieznany system". The order of the tests matters: browsers that pretend to be Chrome come first.
 */
export interface UserAgentDescription {
  readonly browser: string;
  readonly os: string;
}

const BROWSERS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:Edg|EdgA|EdgiOS|Edge)\//, 'Edge'],
  [/\b(?:OPR|Opera|OPT)\//, 'Opera'],
  [/\b(?:Firefox|FxiOS)\//, 'Firefox'],
  [/\b(?:Chrome|CriOS|Chromium)\//, 'Chrome'],
  [/\bSafari\//, 'Safari'],
];

const SYSTEMS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bAndroid\b/, 'Android'],
  [/\b(?:iPhone|iPad|iPod)\b/, 'iOS'],
  [/\bWindows\b/, 'Windows'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\b(?:Macintosh|Mac OS X)\b/, 'macOS'],
  [/\b(?:Linux|X11)\b/, 'Linux'],
];

export const UNKNOWN_BROWSER = 'Nieznana przeglądarka';
export const UNKNOWN_SYSTEM = 'Nieznany system';

export function describeUserAgent(userAgent: string | null | undefined): UserAgentDescription {
  const text = userAgent ?? '';
  return {
    browser: BROWSERS.find(([pattern]) => pattern.test(text))?.[1] ?? UNKNOWN_BROWSER,
    os: SYSTEMS.find(([pattern]) => pattern.test(text))?.[1] ?? UNKNOWN_SYSTEM,
  };
}
