import type { SourceConversation } from "@firstday/contracts";
import { FirstDayClientError, type FirstDayClient } from "./api";

/** Recover an acknowledged revocation after a lost response without repeating it. */
export async function revokeConfirmedSource(client: FirstDayClient, source: SourceConversation): Promise<void> {
  try {
    const response = await client.revokeConsent({ sourceConversationId: source.id, sourceRevision: source.sourceRevision });
    const revoked = response.sourceConversation;
    if (revoked.id !== source.id || revoked.learnerId !== source.learnerId || revoked.sourceRevision !== source.sourceRevision || revoked.consentStatus !== "revoked") throw new FirstDayClientError("INVALID_RESPONSE", "Source permission response did not match this training.");
  } catch (failure) {
    if (!(failure instanceof FirstDayClientError) || !["NETWORK_ERROR", "INVALID_STATE"].includes(failure.code)) throw failure;
    try { await client.getSourceSession(source.id); }
    catch (readFailure) { if (readFailure instanceof FirstDayClientError && readFailure.code === "CONSENT_REVOKED") return; }
    throw failure;
  }
}
