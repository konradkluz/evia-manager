import { bucketHostsOf, isAllowedMediaUrl } from '../../src/media-view/media-url-policy';

describe('address of an image (EVM-142 AC5; SR-MOB-10)', () => {
  it('EVM-142 AC5: only https with a named host passes; credentials, IP literals, one-label hosts, other schemes and odd input do not', () => {
    expect(isAllowedMediaUrl('https://media.example.eu/key?X-Amz-Signature=x')).toBe(true);
    expect(isAllowedMediaUrl('https://media.example.eu:8443/key')).toBe(true);
    for (const bad of [
      'http://media.example.eu/key',
      'https://user:pw@media.example.eu/key',
      'https://10.0.0.5/key',
      'https://localhost/key',
      'https://[::1]/key',
      'file:///data/user/0/key',
      'content://media/1',
      'data:image/webp;base64,AAAA',
      'javascript:alert(1)',
      'ftp://media.example.eu/key',
      'not a url',
      '',
      'https:///key',
    ]) {
      expect(isAllowedMediaUrl(bad)).toBe(false);
    }
  });

  it('EVM-142 AC5 (S4): when the build knows the host of the bucket the host is EXACTLY that host (case-insensitive) - subdomains and look-alikes are refused', () => {
    const policy = { allowedHosts: ['Media.Example.eu'] };
    expect(isAllowedMediaUrl('https://media.example.eu/k', policy)).toBe(true);
    expect(isAllowedMediaUrl('https://MEDIA.Example.EU/k?X=1', policy)).toBe(true);
    expect(isAllowedMediaUrl('HTTPS://media.example.eu:443/k', policy)).toBe(true);
    expect(isAllowedMediaUrl('https://bucket.media.example.eu/k', policy)).toBe(false);
    expect(isAllowedMediaUrl('https://evilmedia.example.eu/k', policy)).toBe(false);
    expect(isAllowedMediaUrl('https://media.example.eu.evil.pl/k', policy)).toBe(false);
  });

  it.each([
    ['a backslash that turns the host into a path in some parsers', 'https://obcy.example\\.media.example.eu/k'],
    ['a non-default port', 'https://media.example.eu:8443/k'],
    ['a non-default port with an empty path', 'https://media.example.eu:80'],
    ['a subdomain', 'https://a.media.example.eu/k'],
    ['an encoded slash in the host', 'https://media.example.eu%2fevil.pl/k'],
    ['an encoded dot in the host', 'https://media%2eexample.eu/k'],
    ['a full-width slash', 'https://obcy.example／media.example.eu/k'],
    ['an ideographic full stop', 'https://media。example。eu/k'],
    ['credentials', 'https://media.example.eu@obcy.example/k'],
    ['credentials before the right host', 'https://user:pw@media.example.eu/k'],
    ['a trailing dot', 'https://media.example.eu./k'],
    ['an IP literal', 'https://203.0.113.7/k'],
    ['a space', 'https://media.example.eu/a b'],
    ['a control character', 'https://media.example.eu/a\u0000b'],
    ['a letter outside ASCII in the path', 'https://media.example.eu/ż'],
    ['an address longer than 4096 characters', `https://media.example.eu/${'a'.repeat(4100)}`],
  ])('EVM-142 AC5 (S4): %s is refused when the build knows its bucket', (_name, url) => {
    expect(isAllowedMediaUrl(url, { allowedHosts: ['media.example.eu'] })).toBe(false);
  });

  it('EVM-142 AC5 (SR-MOB-10): several hosts of the bucket; an empty list (a build without a bucket) refuses every address', () => {
    const policy = { allowedHosts: ['a.example.eu', 'b.example.eu'] };
    expect(isAllowedMediaUrl('https://b.example.eu/k', policy)).toBe(true);
    expect(isAllowedMediaUrl('https://c.example.eu/k', policy)).toBe(false);
    expect(isAllowedMediaUrl('https://a.example.eu/k', { allowedHosts: [] })).toBe(false);
  });

  it('EVM-142 AC5 (SR-MOB-10): the host list comes from the build; only the e2e variant skips the check, a release build never does', () => {
    expect(bucketHostsOf({ buildVariant: 'release', storageHosts: ['media.example.eu'] })).toEqual({ allowedHosts: ['media.example.eu'] });
    expect(bucketHostsOf({ buildVariant: 'release', storageHosts: [] })).toEqual({ allowedHosts: [] });
    expect(bucketHostsOf({ buildVariant: 'e2e', storageHosts: ['10.0.2.2:8787'] })).toEqual({});
  });

  it('EVM-142 AC5 (S4): the e2e variant (no host list) keeps its looser rules but still refuses a backslash, non-ASCII characters and a trailing dot', () => {
    expect(isAllowedMediaUrl('https://obcy.example\\.media.example.eu/k')).toBe(false);
    expect(isAllowedMediaUrl('https://media。example.eu/k')).toBe(false);
    expect(isAllowedMediaUrl('https://media.example.eu./k')).toBe(false);
    expect(isAllowedMediaUrl('http://10.0.2.2:9000/kż', { allowLocalHttp: true })).toBe(false);
  });

  it('EVM-142 AC5: plain http passes only for the emulator hosts of the e2e variant', () => {
    expect(isAllowedMediaUrl('http://10.0.2.2:9000/k', { allowLocalHttp: true })).toBe(true);
    expect(isAllowedMediaUrl('http://localhost:9000/k', { allowLocalHttp: true })).toBe(true);
    expect(isAllowedMediaUrl('http://10.0.2.2:9000/k')).toBe(false);
    expect(isAllowedMediaUrl('http://media.example.eu/k', { allowLocalHttp: true })).toBe(false);
  });
});
