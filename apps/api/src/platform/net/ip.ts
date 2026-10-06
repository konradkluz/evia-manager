/**
 * IP address helpers shared by the rate limiter (prefix /32 and /64) and the audit module (prefix /24 and /48,
 * P9). Pure functions over text: IPv4-mapped IPv6 addresses are folded to IPv4, zone identifiers are dropped, an
 * unparsable value gives `null` (never a guess).
 */
import { isIPv4, isIPv6 } from 'node:net';

const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

function parseIpv4(text: string): number[] | null {
  if (!isIPv4(text)) return null;
  return text.split('.').map(Number);
}

/** @returns the eight 16-bit groups of an IPv6 address, or null */
function parseIpv6(text: string): number[] | null {
  if (!isIPv6(text)) return null;
  let address = text;
  const embedded = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (embedded?.[1] !== undefined) {
    const octets = parseIpv4(embedded[1]);
    if (octets === null) return null;
    const high = ((octets[0] ?? 0) << 8) | (octets[1] ?? 0);
    const low = ((octets[2] ?? 0) << 8) | (octets[3] ?? 0);
    address = `${address.slice(0, address.length - embedded[1].length)}${high.toString(16)}:${low.toString(16)}`;
  }
  const [head = '', tail, ...rest] = address.split('::');
  if (rest.length > 0) return null;
  const left = head === '' ? [] : head.split(':');
  const right = tail === undefined || tail === '' ? [] : tail.split(':');
  const missing = 8 - left.length - right.length;
  if (tail === undefined ? missing !== 0 : missing < 1) return null;
  const groups = [...left, ...Array.from({ length: tail === undefined ? 0 : missing }, () => '0'), ...right].map((group) =>
    Number.parseInt(group, 16),
  );
  return groups.length === 8 && groups.every((group) => Number.isInteger(group) && group >= 0 && group <= 0xffff) ? groups : null;
}

export type ParsedIp =
  { readonly version: 4; readonly octets: readonly number[] } | { readonly version: 6; readonly groups: readonly number[] };

export function parseIp(raw: string): ParsedIp | null {
  const text = raw.trim().split('%')[0] ?? '';
  const mapped = IPV4_MAPPED.exec(text);
  const candidate = mapped?.[1] ?? text;
  const octets = parseIpv4(candidate);
  if (octets !== null) return { version: 4, octets };
  const groups = parseIpv6(candidate);
  return groups === null ? null : { version: 6, groups };
}

const hex = (group: number): string => group.toString(16);

/**
 * @param v4Bits prefix length kept for IPv4 (24 or 32)
 * @param v6Bits prefix length kept for IPv6 (48 or 64)
 * @returns canonical prefix text (`192.0.2.0/24`, `2001:db8:1::/48`), or null for an unparsable address
 */
export function ipPrefix(raw: string, v4Bits: 24 | 32, v6Bits: 48 | 64): string | null {
  const ip = parseIp(raw);
  if (ip === null) return null;
  if (ip.version === 4) {
    const kept = ip.octets.map((octet, index) => (index < v4Bits / 8 ? octet : 0));
    return `${kept.join('.')}/${v4Bits}`;
  }
  const keptGroups = v6Bits / 16;
  const head = ip.groups.slice(0, keptGroups).map(hex).join(':');
  return `${head}::/${v6Bits}`;
}
