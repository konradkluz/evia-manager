/**
 * Which address the phone may fetch an image from (SR-MOB-10, MASVS-NETWORK-1): the signed address of the server must be `https:` (plain `http:` only for the
 * emulator host of the e2e variant, like the API address), without credentials in it, a named host (no IP literal, no single-label name) and - when the build
 * knows the domain of the bucket - that domain or its subdomain. Checked BEFORE the request, so a wrong address never leaves the phone.
 * The server does not announce the domain of the bucket today (see the report of EVM-142); until it does, `allowedHost` stays unset.
 */
const URL_PATTERN = /^([a-z][a-z0-9+.-]*):\/\/([^\s/?#@]+)([/?#]\S*)?$/i;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const LOCAL_HTTP_HOSTS: readonly string[] = ['10.0.2.2', 'localhost', '127.0.0.1'];

export interface MediaUrlPolicy {
  readonly allowLocalHttp?: boolean;
  /** The domain of the bucket (`media.example.eu`); the address must be on it or under it. */
  readonly allowedHost?: string;
}

export function isAllowedMediaUrl(url: string, policy: MediaUrlPolicy = {}): boolean {
  const match = URL_PATTERN.exec(url);
  const scheme = match?.[1]?.toLowerCase();
  const authority = match?.[2];
  if (scheme === undefined || authority === undefined) return false;
  const host = authority.replace(/:\d{1,5}$/, '').toLowerCase();
  if (host === '' || host.includes(':')) return false;
  if (scheme === 'http') return policy.allowLocalHttp === true && LOCAL_HTTP_HOSTS.includes(host);
  if (scheme !== 'https') return false;
  if (IPV4.test(host) || !host.includes('.')) return false;
  if (policy.allowedHost === undefined) return true;
  const allowed = policy.allowedHost.toLowerCase();
  return host === allowed || host.endsWith(`.${allowed}`);
}
