import { describe, expect, it } from "vitest";

import { radioAccessibility } from "./a11y.js";

describe("cross-platform radio semantics", () => {
  it("exposes checked state through both native accessibility state and ARIA", () => {
    expect(radioAccessibility(true)).toEqual({
      accessibilityRole: "radio",
      accessibilityState: { checked: true },
      "aria-checked": true,
    });
    expect(radioAccessibility(false)["aria-checked"]).toBe(false);
  });
});
