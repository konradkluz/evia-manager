/**
 * Slot of the e2e hooks (EVM-093; security K1): in every bundle but the e2e variant this file is all there is — no logic, no import.
 * When Metro bundles the e2e variant, plugins/e2e-hooks-resolver.ts resolves this module to ./panel.tsx instead (same export).
 * Nothing else may import the panel (test design-rules), so it cannot reach a release bundle.
 */
export function E2eHooks(): null {
  return null;
}
