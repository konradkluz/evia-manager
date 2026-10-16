import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { QrCode } from '../src/index.ts';
import { axeViolations } from './a11y.ts';

const URI = 'otpauth://totp/EVia%20Manager:anna.testowa%40example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=EVia%20Manager';

describe('QrCode (W-03 step 2; EVM-023 AC1)', () => {
  it('EVM-023 AC1 draws a vector picture with a name, from the module matrix, without the value in the DOM as text', async () => {
    const { container } = render(<QrCode value={URI} label="Kod QR do zeskanowania w aplikacji uwierzytelniającej" />);
    const picture = screen.getByRole('img', { name: 'Kod QR do zeskanowania w aplikacji uwierzytelniającej' });
    expect(picture.tagName.toLowerCase()).toBe('svg');
    const path = picture.querySelector('path');
    expect(path?.getAttribute('d')?.startsWith('M')).toBe(true);
    // A square matrix with the quiet zone of 4 modules on every side.
    const [x, y, width, height] = (picture.getAttribute('viewBox') ?? '').split(' ').map(Number);
    expect(x).toBe(-4);
    expect(y).toBe(-4);
    expect(width).toBe(height);
    expect(width).toBeGreaterThan(29);
    expect(container.textContent).not.toContain('JBSWY3DP');
    expect(container.innerHTML).not.toContain('JBSWY3DP');
    expect(container.querySelector('script, image, foreignObject')).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('EVM-023 AC1 another value gives another picture', () => {
    const first = render(<QrCode value={URI} label="QR" />);
    const a = first.container.querySelector('path')?.getAttribute('d');
    first.unmount();
    const second = render(<QrCode value={`${URI}x`} label="QR" />);
    expect(second.container.querySelector('path')?.getAttribute('d')).not.toBe(a);
  });
});
