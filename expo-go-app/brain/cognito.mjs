// Verifies Amazon Cognito access tokens (RS256) without any SDK: signature against the pool's
// public keys, plus issuer, token type, app client and expiry. Shared by the brain and the Lambda.
import { createPublicKey, verify as verifySignature } from "node:crypto";

const b64url = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

export function cognitoVerifier({ poolId, clientId }) {
  if (!poolId) return async () => null;
  const region = poolId.split("_")[0];
  const issuer = `https://cognito-idp.${region}.amazonaws.com/${poolId}`;
  let jwks = null;
  let fetchedAt = 0;

  /** Returns the user's id (sub) for a valid `Authorization: Bearer <access token>` header, else null. */
  return async function verify(authorization) {
    const m = /^Bearer\s+(.+)$/i.exec(String(authorization || ""));
    if (!m) return null;
    const [h, p, sig] = m[1].split(".");
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
      if (claims.iss !== issuer || claims.token_use !== "access") return null;
      if (clientId && claims.client_id !== clientId) return null;
      if (typeof claims.exp !== "number" || claims.exp * 1000 < Date.now()) return null;
      return String(claims.sub);
    } catch {
      return null;
    }
  };
}
