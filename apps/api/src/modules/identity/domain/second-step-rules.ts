/**
 * The rule of the methods of the second step (EVM-028 AC4, EVM-134 AC3; SR-AUTH-10, ADR-0023) as a pure function: what an account must keep.
 *
 * Every account — the Administrator's too (ADR-0023: a code of the app is a method of the panel for every role) — keeps at least one METHOD: a passkey or
 * an active code of the app. Recovery codes are a way back in, not a method.
 *
 * `methods` is what the account has BEFORE the removal. The decision is taken under the lock of the row of the account, so two parallel removals (two keys,
 * or a key and the code) cannot both pass (the caller's job).
 */
export type RemovableMethod = 'passkey' | 'totp';

export interface MethodCounts {
  readonly passkeys: number;
  readonly totp: boolean;
}

/** May one method go? Only when the account keeps another one. */
export function canRemoveMethod(methods: MethodCounts): boolean {
  return methods.passkeys + (methods.totp ? 1 : 0) > 1;
}
