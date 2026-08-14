import {
  blockKeyForIp,
  cidrContains,
  normalizeIp,
  parseCidr,
  resolveClientIp,
} from './client-ip.util';

describe('normalizeIp', () => {
  it('passes plain IPv4 through', () => {
    expect(normalizeIp('203.0.113.7')).toBe('203.0.113.7');
  });

  it('strips the IPv4-mapped IPv6 prefix Node adds on dual-stack sockets', () => {
    expect(normalizeIp('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  it('lowercases and trims IPv6', () => {
    expect(normalizeIp('  2001:DB8::1  ')).toBe('2001:db8::1');
  });

  it('rejects garbage, empty, and injection-looking input', () => {
    expect(normalizeIp('not-an-ip')).toBeUndefined();
    expect(normalizeIp('')).toBeUndefined();
    expect(normalizeIp(undefined)).toBeUndefined();
    expect(normalizeIp('1.2.3.4; DROP TABLE')).toBeUndefined();
    expect(normalizeIp('999.1.1.1')).toBeUndefined();
  });
});

describe('blockKeyForIp', () => {
  it('keys IPv4 exactly', () => {
    expect(blockKeyForIp('203.0.113.7')).toBe('203.0.113.7');
  });

  it('keys IPv6 by /64 so subnet rotation cannot evade a block', () => {
    expect(blockKeyForIp('2001:db8:aa:bb:1:2:3:4')).toBe('2001:db8:aa:bb::/64');
    // A different host in the same /64 must produce the SAME key…
    expect(blockKeyForIp('2001:db8:aa:bb:ffff::9')).toBe('2001:db8:aa:bb::/64');
    // …and a neighbouring /64 a different one.
    expect(blockKeyForIp('2001:db8:aa:bc::1')).toBe('2001:db8:aa:bc::/64');
  });

  it('handles compressed zero groups', () => {
    expect(blockKeyForIp('2001:db8::1')).toBe('2001:db8:0:0::/64');
  });

  it('returns undefined for invalid input', () => {
    expect(blockKeyForIp('nope')).toBeUndefined();
  });
});

describe('parseCidr / cidrContains', () => {
  it('matches inside and outside an IPv4 range', () => {
    const cidr = parseCidr('10.0.0.0/8')!;
    expect(cidrContains(cidr, '10.255.1.2')).toBe(true);
    expect(cidrContains(cidr, '11.0.0.1')).toBe(false);
  });

  it('treats a bare IP as a full-length prefix', () => {
    const cidr = parseCidr('203.0.113.7')!;
    expect(cidrContains(cidr, '203.0.113.7')).toBe(true);
    expect(cidrContains(cidr, '203.0.113.8')).toBe(false);
  });

  it('matches IPv6 /64 ranges', () => {
    const cidr = parseCidr('2001:db8:aa:bb::/64')!;
    expect(cidrContains(cidr, '2001:db8:aa:bb:dead:beef::1')).toBe(true);
    expect(cidrContains(cidr, '2001:db8:aa:bc::1')).toBe(false);
  });

  it('handles the /0 and single-host edges', () => {
    expect(cidrContains(parseCidr('0.0.0.0/0')!, '8.8.8.8')).toBe(true);
    const host = parseCidr('1.2.3.4/32')!;
    expect(cidrContains(host, '1.2.3.4')).toBe(true);
    expect(cidrContains(host, '1.2.3.5')).toBe(false);
  });

  it('rejects malformed CIDRs', () => {
    expect(parseCidr('10.0.0.0/33')).toBeNull();
    expect(parseCidr('10.0.0.0/-1')).toBeNull();
    expect(parseCidr('banana/8')).toBeNull();
    expect(parseCidr('2001:db8::/129')).toBeNull();
  });

  it('never matches a v4 range against a v6 address or vice versa', () => {
    expect(cidrContains(parseCidr('10.0.0.0/8')!, '2001:db8::1')).toBe(false);
    expect(cidrContains(parseCidr('2001:db8::/32')!, '10.1.1.1')).toBe(false);
  });
});

describe('resolveClientIp', () => {
  it('uses the socket address by default, ignoring spoofable headers', () => {
    expect(
      resolveClientIp(
        {
          headers: { 'cf-connecting-ip': '6.6.6.6' },
          remoteAddress: '203.0.113.7',
        },
        { trustCloudflare: false },
      ),
    ).toBe('203.0.113.7');
  });

  it('honours cf-connecting-ip only when Cloudflare trust is on', () => {
    expect(
      resolveClientIp(
        {
          headers: { 'cf-connecting-ip': '198.51.100.9' },
          remoteAddress: '172.70.1.1',
        },
        { trustCloudflare: true },
      ),
    ).toBe('198.51.100.9');
  });

  it('falls back to the socket when the trusted header is garbage', () => {
    expect(
      resolveClientIp(
        {
          headers: { 'cf-connecting-ip': 'malicious\r\nstring' },
          remoteAddress: '203.0.113.7',
        },
        { trustCloudflare: true },
      ),
    ).toBe('203.0.113.7');
  });
});
