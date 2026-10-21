// Jest (jest-expo) for unit and component tests (EVM-009 AC4). The coverage thresholds come from the same file as the Vitest preset
// (packages/config/coverage-thresholds.json — the ratchet of docs/process/testing-strategy.md); lcov.info feeds tools/diff-coverage.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const thresholds = /** @type {unknown} */ (
  JSON.parse(readFileSync(fileURLToPath(import.meta.resolve('@evia/config/coverage-thresholds.json')), 'utf8'))
);
if (typeof thresholds !== 'object' || thresholds === null || !('mobile' in thresholds) || typeof thresholds.mobile !== 'number') {
  throw new Error('coverage-thresholds.json: missing numeric "mobile" threshold');
}
const { mobile } = thresholds;

export default {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/test/**/*.test.{ts,tsx}'],
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', 'plugins/**/*.ts', '!**/*.d.ts'],
  coverageReporters: ['text', 'lcov'],
  coverageDirectory: 'coverage',
  // The first render of a worker loads react-native lazily and transforms its modules; on a cold Babel cache (a CI runner) that exceeded
  // the 5 s default of Jest (CI run 39540211872, app.test.tsx) — even a 16-core machine needs about 11 s for the cold file.
  testTimeout: 30_000,
  // jest-expo default (pnpm paths: the first allowed segment is .pnpm).
  transformIgnorePatterns: [
    '/node_modules/(?!(.pnpm|react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts))',
    '/node_modules/@react-native/babel-preset/',
  ],
  // The icon files are ES modules under the react-native export condition; Jest uses their CommonJS twins.
  moduleNameMapper: { '^lucide-react-native/icons/(.*)$': '<rootDir>/node_modules/lucide-react-native/dist/cjs/icons/$1.js' },
  coverageThreshold: { global: { lines: mobile, branches: mobile } },
};
