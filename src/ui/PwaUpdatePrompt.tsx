import { useSyncExternalStore } from "react";
import { pwaUpdateController } from "../pwa/updateController";

export default function PwaUpdatePrompt() {
  const snapshot = useSyncExternalStore(
    pwaUpdateController.subscribe,
    pwaUpdateController.getSnapshot,
    pwaUpdateController.getSnapshot,
  );

  const isApplying = snapshot.phase === "applying";
  const isError = snapshot.phase === "error";
  const hasNewVersion =
    snapshot.availableVersion !== null &&
    snapshot.availableVersion !== snapshot.currentVersion;

  const title = isError
    ? "更新尚未完成"
    : isApplying
      ? "正在套用新版本"
      : "新版本已準備完成";

  const handleUpdate = () => {
    void pwaUpdateController.applyUpdate().catch(() => {
      // Controller 會把失敗狀態轉成可重試的本地化提示。
    });
  };

  return (
    <>
      <span
        className="pwa-update-announcer"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {snapshot.phase === "idle" ? "" : title}
      </span>
      {snapshot.phase !== "idle" && (
        <aside
          className="pwa-update-prompt"
          role="region"
          aria-labelledby="pwa-update-title"
          aria-describedby="pwa-update-description"
        >
          <span className="pwa-update-seal" aria-hidden="true">新</span>
          <div className="pwa-update-copy">
            <h2 id="pwa-update-title">{title}</h2>
            <p className="pwa-update-version">
              <span>目前 v{snapshot.currentVersion}</span>
              <span aria-hidden="true">→</span>
              <strong>
                {hasNewVersion ? `新版 v${snapshot.availableVersion}` : "新版內容"}
              </strong>
            </p>
            <p id="pwa-update-description">
              目前進度已保存在這台裝置；更新會重新載入並回到首頁。
            </p>
            {snapshot.error && (
              <p className="pwa-update-error" role="alert">{snapshot.error}</p>
            )}
          </div>
          <div className="pwa-update-actions">
            <button
              type="button"
              onClick={() => pwaUpdateController.dismiss()}
              disabled={isApplying}
            >
              稍後
            </button>
            <button
              type="button"
              className="pwa-update-apply"
              onClick={handleUpdate}
              disabled={isApplying}
            >
              {isApplying ? "正在更新…" : isError ? "重試更新" : "立即更新"}
            </button>
          </div>
        </aside>
      )}
    </>
  );
}
