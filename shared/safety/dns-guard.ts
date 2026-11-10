import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { PRODUCTION_URLS } from '../../config/environments';

export type Resolver = (host: string) => Promise<string[]>;

const systemResolver: Resolver = async (host) => (await lookup(host, { all: true })).map((entry) => entry.address);

/** Loopback, unspecified, private, link-local, and CGNAT ranges: a public staging host should never resolve here. */
export function isNonPublicAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const a = address.toLowerCase();
    if (a.startsWith('::ffff:')) return isNonPublicAddress(a.slice(7));
    return a === '::' || a === '::1' || a.startsWith('fc') || a.startsWith('fd') || a.startsWith('fe80');
  }
  const [o1, o2] = address.split('.').map(Number);
  return (
    o1 === 0 || o1 === 10 || o1 === 127 ||
    (o1 === 100 && o2 >= 64 && o2 <= 127) ||
    (o1 === 169 && o2 === 254) ||
    (o1 === 172 && o2 >= 16 && o2 <= 31) ||
    (o1 === 192 && o2 === 168)
  );
}

/**
 * Refuses hosts that resolve to non-public addresses (hosts-file or tunnel
 * substitutes) or to any address production resolves to. Resolution
 * failures refuse too. Only DNS is queried; no request is sent to any host.
 */
export async function verifyHostResolution(hosts: readonly string[], resolver: Resolver = systemResolver): Promise<string[]> {
  const reasons: string[] = [];
  const productionAddresses = new Set<string>();
  for (const url of PRODUCTION_URLS) {
    try {
      for (const address of await resolver(new URL(url).hostname)) productionAddresses.add(address);
    } catch {
      // An unresolvable production host cannot collide with staging.
    }
  }
  for (const host of hosts) {
    let addresses: string[];
    try {
      addresses = await resolver(host);
    } catch (error) {
      reasons.push(`"${host}" could not be resolved (${(error as Error).message}).`);
      continue;
    }
    if (addresses.length === 0) reasons.push(`"${host}" resolved to no addresses.`);
    const nonPublic = addresses.filter(isNonPublicAddress);
    if (nonPublic.length) reasons.push(`"${host}" resolves to non-public address(es) ${nonPublic.join(', ')}; the real destination is hidden.`);
    const shared = addresses.filter((a) => productionAddresses.has(a));
    if (shared.length) reasons.push(`"${host}" resolves to PRODUCTION address(es) ${shared.join(', ')}.`);
  }
  return reasons;
}
