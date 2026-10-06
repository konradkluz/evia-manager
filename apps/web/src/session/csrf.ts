/**
 * CSRF token of the session (SR-SESS-10): in the memory of the tab only — never in storage, the URL or the title.
 * It changes with the session (rotation at activation and at registering the key), so it is replaced on every
 * answer that carries one and dropped when the session ends.
 */
let token: string | null = null;

export function setCsrfToken(value: string | null): void {
  token = value;
}

export function getCsrfToken(): string | null {
  return token;
}
