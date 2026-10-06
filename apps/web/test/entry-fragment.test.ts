import { afterEach, describe, expect, it, vi } from 'vitest';

const TOKEN = 'Q'.repeat(43);

afterEach(() => {
  globalThis.history.replaceState(null, '', '/');
  vi.resetModules();
});

describe('the entry point strips the fragment before the router exists (EVM-016 AC5)', () => {
  // First on purpose: every import of the capture module adds a listener to the (shared) window.
  it('EVM-016 AC5 a link opened in the tab that already shows the page (fragment-only navigation) is taken in and stripped too', async () => {
    await import('../src/activation/capture-fragment.ts');
    const { getActivationToken } = await import('../src/activation/activation-token.ts');
    globalThis.history.replaceState(null, '', '/activate');
    expect(getActivationToken()).toBeNull();
    globalThis.location.hash = `#${TOKEN}`;
    await vi.waitFor(() => {
      expect(globalThis.location.hash).toBe('');
    });
    expect(getActivationToken()).toBe(TOKEN);
    expect(globalThis.location.href).not.toContain(TOKEN);
  });

  it('EVM-016 AC5 importing the capture module alone removes the token from the address and keeps it in memory', async () => {
    globalThis.history.replaceState(null, '', `/activate#${TOKEN}`);
    await import('../src/activation/capture-fragment.ts');
    const { getActivationToken } = await import('../src/activation/activation-token.ts');
    expect(globalThis.location.pathname).toBe('/activate');
    expect(globalThis.location.hash).toBe('');
    expect(getActivationToken()).toBe(TOKEN);
  });

  it('EVM-016 AC5 main.tsx imports the capture module first, so no later module can read the fragment', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/main.tsx', 'utf8');
    const imports = [...source.matchAll(/^import\s+(?:[^'\n]*from\s+)?'([^']+)';/gm)].map((match) => match[1]);
    expect(imports[0]).toBe('./activation/capture-fragment.ts');
  });
});
