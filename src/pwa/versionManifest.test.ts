import { describe, expect, it } from "vitest";
import {
  parseAppVersionManifest,
  serializeAppVersionManifest,
} from "./versionManifest";

describe("PWA App 版本描述檔", () => {
  it("可序列化並解析正式 semver", () => {
    const json = serializeAppVersionManifest("0.8.0");
    expect(json).toBe('{"version":"0.8.0"}\n');
    expect(parseAppVersionManifest(JSON.parse(json))).toEqual({ version: "0.8.0" });
  });

  it.each([
    null,
    [],
    {},
    { version: "" },
    { version: "  " },
    { version: "v0.8.0" },
    { version: "0.8" },
    { version: 8 },
    { version: "0.8.0", extra: true },
    { version: `1.0.0-${"a".repeat(65)}` },
  ])("拒絕無效或非 exact-shape 輸入 %#", (value) => {
    expect(parseAppVersionManifest(value)).toBeNull();
  });

  it("接受 prerelease 與 build metadata", () => {
    expect(parseAppVersionManifest({ version: "1.2.3-beta.1+ipad" })).toEqual({
      version: "1.2.3-beta.1+ipad",
    });
  });

  it("序列化無效版本時直接拒絕 build", () => {
    expect(() => serializeAppVersionManifest("latest")).toThrow("無效的 App 版本");
  });
});
