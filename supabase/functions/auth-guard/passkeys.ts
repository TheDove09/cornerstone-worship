// Face ID / Touch ID ("passkeys"), using the SimpleWebAuthn library.
// The phone keeps the private key; we only store the public key and check signatures.
import {
  generateAuthenticationOptions, generateRegistrationOptions,
  verifyAuthenticationResponse, verifyRegistrationResponse,
} from 'npm:@simplewebauthn/server@13.1.1';
import { isoBase64URL } from 'npm:@simplewebauthn/server@13.1.1/helpers';

export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export type StoredPasskey = { id: string; public_key: string; counter: number; transports: string[] };

// Where passkeys are used. rpID must be the site's own domain.
export function siteFor(origin: string, allowed: string[]): { origin: string; rpID: string } | null {
  if (!allowed.includes(origin)) return null;
  return { origin, rpID: new URL(origin).hostname };
}

export async function registrationOptions(site: { rpID: string }, user: { email: string; name: string }, existing: StoredPasskey[]) {
  return await generateRegistrationOptions({
    rpName: 'Cornerstone Worship',
    rpID: site.rpID,
    userName: user.email,
    userDisplayName: user.name || user.email,
    attestationType: 'none',
    excludeCredentials: existing.map(c => ({ id: c.id, transports: c.transports as any })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
  });
}

export async function checkRegistration(site: { origin: string; rpID: string }, expectedChallenge: string, response: any)
  : Promise<StoredPasskey | null> {
  const result = await verifyRegistrationResponse({
    response, expectedChallenge, expectedOrigin: site.origin, expectedRPID: site.rpID, requireUserVerification: true,
  });
  if (!result.verified || !result.registrationInfo) return null;
  const c = result.registrationInfo.credential;
  return {
    id: c.id,
    public_key: isoBase64URL.fromBuffer(c.publicKey),
    counter: c.counter,
    transports: (response?.response?.transports ?? c.transports ?? []) as string[],
  };
}

export async function authenticationOptions(site: { rpID: string }, mine: StoredPasskey[]) {
  return await generateAuthenticationOptions({
    rpID: site.rpID,
    allowCredentials: mine.map(c => ({ id: c.id, transports: c.transports as any })),
    userVerification: 'required',
  });
}

export async function checkAuthentication(site: { origin: string; rpID: string }, expectedChallenge: string, response: any, stored: StoredPasskey)
  : Promise<{ ok: boolean; newCounter: number }> {
  const result = await verifyAuthenticationResponse({
    response, expectedChallenge, expectedOrigin: site.origin, expectedRPID: site.rpID, requireUserVerification: true,
    credential: { id: stored.id, publicKey: isoBase64URL.toBuffer(stored.public_key), counter: Number(stored.counter), transports: stored.transports as any },
  });
  return { ok: result.verified, newCounter: result.authenticationInfo?.newCounter ?? stored.counter };
}
