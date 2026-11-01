/**
 * Slot of the e2e hooks (EVM-093; security K1): in every bundle but the e2e variant this file is all there is — no logic, no import
 * of the panel. When Metro bundles the e2e variant, plugins/e2e-hooks-resolver.ts resolves this module to ./panel.tsx instead (same
 * exports). Nothing else may import the panel (test design-rules), so it cannot reach a release bundle.
 * EVM-101 (security K7): the device controls (screen lock, contact time, background time) are steered through `deviceOverrides`,
 * which is `null` here — the release bundle has no setter and no override of those answers.
 */
export function E2eHooks(): null {
  return null;
}

export const deviceOverrides: import('../device-guard/overrides').DeviceOverrides | null = null;
