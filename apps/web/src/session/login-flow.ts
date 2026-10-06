/**
 * State of a login that must survive a change of page but never a refresh of the tab (SR-WEB-05, TM-10): the one-time
 * `loginToken` of the first step with the validated `returnTo`, and the notice "Sesja wygasła…" for W-01. Memory of the
 * tab only — never localStorage, sessionStorage, IndexedDB, the URL or the title. The password is not here at all: it
 * lives in the state of the form of W-01 and is dropped as soon as the first step is answered.
 */
export interface LoginFlow {
  readonly loginToken: string;
  /** Already resolved with `resolveReturnTo` (a relative path of the panel). */
  readonly returnTo: string;
}

export type LoginNotice = 'expired';

let flow: LoginFlow | null = null;
let notice: LoginNotice | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeLoginFlow(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getLoginFlow(): LoginFlow | null {
  return flow;
}

export function setLoginFlow(value: LoginFlow | null): void {
  flow = value;
  emit();
}

export function getLoginNotice(): LoginNotice | null {
  return notice;
}

export function setLoginNotice(value: LoginNotice | null): void {
  notice = value;
  emit();
}
