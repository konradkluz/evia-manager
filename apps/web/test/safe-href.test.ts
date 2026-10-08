import { describe, expect, it } from 'vitest';
import { mailtoHref, safeHref, telHref } from '../src/work-orders/safe-href.ts';

describe('safeHref — which addresses from data may be links (EVM-018 AC4; SR-WEB-03)', () => {
  it('EVM-018 AC4 https, tel and mailto become links', () => {
    expect(safeHref('https://example.invalid/a?b=1')).toBe('https://example.invalid/a?b=1');
    expect(safeHref('HTTPS://Example.invalid/')).toBe('https://example.invalid/');
    expect(safeHref('tel:+48600000001')).toBe('tel:+48600000001');
    expect(safeHref('mailto:jan@example.invalid')).toBe('mailto:jan@example.invalid');
  });

  it.each([
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'javascript:alert(1) ',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    'java\rscript:alert(1)',
    '\u0000javascript:alert(1)',
    '\u0001javascript:alert(1)',
    ' javascript:alert(1)',
    'jav&#x61;script:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'DATA:text/html;base64,PHNjcmlwdD4=',
    'vbscript:msgbox(1)',
    'http://example.invalid/',
    'HTTP://example.invalid/',
    'file:///etc/passwd',
    'ftp://example.invalid/',
    'blob:https://example.invalid/x',
    'https:example.invalid',
    'https:/example.invalid',
    'https://user:pass@example.invalid/',
    'https://user@example.invalid/',
    'https://',
    '//example.invalid/',
    '/relative',
    'example.invalid',
    '',
    'https://example.invalid/ x',
    'https://example.invalid/​',
    `https://example.invalid/${'a'.repeat(2100)}`,
    'tel:',
    'mailto:',
  ])('EVM-018 AC4 %j is not a link', (raw) => {
    expect(safeHref(raw)).toBeUndefined();
  });

  it('EVM-018 AC4 a mailto or tel address keeps no query: no cc, bcc or body can be added by a note', () => {
    expect(safeHref('mailto:jan@example.invalid?cc=ktos@example.invalid&bcc=inny@example.invalid&body=x')).toBe(
      'mailto:jan@example.invalid',
    );
    expect(safeHref('tel:+48600000001?x=1#f')).toBe('tel:+48600000001');
  });

  it('EVM-018 AC4 the telephone and the e-mail of a customer are built from the encoded value', () => {
    expect(telHref('+48600000001')).toBe('tel:+48600000001');
    expect(telHref('+48600000001;ext=1')).toBe('tel:+48600000001%3Bext%3D1');
    expect(mailtoHref('jan@example.invalid')).toBe('mailto:jan%40example.invalid');
    expect(mailtoHref('jan@example.invalid?cc=ktos@example.invalid')).toBe('mailto:jan%40example.invalid%3Fcc%3Dktos%40example.invalid');
    expect(mailtoHref('jan@example.invalid?cc=ktos@example.invalid')).not.toContain('?');
    expect(telHref('+48 600\n000')).toBe('tel:+48%20600%0A000');
  });
});
