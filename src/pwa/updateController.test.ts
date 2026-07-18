import { describe, expect, it, vi } from "vitest";
import {
  fetchAvailableAppVersion,
  PwaUpdateController,
} from "./updateController";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

describe("PWA 更新 controller", () => {
  it("先顯示提示，再非阻塞補上可用版本", async () => {
    const controller = new PwaUpdateController("0.8.0");
    const version = deferred<string | null>();
    const announced = controller.announceUpdate(() => version.promise);

    expect(controller.getSnapshot()).toEqual({
      phase: "ready",
      currentVersion: "0.8.0",
      availableVersion: null,
      error: null,
    });

    version.resolve("0.8.1");
    await announced;
    expect(controller.getSnapshot().availableVersion).toBe("0.8.1");
  });

  it("版本載入失敗仍保留可更新提示", async () => {
    const controller = new PwaUpdateController("0.8.0");
    await controller.announceUpdate(async () => {
      throw new Error("offline");
    });
    expect(controller.getSnapshot()).toMatchObject({
      phase: "ready",
      availableVersion: null,
    });
  });

  it("稍後會關閉提示並忽略較晚完成的版本查詢", async () => {
    const controller = new PwaUpdateController("0.8.0");
    const version = deferred<string | null>();
    const announced = controller.announceUpdate(() => version.promise);
    controller.dismiss();
    version.resolve("0.8.1");
    await announced;
    expect(controller.getSnapshot().phase).toBe("idle");
  });

  it("並行套用共用同一個 Promise 且 updater 只執行一次", async () => {
    const controller = new PwaUpdateController("0.8.0");
    const applied = deferred<void>();
    const updater = vi.fn(() => applied.promise);
    controller.setUpdateServiceWorker(updater);
    await controller.announceUpdate(async () => "0.8.1");

    const first = controller.applyUpdate();
    const second = controller.applyUpdate();
    expect(first).toBe(second);
    expect(controller.getSnapshot().phase).toBe("applying");
    expect(updater).not.toHaveBeenCalled();

    await Promise.resolve();
    expect(updater).toHaveBeenCalledOnce();
    expect(updater).toHaveBeenCalledWith(true);
    applied.resolve();
    await first;
    expect(controller.getSnapshot().phase).toBe("applying");
  });

  it("套用失敗後顯示可重試錯誤", async () => {
    const controller = new PwaUpdateController("0.8.0");
    const updater = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("skip waiting failed"))
      .mockResolvedValueOnce();
    controller.setUpdateServiceWorker(updater);
    await controller.announceUpdate(async () => "0.8.1");

    await expect(controller.applyUpdate()).rejects.toThrow("skip waiting failed");
    expect(controller.getSnapshot()).toMatchObject({
      phase: "error",
      error: "更新尚未完成，請稍後再試。",
    });

    await controller.applyUpdate();
    expect(updater).toHaveBeenCalledTimes(2);
  });
});

describe("PWA 可用版本查詢", () => {
  it("使用 no-store 與 cache-busting query", async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({ version: "0.8.1" }),
    }));
    await expect(fetchAvailableAppVersion(fetcher, () => 1234)).resolves.toBe("0.8.1");
    expect(fetcher).toHaveBeenCalledWith("/app-version.json?update=1234", {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
  });

  it("HTTP、JSON 或 schema 失敗都安全降級為未知版本", async () => {
    await expect(
      fetchAvailableAppVersion(async () => ({ ok: false, json: async () => ({}) })),
    ).resolves.toBeNull();
    await expect(
      fetchAvailableAppVersion(async () => {
        throw new Error("offline");
      }),
    ).resolves.toBeNull();
    await expect(
      fetchAvailableAppVersion(async () => ({
        ok: true,
        json: async () => ({ version: "latest" }),
      })),
    ).resolves.toBeNull();
  });
});
