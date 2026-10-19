import type { ReactNode } from "react";
import { authConfigured, useSession, useSessionStatus } from "./auth";
import { StoreProvider } from "./store";

/**
 * Loads the data of whoever is signed in. Signed out, the app holds an empty, unsaved state and only
 * the landing and account screens are reachable. In a build without accounts, everything is kept locally.
 */
export function AccountStore({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const session = useSessionStatus();
  if (session === undefined) return <>{fallback}</>;
  const user = authConfigured ? session?.sub || null : "local";
  return (
    <StoreProvider user={user} fallback={fallback}>
      {children}
    </StoreProvider>
  );
}

/** True when the main app may show: signed in, or a build without accounts. */
export function useSignedIn(): boolean {
  const session = useSession();
  return !authConfigured || !!session;
}
