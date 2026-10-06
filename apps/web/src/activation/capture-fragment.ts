// Side-effect module imported FIRST by main.tsx: ES modules evaluate in import order, so the fragment is removed
// before the router is created and before any later module (telemetry SDK, EVM-076) can read the address.
import { captureActivationToken } from './activation-token.ts';

captureActivationToken(globalThis.location, globalThis.history);

// A link opened in a tab that already shows the activation page only changes the fragment (no reload): take it in too.
globalThis.addEventListener('hashchange', () => {
  captureActivationToken(globalThis.location, globalThis.history);
});
