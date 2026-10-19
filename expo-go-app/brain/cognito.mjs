// Verifies Amazon Cognito access tokens (RS256) without any SDK: signature against the pool's
// public keys, plus issuer, token type, app client and expiry. Shared by the brain and the Lambda.
import { createPublicKey, verify as verifySignature } from "node:crypto";

const b64url = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

export function cognitoVerifier({ poolId, clientId }) {
  const check = claimsChecker({ poolId });
  /** Returns the user's id (sub) for a valid `Authorization: Bearer <access token>` header, else null. */
  return async function verify(authorization) {
    const m = /^Bearer\s+(.+)$/i.exec(String(authorization || ""));
    const claims = m ? await check(m[1]) : null;
    if (!claims || claims.token_use !== "access") return null;
    if (clientId && claims.client_id !== clientId) return null;
    return String(claims.sub);
  };
}

/**
 * Checks a Cognito ID token (same signature checks) and returns { sub, email } when the email is verified, else null.
 * Used where the service needs to know who someone is, such as a join request a trainer approves.
 */
export function cognitoIdVerifier({ poolId, clientId }) {
  const check = claimsChecker({ poolId });
  return async function verifyId(idToken) {
    const claims = typeof idToken === "string" ? await check(idToken) : null;
    if (!claims || claims.token_use !== "id") return null;
    if (clientId && claims.aud !== clientId) return null;
    if (typeof claims.email !== "string" || !(claims.email_verified === true || claims.email_verified === "true")) return null;
    return { sub: String(claims.sub), email: claims.email.toLowerCase() };
  };
}

function claimsChecker({ poolId }) {
  if (!poolId) return async () => null;
  const region = poolId.split("_")[0];
  const issuer = `https://cognito-idp.${region}.amazonaws.com/${poolId}`;
  let jwks = null;
  let fetchedAt = 0;

  /** The token's claims when the signature, issuer and expiry are valid, else null. */
  return async function check(token) {
    const [h, p, sig] = String(token).split(".");
    if (!h || !p || !sig) return null;
    try {
      const header = JSON.parse(b64url(h).toString());
      const claims = JSON.parse(b64url(p).toString());
      if (header.alg !== "RS256") return null;
      const stale = Date.now() - fetchedAt > 3600_000;
      // Unknown key id: refetch at most once a minute, so forged tokens can't make us hammer Cognito.
      const unknownKid = !!jwks && !jwks.some((k) => k.kid === header.kid) && Date.now() - fetchedAt > 60_000;
      if (!jwks || stale || unknownKid) {
        const r = await fetch(`${issuer}/.well-known/jwks.json`, { signal: AbortSignal.timeout(8000) });
        jwks = (await r.json()).keys || [];
        fetchedAt = Date.now();
      }
      const jwk = jwks.find((k) => k.kid === header.kid);
      if (!jwk) return null;
      const ok = verifySignature("RSA-SHA256", Buffer.from(`${h}.${p}`), createPublicKey({ key: jwk, format: "jwk" }), b64url(sig));
      if (!ok) return null;
      if (claims.iss !== issuer) return null;
      if (typeof claims.exp !== "number" || claims.exp * 1000 < Date.now()) return null;
      return claims;
    } catch {
      return null;
    }
  };
}
