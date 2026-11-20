import { isAllowedMediaUrl } from '../../src/media-view/media-url-policy';

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
    const policy = { allowedHost: 'Media.Example.eu' };
    expect(isAllowedMediaUrl('https://media.example.eu/k', policy)).toBe(true);
    expect(isAllowedMediaUrl('https://bucket.media.example.eu/k', policy)).toBe(true);
    expect(isAllowedMediaUrl('https://evilmedia.example.eu/k', policy)).toBe(false);
    expect(isAllowedMediaUrl('https://media.example.eu.evil.pl/k', policy)).toBe(false);
  });

  it('EVM-142 AC5: plain http passes only for the emulator hosts of the e2e variant', () => {
    expect(isAllowedMediaUrl('http://10.0.2.2:9000/k', { allowLocalHttp: true })).toBe(true);
    expect(isAllowedMediaUrl('http://localhost:9000/k', { allowLocalHttp: true })).toBe(true);
    expect(isAllowedMediaUrl('http://10.0.2.2:9000/k')).toBe(false);
    expect(isAllowedMediaUrl('http://media.example.eu/k', { allowLocalHttp: true })).toBe(false);
  });
});
