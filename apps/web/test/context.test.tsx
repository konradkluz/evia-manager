import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useApi } from '../src/api/api-context.tsx';
import { useToast } from '../src/shell/toast-context.tsx';

describe('contexts of the panel (EVM-016 AC3, AC4)', () => {
  it('EVM-016 AC3 a page outside the API provider fails loudly instead of calling a default client', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const Page = () => {
      useApi();
      return null;
    };
    expect(() => render(<Page />)).toThrow('useApi outside ApiProvider');
    vi.restoreAllMocks();
  });

  it('EVM-016 AC4 a toast raised outside the provider is a harmless no-op', () => {
    const Page = () => {
      useToast()('Zapisano.');
      return <p>ok</p>;
    };
    render(<Page />);
    expect(screen.getByText('ok')).toBeTruthy();
  });
});
