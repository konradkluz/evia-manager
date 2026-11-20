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

  it('EVM-142 AC5: when the build knows the domain of the bucket the host is that domain or a subdomain of it - a look-alike is refused', () => {
    const policy = { allowedHosts: ['Media.Example.eu'] };
    expect(isAllowedMediaUrl('https://media.example.eu/k', policy)).toBe(true);
    expect(isAllowedMediaUrl('https://bucket.media.example.eu/k', policy)).toBe(true);
    expect(isAllowedMediaUrl('https://evilmedia.example.eu/k', policy)).toBe(false);
    expect(isAllowedMediaUrl('https://media.example.eu.evil.pl/k', policy)).toBe(false);
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

  it('EVM-142 AC5: plain http passes only for the emulator hosts of the e2e variant', () => {
    expect(isAllowedMediaUrl('http://10.0.2.2:9000/k', { allowLocalHttp: true })).toBe(true);
    expect(isAllowedMediaUrl('http://localhost:9000/k', { allowLocalHttp: true })).toBe(true);
    expect(isAllowedMediaUrl('http://10.0.2.2:9000/k')).toBe(false);
    expect(isAllowedMediaUrl('http://media.example.eu/k', { allowLocalHttp: true })).toBe(false);
  });
});
