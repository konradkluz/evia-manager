import { describe, expect, it } from 'vitest';
import { ipPrefix, parseIp } from '../../src/platform/net/ip.ts';

describe('IP prefixes (EVM-016 AC7, W1; P9)', () => {
  it.each([
    ['192.0.2.77', '192.0.2.0/24'],
    ['198.51.100.255', '198.51.100.0/24'],
    ['::ffff:203.0.113.9', '203.0.113.0/24'],
    ['::FFFF:203.0.113.9', '203.0.113.0/24'],
    ['2001:db8:abcd:1234:5678:9abc:def0:1234', '2001:db8:abcd::/48'],
    ['2001:DB8:ABCD:1::1', '2001:db8:abcd::/48'],
    ['2001:db8::1', '2001:db8:0::/48'],
    ['::1', '0:0:0::/48'],
    ['fe80::1%eth0', 'fe80:0:0::/48'],
    ['64:ff9b::192.0.2.33', '64:ff9b:0::/48'],
  ])('EVM-016 AC7 %s is kept as %s (/24 for IPv4, /48 for IPv6)', (address, prefix) => {
    expect(ipPrefix(address, 24, 48)).toBe(prefix);
  });

  it('EVM-016 AC7 the rate limiter keeps the whole IPv4 address and the /64 of an IPv6 address', () => {
    expect(ipPrefix('192.0.2.77', 32, 64)).toBe('192.0.2.77/32');
    expect(ipPrefix('2001:db8:1:2:aaaa:bbbb:cccc:dddd', 32, 64)).toBe('2001:db8:1:2::/64');
    expect(ipPrefix('2001:db8:1:2::1', 32, 64)).toBe(ipPrefix('2001:db8:1:2:ffff::', 32, 64));
    expect(ipPrefix('2001:db8:1:3::1', 32, 64)).not.toBe(ipPrefix('2001:db8:1:2::1', 32, 64));
  });

  it.each([
    '',
    'not an address',
    '999.1.1.1',
    '1.2.3',
    '2001:db8::1::2',
    '2001:db8:1',
    'g::1',
    '1:2:3:4:5:6:7:8:9',
    '::ffff:999.1.1.1',
    '1.2.3.4.5',
  ])('EVM-016 AC7 %j is not an address (nothing is guessed)', (value) => {
    expect(parseIp(value)).toBeNull();
    expect(ipPrefix(value, 24, 48)).toBeNull();
  });

  it('EVM-016 AC7 parses all eight groups of a full IPv6 address and leading or trailing compression', () => {
    expect(parseIp('1:2:3:4:5:6:7:8')).toEqual({ version: 6, groups: [1, 2, 3, 4, 5, 6, 7, 8] });
    expect(parseIp('::8')).toEqual({ version: 6, groups: [0, 0, 0, 0, 0, 0, 0, 8] });
    expect(parseIp('1::')).toEqual({ version: 6, groups: [1, 0, 0, 0, 0, 0, 0, 0] });
    expect(parseIp('1:2:3:4:5:6:7::')).toEqual({ version: 6, groups: [1, 2, 3, 4, 5, 6, 7, 0] });
  });
});
