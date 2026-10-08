import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LinkedText } from '../src/work-orders/linked-text.tsx';

describe('text with links (EVM-018 AC4; SR-WEB-03)', () => {
  it('EVM-018 AC4 a script and a javascript: address are text; https, tel and mailto are links with rel noopener noreferrer', () => {
    const { container } = render(
      <p>
        <LinkedText text="<script>alert(1)</script> javascript:alert(1) https://example.invalid/mapa. tel:+48600000001, mailto:biuro@example.invalid?cc=x@example.invalid" />
      </p>,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script> javascript:alert(1)');
    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      'https://example.invalid/mapa',
      'tel:+48600000001',
      'mailto:biuro@example.invalid',
    ]);
    for (const link of links) expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(container.textContent).toContain('https://example.invalid/mapa.');
  });

  it('EVM-018 AC4 uppercase schemes, other schemes and an address with a name in it are handled', () => {
    const { container } = render(
      <p>
        <LinkedText
          text={
            'HTTPS://example.invalid/a JAVASCRIPT:alert(1) data:text/html,x http://example.invalid ... ))) \n https://u:p@example.invalid/'
          }
        />
      </p>,
    );
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['https://example.invalid/a']);
    expect(container.textContent).toContain('JAVASCRIPT:alert(1) data:text/html,x http://example.invalid');
  });

  it('EVM-018 AC4 a long run of punctuation is read in linear time', () => {
    const started = performance.now();
    render(
      <p>
        <LinkedText text={`${'!'.repeat(50_000)}x ${'a '.repeat(10_000)}`} />
      </p>,
    );
    expect(performance.now() - started).toBeLessThan(5000);
  });
});
