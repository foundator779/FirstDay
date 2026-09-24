import { describe, expect, it } from "vitest";
import { filterTrainingConversations } from "./training-list";

describe("training conversation search", () => {
  const items = [{ id: "library", title: "Library welcome desk" }, { id: "library-policy-update", title: "Library update" }, { id: "studio", title: "Art studio reception" }];
  it("finds actual training case-insensitively without exposing update-only sources", () => {
    expect(filterTrainingConversations(items, "  LIBRARY  ")).toEqual([items[0]]);
    expect(filterTrainingConversations(items, "")).toEqual([items[0], items[2]]);
  });
  it("returns an empty result for a missing title and preserves source records", () => {
    expect(filterTrainingConversations(items, "unknown")).toEqual([]);
    expect(filterTrainingConversations(items, "art")[0]).toBe(items[2]);
    expect(items).toHaveLength(3);
  });
});
