import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEV_PANEL_ORIGIN, resolvePanelOrigin } from '../panel-origin.ts';

const RELEASE = { EVIA_RELEASE_BUILD: 'true' };

describe('panel address baked into the build (EVM-126 AC3, AC4)', () => {
  it('EVM-126 AC3: a release build gets the address of the environment and nothing else', () => {
    expect(resolvePanelOrigin({ ...RELEASE, PANEL_ORIGIN: 'https://panel.eviacharge.pl' })).toBe('https://panel.eviacharge.pl');
  });

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['not a URL', 'panel.eviacharge.pl'],
    ['http', 'http://panel.eviacharge.pl'],
    ['localhost', 'https://localhost:5173'],
    ['loopback', 'https://127.0.0.1'],
    ['a path', 'https://panel.eviacharge.pl/login'],
    ['the development default', DEV_PANEL_ORIGIN],
  ])('EVM-126 AC3: a release build fails when PANEL_ORIGIN is %s (no localhost in the production image)', (_name, value) => {
    expect(() => resolvePanelOrigin({ ...RELEASE, PANEL_ORIGIN: value })).toThrow(/PANEL_ORIGIN/);
  });

  it('EVM-126 AC4: development and CI builds keep the local address, or the configured one', () => {
    expect(resolvePanelOrigin({})).toBe('http://localhost:5173');
    expect(resolvePanelOrigin({ PANEL_ORIGIN: 'http://localhost:5173' })).toBe('http://localhost:5173');
    expect(resolvePanelOrigin({ PANEL_ORIGIN: 'https://panel.evia.test' })).toBe('https://panel.evia.test');
    expect(resolvePanelOrigin({ EVIA_RELEASE_BUILD: 'false' })).toBe('http://localhost:5173');
  });

  it('EVM-126 AC3: the release Dockerfile and the publish job pass the panel address to the build of the web image', () => {
    const dockerfile = readFileSync('../../infra/images/web/Dockerfile', 'utf8');
    expect(dockerfile).toMatch(/^ARG PANEL_ORIGIN$/m);
    expect(dockerfile).toMatch(/EVIA_RELEASE_BUILD=true/);
    expect(dockerfile.indexOf('EVIA_RELEASE_BUILD=true')).toBeLessThan(dockerfile.indexOf('@evia/web run build'));
    const workflow = readFileSync('../../.github/workflows/ci.yml', 'utf8');
    expect(workflow).toContain('--build-arg PANEL_ORIGIN=https://panel.eviacharge.pl');
    expect(readFileSync('../../infra/images/web/Dockerfile.dockerignore', 'utf8')).toMatch(/^!apps\/web\/panel-origin\.ts$/m);
  });
});
