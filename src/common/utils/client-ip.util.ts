import { isIP } from 'net';

/**
 * The one place in the codebase that decides "which IP is this request from".
 * HTTP middleware, the throttler, the auto-blocker and the chat gateway must
 * all agree on the answer, or a block applied from one view of the client
 * silently fails to match another.
 *
 * Header trust is deliberate, not automatic:
 * - `cf-connecting-ip` is honoured only when SECURITY_TRUST_CLOUDFLARE is on,
 *   which must only be enabled once the origin firewall admits Cloudflare's
 *   ranges exclusively. App code cannot verify the range list better than the
 *   firewall can, and trusting the header without that fence lets any client
 *   choose its own identity.
 * - `x-forwarded-for` is resolved by Express itself via `trust proxy` (set in
 *   main.ts to the number of hops we own), never parsed here by hand.
 */

export interface IpHeaderSource {
  headers: Record<string, string | string[] | undefined>;
  /** Express's req.ip (already X-Forwarded-For-aware) or the raw socket address. */
  remoteAddress?: string;
}

function firstHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/** Drops the `::ffff:` prefix Node puts on IPv4 addresses seen via IPv6 sockets. */
export function normalizeIp(ip: string | undefined): string | undefined {
  if (!ip) return undefined;
  let out = ip.trim().toLowerCase();
  if (out.startsWith('::ffff:') && isIP(out.substring(7)) === 4) {
    out = out.substring(7);
  }
  return isIP(out) ? out : undefined;
}

export function resolveClientIp(
  source: IpHeaderSource,
  options: { trustCloudflare: boolean },
): string | undefined {
  if (options.trustCloudflare) {
    const cf = normalizeIp(
      firstHeaderValue(source.headers['cf-connecting-ip']),
    );
    if (cf) return cf;
  }
  return normalizeIp(source.remoteAddress);
}

/** Expands an IPv6 address to its eight 16-bit groups. Returns null for IPv4. */
function expandIpv6(ip: string): number[] | null {
  if (isIP(ip) !== 6) return null;

  // An IPv4-mapped tail ("::ffff:1.2.3.4") was already stripped by normalizeIp;
  // any remaining embedded IPv4 (rare transition formats) is converted here.
  const v4Match = ip.match(/^(.*):(\d+\.\d+\.\d+\.\d+)$/);
  if (v4Match) {
    const octets = v4Match[2].split('.').map(Number);
    ip = `${v4Match[1]}:${((octets[0] << 8) | octets[1]).toString(16)}:${(
      (octets[2] << 8) |
      octets[3]
    ).toString(16)}`;
  }

  const halves = ip.split('::');
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length > 1 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  const groups = [...head, ...Array(Math.max(missing, 0)).fill('0'), ...tail];
  if (groups.length !== 8) return null;
  return groups.map((g) => parseInt(g, 16));
}

/**
 * The key an IP is blocked and matched under.
 *
 * IPv4 blocks are exact. IPv6 is keyed by /64 because ISPs delegate at least
 * a /64 per subscriber — blocking a single IPv6 address is a no-op against
 * anyone who rotates within their own subnet.
 */
export function blockKeyForIp(ip: string): string | undefined {
  const normalized = normalizeIp(ip);
  if (!normalized) return undefined;
  if (isIP(normalized) === 4) return normalized;

  const groups = expandIpv6(normalized);
  if (!groups) return undefined;
  const prefix = groups
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(':');
  return `${prefix}::/64`;
}

function ipv4ToInt(ip: string): number | null {
  if (isIP(ip) !== 4) return null;
  return (
    ip.split('.').reduce((acc, octet) => acc * 256 + parseInt(octet, 10), 0) >>>
    0
  );
}

function ipv6ToBigInt(ip: string): bigint | null {
  const groups = expandIpv6(ip);
  if (!groups) return null;
  return groups.reduce((acc, g) => (acc << 16n) | BigInt(g), 0n);
}

export interface ParsedCidr {
  version: 4 | 6;
  base: number | bigint;
  prefix: number;
}

/** Parses "1.2.3.0/24", "2001:db8::/64", or a bare IP (treated as a full-length prefix). */
export function parseCidr(cidr: string): ParsedCidr | null {
  const [rawIp, rawPrefix] = cidr.trim().toLowerCase().split('/');
  const ip = normalizeIp(rawIp);
  if (!ip) return null;
  const version = isIP(ip) as 4 | 6;
  const maxPrefix = version === 4 ? 32 : 128;
  const prefix = rawPrefix === undefined ? maxPrefix : parseInt(rawPrefix, 10);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxPrefix) {
    return null;
  }

  if (version === 4) {
    const asInt = ipv4ToInt(ip);
    if (asInt === null) return null;
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    return { version: 4, base: (asInt & mask) >>> 0, prefix };
  }

  const asBig = ipv6ToBigInt(ip);
  if (asBig === null) return null;
  const mask =
    prefix === 0
      ? 0n
      : ((1n << 128n) - 1n) ^ ((1n << BigInt(128 - prefix)) - 1n);
  return { version: 6, base: asBig & mask, prefix };
}

export function cidrContains(cidr: ParsedCidr, ip: string): boolean {
  const normalized = normalizeIp(ip);
  if (!normalized) return false;
  if (cidr.version === 4) {
    const asInt = ipv4ToInt(normalized);
    if (asInt === null) return false;
    const mask = cidr.prefix === 0 ? 0 : (~0 << (32 - cidr.prefix)) >>> 0;
    return (asInt & mask) >>> 0 === cidr.base;
  }
  const asBig = ipv6ToBigInt(normalized);
  if (asBig === null) return false;
  const mask =
    cidr.prefix === 0
      ? 0n
      : ((1n << 128n) - 1n) ^ ((1n << BigInt(128 - cidr.prefix)) - 1n);
  return (asBig & mask) === cidr.base;
}
