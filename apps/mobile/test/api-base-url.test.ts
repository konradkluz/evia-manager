import { parseApiBaseUrl, resolveBuildVariant } from '../src/config/api-base-url';

const release = { allowLocalHttp: false };
const e2e = { allowLocalHttp: true };

describe('API address validation (EVM-009 AC6; SR-COMM-04)', () => {
  it.each([
    ['https://api.example.test', 'https://api.example.test'],
    ['https://API.Example.test/', 'https://api.example.test'],
    ['  https://api.example.test:8443/base/  ', 'https://api.example.test:8443/base'],
  ])('EVM-009 AC6: %j is accepted as %s in a release build', (raw, expected) => {
    expect(parseApiBaseUrl(raw, release)).toEqual({ ok: true, url: expected });
  });

  it.each([
    ['http://api.example.test', 'insecure-host'],
    ['http://10.0.2.2:3000', 'insecure-host'],
    ['http://localhost:3000', 'insecure-host'],
    ['ftp://api.example.test', 'scheme'],
    ['', 'missing'],
    ['   ', 'missing'],
    ['api.example.test', 'malformed'],
    ['https://user:pass@api.example.test', 'malformed'],
    ['https://api.example.test?token=1', 'malformed'],
    ['https://api.example.test/#frag', 'malformed'],
    ['https://', 'malformed'],
    ['https://[::1]:3000', 'malformed'],
    ['https://api example.test', 'malformed'],
  ])('EVM-009 AC6: %j is rejected in a release build (%s)', (raw, reason) => {
    expect(parseApiBaseUrl(raw, release)).toEqual({ ok: false, reason });
  });

  it('EVM-009 AC6: an undefined address is "missing"', () => {
    expect(parseApiBaseUrl(undefined, release)).toEqual({ ok: false, reason: 'missing' });
  });

  it.each(['http://10.0.2.2:3000', 'http://localhost:3000', 'http://127.0.0.1:3000/'])(
    'EVM-009 AC6: plain HTTP to the emulator host %s is accepted in the e2e variant only',
    (raw) => {
      expect(parseApiBaseUrl(raw, e2e)).toMatchObject({ ok: true });
      expect(parseApiBaseUrl(raw, release)).toMatchObject({ ok: false });
    },
  );

  it.each(['http://api.example.test', 'http://192.168.1.10:3000', 'http://10.0.2.20:3000'])(
    'EVM-009 AC6: plain HTTP to %s is rejected even in the e2e variant (only the emulator host is allowed)',
    (raw) => {
      expect(parseApiBaseUrl(raw, e2e)).toEqual({ ok: false, reason: 'insecure-host' });
    },
  );

  it('EVM-009 AC6: only the exact value "e2e" selects the e2e variant (fail closed)', () => {
    expect(resolveBuildVariant('e2e')).toBe('e2e');
    for (const value of [undefined, '', 'E2E', 'debug', 'true', 'release']) expect(resolveBuildVariant(value)).toBe('release');
  });
});
