import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import config from "../apps/mobile/app.json" with { type: "json" };

describe("physical iOS 27 configuration", () => {
  it("opts into the official SDK 57 scene lifecycle backport", () => {
    const plugin = config.expo.plugins.find(entry => Array.isArray(entry) && entry[0] === "expo-build-properties");
    expect(plugin).toEqual(["expo-build-properties", { ios: { enableSceneSupport: true } }]);
  });

  it("installs the SDK 57 patch containing scene runtime support", () => {
    const resolve = createRequire(new URL("../apps/mobile/package.json", import.meta.url));
    const metadata = JSON.parse(readFileSync(resolve.resolve("expo/package.json"), "utf8")) as { version: string };
    const [major, minor, patch] = metadata.version.split(".").map(Number);
    expect([major, minor]).toEqual([57, 0]);
    expect(patch).toBeGreaterThanOrEqual(23);
  });
});
