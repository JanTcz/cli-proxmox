// What a profile allows (UC-5): its tier — an operation above it refused before any request — and its fence of guests, `vmids` and
// `pool`, beside the token's own ACL: a guest is in scope when either admits it; a profile with neither sees what the token sees.
import type { Profile, Tier } from './profile.ts';
import { TIERS } from './profile.ts';

export function refusal(tier: Tier, profile: Profile): string | undefined {
  return TIERS.indexOf(tier) > TIERS.indexOf(profile.tier) ? `the profile ${profile.name} allows ${profile.tier}; this is a ${tier}` : undefined;
}

export function inScope(guest: { vmid: number; pool?: string }, { vmids, pool }: Profile): boolean {
  if (vmids === undefined && pool === undefined) return true;
  return (vmids?.includes(guest.vmid) ?? false) || (pool !== undefined && guest.pool === pool);
}

// The fence as it is said in a refusal: `pool codiak`, `vmids 100, 102`, or both.
export const fenceOf = ({ vmids, pool }: Profile): string =>
  [...(pool === undefined ? [] : [`pool ${pool}`]), ...(vmids === undefined ? [] : [`vmids ${vmids.join(', ')}`])].join(', ');
