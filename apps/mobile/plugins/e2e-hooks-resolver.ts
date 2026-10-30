/**
 * Choice of the e2e hooks at BUNDLE time (EVM-093; security K1, SR-MOB-11, CWE-489). The app imports `src/e2e-hooks/index.ts`, an
 * empty slot without logic. Only when Metro bundles the e2e variant (EVIA_BUILD_VARIANT=e2e, set by tools/mobile-e2e for the Gradle
 * build) this resolver swaps that one file for `src/e2e-hooks/panel.tsx`. Any other value — or none — is the release variant
 * (fail closed, `resolveBuildVariant`): no module imports the panel, so it cannot reach the release bundle; `tools/mobile-apk verify`
 * proves it by searching the marker of the panel in the bundle.
 * No EXPO_PUBLIC_* variable is involved (the API address stays the only public variable of the bundle).
 */
import { resolve } from 'node:path';
import { resolveBuildVariant } from '../src/config/api-base-url.ts';

export const E2E_HOOKS_SLOT = ['src', 'e2e-hooks', 'index.ts'] as const;
export const E2E_HOOKS_PANEL = ['src', 'e2e-hooks', 'panel.tsx'] as const;

export interface Resolution {
  readonly type: string;
  readonly filePath?: string;
}
export interface ResolutionContext {
  readonly resolveRequest: ResolveRequest;
}
export type ResolveRequest = (context: ResolutionContext, moduleName: string, platform: string | null) => Resolution;

/** Windows paths differ in case and separators between tools. */
const same = (a: string, b: string): boolean => resolve(a).toLowerCase() === resolve(b).toLowerCase();

/**
 * @param variantValue `EVIA_BUILD_VARIANT` of the bundling process
 * @param appRoot directory of apps/mobile
 * @returns `resolveRequest` of the Metro configuration: the default resolution, with the slot swapped in the e2e variant only
 */
export function e2eHooksResolver(variantValue: string | undefined, appRoot: string): ResolveRequest {
  const variant = resolveBuildVariant(variantValue);
  const slot = resolve(appRoot, ...E2E_HOOKS_SLOT);
  const panel = resolve(appRoot, ...E2E_HOOKS_PANEL);
  return (context, moduleName, platform) => {
    const resolution = context.resolveRequest(context, moduleName, platform);
    if (variant !== 'e2e' || resolution.type !== 'sourceFile' || resolution.filePath === undefined) return resolution;
    return same(resolution.filePath, slot) ? { type: 'sourceFile', filePath: panel } : resolution;
  };
}
