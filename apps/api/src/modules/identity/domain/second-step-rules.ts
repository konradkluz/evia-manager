/**
 * The rules of the methods of the second step (EVM-028 AC4; SR-AUTH-10, P1) as a pure function: what an account must keep.
 *
 * - An Administrator needs at least ONE PASSKEY (P1: in the panel an Administrator signs in with a key only). A code of the app does not count for the
 *   Administrator — it serves the mobile application — and recovery codes are a way back in, not a method.
 * - Every other account needs at least one METHOD: a passkey or an active code of the app. Recovery codes are not a method.
 *
 * `methods` is what the account has BEFORE the removal. The decision is taken under the lock of the row of the account, so two parallel removals cannot
 * both pass (the caller's job).
 */
export type RemovableMethod = 'passkey' | 'totp';

export interface MethodCounts {
  readonly passkeys: number;
  readonly totp: boolean;
}

export type RemovalVerdict = { readonly allowed: true } | { readonly allowed: false; readonly required: 'passkey' | 'method' };

export function canRemoveMethod(
  role: 'administrator' | 'editor' | 'read_only',
  methods: MethodCounts,
  target: RemovableMethod,
): RemovalVerdict {
  if (role === 'administrator') {
    // The code of the app is no method of an Administrator: removing it never leaves the account without the key it needs.
    if (target === 'totp') return { allowed: true };
    return methods.passkeys > 1 ? { allowed: true } : { allowed: false, required: 'passkey' };
  }
  const total = methods.passkeys + (methods.totp ? 1 : 0);
  return total > 1 ? { allowed: true } : { allowed: false, required: 'method' };
}
