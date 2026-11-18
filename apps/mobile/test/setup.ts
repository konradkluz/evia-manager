// Shared test setup (EVM-009): Polish i18n; native modules are mocked by the jest-expo preset.
import '../src/i18n';

jest.mock('../src/screens/after-frames', () => jest.requireActual<typeof import('./mocks/after-frames')>('./mocks/after-frames'));
