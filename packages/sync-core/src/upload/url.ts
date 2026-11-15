const MAX_URL_LENGTH = 4096;
const HTTPS = 'https://';
const PRINTABLE_ASCII = /^[!-~]+$/;
const HOST = /^[a-z0-9.-]+$/;
const PORT = /^[0-9]{1,5}$/;

/**
 * Checks the address of a part before any byte is sent (EVM-109 AC3, MASVS-NETWORK-1): scheme `https`, no userinfo, host exactly from
 * the allowlist (case-insensitive, no suffix or IP tricks), port default (443) or listed explicitly (`host:port`).
 */
export function isTrustedPartUrl(url: string, allowedHosts: readonly string[]): boolean {
  if (url.length > MAX_URL_LENGTH || !PRINTABLE_ASCII.test(url) || url.includes('\\')) return false;
  if (url.slice(0, HTTPS.length).toLowerCase() !== HTTPS) return false;
  const rest = url.slice(HTTPS.length);
  const authority = rest.slice(0, rest.search(/[/?#]|$/)).toLowerCase();
  if (authority === '' || authority.includes('@') || authority.startsWith('[')) return false;
  const colon = authority.lastIndexOf(':');
  const host = colon < 0 ? authority : authority.slice(0, colon);
  const port = colon < 0 ? '' : authority.slice(colon + 1);
  if (!HOST.test(host) || (port !== '' && !PORT.test(port))) return false;
  const effective = port === '' ? '443' : String(Number(port));
  return allowedHosts.some((entry) => {
    const listed = entry.toLowerCase();
    const at = listed.lastIndexOf(':');
    return at < 0 ? listed === host && effective === '443' : listed.slice(0, at) === host && listed.slice(at + 1) === effective;
  });
}
