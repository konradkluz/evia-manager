import { compareVersions, parseVersion } from '../src/startup/semver';

describe('semver comparison of the app version (EVM-009 AC3)', () => {
  it.each([
    ['0.1.0', '0.1.0', 0],
    ['0.1.0', '0.2.0', -1],
    ['0.2.0', '0.1.0', 1],
    ['1.0.0', '0.9.9', 1],
    ['1.0.1', '1.0.0', 1],
    ['1.0.0', '1.0.1', -1],
    ['1.9.0', '1.10.0', -1],
    ['1.0.0-beta.1', '1.0.0', -1],
    ['1.0.0', '1.0.0-beta.1', 1],
    ['1.0.0-beta.1', '1.0.0-beta.2', -1],
    ['1.0.0-beta.2', '1.0.0-beta.11', -1],
    ['1.0.0-alpha', '1.0.0-beta', -1],
    ['1.0.0-beta', '1.0.0-alpha', 1],
    ['1.0.0-1', '1.0.0-alpha', -1],
    ['1.0.0-alpha', '1.0.0-1', 1],
    ['1.0.0-alpha', '1.0.0-alpha.1', -1],
    ['1.0.0-alpha.1', '1.0.0-alpha', 1],
    ['1.0.0-rc.1', '1.0.0-rc.1', 0],
    ['1.0.0+build5', '1.0.0+build9', 0],
  ])('EVM-009 AC3: %s compared with %s gives %i', (left, right, expected) => {
    expect(compareVersions(left, right)).toBe(expected);
  });

  it.each(['', '1', '1.2', '1.2.x', 'v1.2.3', '1.2.3.4', '01.2.3', '1.2.3-', '1.2.3-01', 'abc', ' 1.2.3', '99999999999999999999.0.0'])(
    'EVM-009 AC3: an invalid version %j is not comparable, so nothing is blocked',
    (value) => {
      expect(parseVersion(value)).toBeNull();
      expect(compareVersions(value, '1.0.0')).toBeNull();
      expect(compareVersions('1.0.0', value)).toBeNull();
    },
  );
});
