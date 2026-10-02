import { File, Paths } from "expo-file-system";
import { createDraftStore } from "./draft-store";

const file = (slot: 0 | 1) => new File(Paths.document, `firstday-answer-drafts-v1-${slot}.json`);
export const draftStorage = createDraftStore({
  async read(slot) { const target = file(slot); return target.exists ? target.text() : null; },
  async write(slot, value) { const target = file(slot); if (!target.exists) target.create(); target.write(value); },
  async remove(slot) { const target = file(slot); if (target.exists) target.delete(); },
});
