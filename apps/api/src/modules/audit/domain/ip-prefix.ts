/**
 * "Where from" of an audit event (P9; AC7): the address is cut to /24 (IPv4) or /48 (IPv6) before it reaches the audit
 * table, which is append-only and cannot be erased. Only `audit` does this — the publishers pass the full address in memory.
 * An unparsable value gives null (nothing is stored rather than a guess).
 */
import { ipPrefix } from '../../../platform/net/ip.ts';

export function truncateIp(address: string | undefined): string | null {
  return address === undefined ? null : ipPrefix(address, 24, 48);
}
