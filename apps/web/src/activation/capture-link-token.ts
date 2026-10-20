import { RESET_PASSWORD_PATH } from '../paths.ts';
import { captureResetToken } from '../reset/reset-token.ts';
import { captureActivationToken } from './activation-token.ts';

/**
 * Takes the token of a one-time link out of the address (EVM-016 AC5, EVM-025 AC2): the fragment of the reset page goes to the
 * memory of the reset page, every other fragment is handled as before (the activation page, any token-shaped fragment).
 * The two memories never mix, so an activation link opened on the reset page (and the other way round) finds no token.
 */
export function captureLinkToken(
  location: Pick<Location, 'pathname' | 'search' | 'hash'>,
  history: Pick<History, 'replaceState' | 'state'>,
): void {
  if (location.pathname === RESET_PASSWORD_PATH) captureResetToken(location, history);
  else captureActivationToken(location, history);
}
