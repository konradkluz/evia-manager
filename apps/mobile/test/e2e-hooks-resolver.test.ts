import { join } from 'node:path';
import { E2E_HOOKS_PANEL, E2E_HOOKS_SLOT, e2eHooksResolver, type Resolution, type ResolutionContext } from '../plugins/e2e-hooks-resolver';

const ROOT = join(__dirname, '..');
const slot = join(ROOT, ...E2E_HOOKS_SLOT);
const panel = join(ROOT, ...E2E_HOOKS_PANEL);

/** The default resolution of Metro, as a fake: every module name maps to a fixed answer. */
function contextAnswering(answer: Resolution): ResolutionContext & { calls: string[] } {
  const calls: string[] = [];
  const context: ResolutionContext & { calls: string[] } = {
    calls,
    resolveRequest: (_context, moduleName) => {
      calls.push(moduleName);
      return answer;
    },
  };
  return context;
}

describe('bundle-time choice of the e2e hooks (EVM-093 AC1; security K1, SR-MOB-11)', () => {
  it('EVM-093 AC1: in the release variant — and with no or any other variant value — the empty slot stays (fail closed)', () => {
    for (const variant of [undefined, '', 'release', 'E2E', 'e2e ', 'debug']) {
      const context = contextAnswering({ type: 'sourceFile', filePath: slot });
      expect(e2eHooksResolver(variant, ROOT)(context, './e2e-hooks', 'android')).toEqual({ type: 'sourceFile', filePath: slot });
    }
  });

  it('EVM-093 AC1: only the e2e variant swaps the slot for the panel, after the default resolution', () => {
    const context = contextAnswering({ type: 'sourceFile', filePath: slot });
    expect(e2eHooksResolver('e2e', ROOT)(context, './e2e-hooks', 'android')).toEqual({ type: 'sourceFile', filePath: panel });
    expect(context.calls).toEqual(['./e2e-hooks']);
  });

  it('EVM-093 AC1: paths are compared regardless of case and separators (Windows build)', () => {
    const context = contextAnswering({ type: 'sourceFile', filePath: slot.toUpperCase().replaceAll('\\', '/') });
    expect(e2eHooksResolver('e2e', ROOT)(context, './e2e-hooks', 'android')).toEqual({ type: 'sourceFile', filePath: panel });
  });

  it('EVM-093 AC1: every other module and every non-file resolution passes through unchanged in the e2e variant', () => {
    const other = { type: 'sourceFile', filePath: join(ROOT, 'src', 'App.tsx') };
    expect(e2eHooksResolver('e2e', ROOT)(contextAnswering(other), './App', 'android')).toBe(other);
    const empty = { type: 'empty' };
    expect(e2eHooksResolver('e2e', ROOT)(contextAnswering(empty), 'fs', 'android')).toBe(empty);
    const asset = { type: 'assetFiles' };
    expect(e2eHooksResolver('e2e', ROOT)(contextAnswering(asset), './icon.png', null)).toBe(asset);
  });
});
