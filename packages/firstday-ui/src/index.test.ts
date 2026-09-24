import { describe, expect, it } from "vitest";

import { firstDayTheme } from "./index.js";

describe("FirstDay visual tokens", () => {
  it("shares the supplied Figma palette and accessible touch scale across surfaces", () => {
    expect(firstDayTheme.colors).toMatchObject({
      canvas: "#FFFFFF",
      ink: "#17213A",
      action: "#2260FF",
      confirmed: "#596544",
    });
    expect(firstDayTheme.space[1]).toBe(4);
    expect(firstDayTheme.control.minimumHeight).toBeGreaterThanOrEqual(44);
  });
});
