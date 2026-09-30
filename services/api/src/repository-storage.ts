import type { RepositoryState } from "./memory-repository.js";

/** Server-only persistence. A rejected version never changes committed state. */
export interface RepositoryStorage {
  load(learnerId: string): Promise<{ version: number; state: RepositoryState }>;
  commit(learnerId: string, expectedVersion: number, before: RepositoryState, after: RepositoryState): Promise<boolean>;
}
