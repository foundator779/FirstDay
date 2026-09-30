import { createDraftStore } from "./draft-store";

const key = (slot: 0 | 1) => `firstday-answer-drafts-v1-${slot}`;
export const draftStorage = createDraftStore({
  async read(slot) { return typeof localStorage === "undefined" ? null : localStorage.getItem(key(slot)); },
  async write(slot, value) { if (typeof localStorage === "undefined") throw new Error("Local storage is unavailable."); localStorage.setItem(key(slot), value); },
  async remove(slot) { if (typeof localStorage !== "undefined") localStorage.removeItem(key(slot)); },
});
