// Side-effect module imported FIRST by main.tsx: ES modules evaluate in import order, so the fragment is removed
// before the router is created and before any later module (telemetry SDK, EVM-076) can read the address.
import { captureActivationToken } from './activation-token.ts';

captureActivationToken(globalThis.location, globalThis.history);
