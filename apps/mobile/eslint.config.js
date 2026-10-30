// @ts-check
import { config, mobileUi } from '@evia/config/eslint';

// EVM-093 (security review 7): the encrypted database is reached only through the SQLCipher driver; no plain-text storage at all.
const storageImports = {
  paths: [
    { name: 'expo-sqlite', message: 'Only src/storage/expo-sqlite-driver.ts may import expo-sqlite (SQLCipher driver, EVM-093).' },
    { name: 'expo-sqlite/kv-store', message: 'No key-value store: data lives in the SQLCipher database only (SR-MOB-01).' },
    { name: 'expo-sqlite/localStorage', message: 'No localStorage: data lives in the SQLCipher database only (SR-MOB-01).' },
  ],
  patterns: [{ group: ['@react-native-async-storage/*'], message: 'AsyncStorage is plain text (SR-MOB-01, MASVS-STORAGE-1).' }],
};

export default [
  { ignores: ['android/**', 'ios/**', '.expo/**', 'modules/*/android/**'] },
  ...config({ tsconfigRootDir: import.meta.dirname }),
  ...mobileUi(),
  { files: ['**/*.{ts,tsx}'], rules: { 'no-restricted-imports': ['error', storageImports] } },
  {
    files: ['src/storage/expo-sqlite-driver.ts'],
    rules: {
      'no-restricted-imports': ['error', { ...storageImports, paths: storageImports.paths.filter((p) => p.name !== 'expo-sqlite') }],
    },
  },
];
