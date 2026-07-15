// 校準你的棋子(選項 A):拍一張「標準開局」照 —— 那一刻 32 顆子的身分是定義上已知的,
// 等於拿你自己那副棋、你的光線、你的手機,免費建出 32 個完美標註的範本。
import { useState } from "react";
import { calibrateFromPhoto, saveTemplates } from "../vision/templates";
import { PickPhotoButton, QuadCanvas, useBoardPhoto } from "./photoCapture";

export default function CalibrateDialog({
  onDone,
  onClose,
}: {
  onDone: (msg: string) => void;
  onClose: () => void;
}) {
  const cap = useBoardPhoto();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  const run = () => {
    if (!cap.photo) return;
    setWorking(true);
    setError("");
    window.setTimeout(async () => {
      try {
        const res = calibrateFromPhoto(cap.photo!.img, cap.quad);
        await saveTemplates(res.templates);
        onDone(`✓ 校準完成(開局吻合度 ${(res.quality * 100).toFixed(0)}%,32 個範本已儲存)`);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setWorking(false);
      }
    }, 30);
  };

  return (
    <div className="overlay">
      <div className="dialog" style={{ maxWidth: 520 }}>
        <div className="row">
          <h3 className="grow">🎯 校準我的棋子</h3>
          <button onClick={onClose}>關閉</button>
        </div>
        {!cap.photo ? (
          <>
            <div className="muted">
              把你的棋子<b>全部擺回標準開局位置</b>,整個棋盤入鏡拍一張。之後拍照擺盤/辨識就是比對
              「你這副棋」的實際樣子,會比通用模型準。換一副棋或光線差很多時,重新校準即可。
            </div>
            <PickPhotoButton onFile={(f) => void cap.onFile(f)} label="📸 拍開局照" />
            {cap.loading && <div className="muted">處理中…</div>}
            {cap.error && <div style={{ color: "var(--bad)" }}>{cap.error}</div>}
          </>
        ) : (
          <>
            <QuadCanvas photo={cap.photo} quad={cap.quad} setQuad={cap.setQuad} />
            <div className="muted">
              {cap.autoFound ? "已自動找到棋盤格線。" : "沒自動找到棋盤,請手動拖曳。"}
              確認格線對齊後按「建立範本」。
            </div>
            {error && <div style={{ color: "var(--bad)" }}>⚠ {error}</div>}
            <div className="fab-row">
              <button onClick={cap.reset}>重拍</button>
              <button className="primary" onClick={run} disabled={working}>
                {working ? "建立中…" : "建立範本"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
