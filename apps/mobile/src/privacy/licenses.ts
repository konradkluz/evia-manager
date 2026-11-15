/**
 * "Licencje open source" of M-11 (EVM-102 AC1): the main components of the app and their licences, one line each — a static list built
 * into the app (it must work offline and before the sign-in). test/privacy-help.test.tsx keeps the dependency entries in step with
 * package.json, so a removed library does not stay on the list.
 */
export interface LicenseEntry {
  readonly name: string;
  readonly license: string;
  /** The package of package.json this entry stands for; `null` = a component compiled into a native module. */
  readonly dependency: string | null;
}

export const LICENSES: readonly LicenseEntry[] = [
  { name: 'SQLCipher Community Edition (szyfrowana baza w telefonie)', license: 'BSD (Zetetic LLC)', dependency: null },
  { name: 'Expo i moduły Expo', license: 'MIT', dependency: 'expo' },
  { name: 'React Native', license: 'MIT', dependency: 'react-native' },
  { name: 'React', license: 'MIT', dependency: 'react' },
  { name: 'react-native-svg', license: 'MIT', dependency: 'react-native-svg' },
  { name: 'react-native-safe-area-context', license: 'MIT', dependency: 'react-native-safe-area-context' },
  { name: 'i18next i react-i18next', license: 'MIT', dependency: 'i18next' },
  { name: 'Lucide (ikony)', license: 'ISC', dependency: 'lucide-react-native' },
];
