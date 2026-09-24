import { describe, expect, it } from "vitest";

const sharedPackages = [
  "@firstday/contracts",
  "@firstday/firstday-ui",
  "@firstday/scenario-engine",
] as const;

describe("workspace runtime resolution", () => {
  it.each(sharedPackages)("resolves %s from source without a prerequisite build", (packageName) => {
    expect(import.meta.resolve(packageName)).toMatch(/\/src\/index\.ts$/);
  });
});
