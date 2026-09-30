import { learnerCredentialsSchema, type LearnerCredentials, type SignInRequest } from '@firstday/contracts';

export interface LearnerAuth {
  signIn(input: SignInRequest): Promise<LearnerCredentials>;
  refresh(refreshToken: string): Promise<LearnerCredentials>;
  signOut(accessToken: string): Promise<void>;
}
export type SessionSnapshot = {
  generation: number;
  learnerId: string | null;
  phase: 'signedOut' | 'clearing' | 'signingIn' | 'signedIn';
  error: string | null;
};
const ended = () => new Error('This session ended. Sign in again.');
const clearMessage = 'Local drafts could not be cleared. Clear device drafts before signing in again.';

/** Tokens never leave the closure except to an explicitly authorized request. */
export function createSessionController({ auth, clearDrafts, now = Date.now }: {
  auth: LearnerAuth;
  clearDrafts(): Promise<void>;
  now?: () => number;
}) {
  let credentials: LearnerCredentials | null = null;
  let generation = 0;
  let state: SessionSnapshot = { generation, learnerId: null, phase: 'signedOut', error: null };
  const listeners = new Set<() => void>();
  let refreshWork: { generation: number; promise: Promise<string> } | null = null;
  let clearTail: Promise<void> = Promise.resolve();

  function publish(phase: SessionSnapshot['phase'], error: string | null = null) {
    state = { generation, learnerId: credentials?.learnerId ?? null, phase, error };
    listeners.forEach(listener => listener());
  }
  function assertCurrent(expected: number) {
    if (generation !== expected || credentials === null) throw ended();
  }
  function invalidate() {
    // Invalidate leases and unmount learner state before any awaited disk/network work.
    credentials = null;
    refreshWork = null;
    generation++;
    publish('clearing');
    const clearing = clearTail.catch(() => {}).then(clearDrafts).catch(() => {
      throw new Error(clearMessage);
    });
    clearTail = clearing;
    return { expected: generation, clearing };
  }
  async function authFailure(expected: number) {
    if (expected !== generation) return;
    const clearing = invalidate();
    try {
      await clearing.clearing;
    } finally {
      if (generation === clearing.expected) publish('signedOut', 'Your session ended. Sign in again.');
    }
  }
  async function accessToken(expected: number): Promise<string> {
    assertCurrent(expected);
    const saved = credentials!;
    if (saved.expiresAt * 1000 > now() + 30000) return saved.accessToken;
    if (refreshWork?.generation === expected) return refreshWork.promise;
    const promise = (async () => {
      try {
        const next = learnerCredentialsSchema.parse(await auth.refresh(saved.refreshToken));
        assertCurrent(expected);
        if (next.learnerId !== saved.learnerId || next.expiresAt * 1000 <= now()) throw ended();
        credentials = next;
        return next.accessToken;
      } catch {
        if (expected === generation) await authFailure(expected);
        throw ended();
      } finally {
        if (refreshWork?.generation === expected) refreshWork = null;
      }
    })();
    refreshWork = { generation: expected, promise };
    return promise;
  }
  return {
    snapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    assertCurrent,
    accessToken,
    authFailure,
    async signIn(input: SignInRequest) {
      const clearing = invalidate();
      let draftsCleared = false;
      try {
        await clearing.clearing;
        draftsCleared = true;
        if (generation !== clearing.expected) throw ended();
        publish('signingIn');
        const next = learnerCredentialsSchema.parse(await auth.signIn(input));
        if (generation !== clearing.expected || next.expiresAt * 1000 <= now()) throw ended();
        credentials = next;
        publish('signedIn');
      } catch {
        const message = draftsCleared ? 'Sign-in could not finish. Check your account and connection.' : clearMessage;
        if (generation === clearing.expected) publish('signedOut', message);
        throw new Error(message);
      }
    },
    async signOut() {
      const saved = credentials;
      const clearing = invalidate();
      try {
        // Logout concerns only the old GoTrue session, even if another sign-in begins.
        const results = await Promise.allSettled([clearing.clearing, saved ? auth.signOut(saved.accessToken) : Promise.resolve()]);
        if (results.some(result => result.status === 'rejected')) throw ended();
      } catch {
        const message = 'Signed out on this device. Server sign-out or device draft clearing could not be confirmed.';
        if (generation === clearing.expected) publish('signedOut', message);
        throw new Error(message);
      } finally {
        if (generation === clearing.expected && state.phase === 'clearing') publish('signedOut');
      }
    },
  };
}
