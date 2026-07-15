// 拍照記譜:拍/選一張棋盤照 → 自動抓格線四角(可手動微調)→ 辨識走了哪一步。
// 不做文字辨識:只看每個交叉點「空/紅/黑」,再比對當前局面的合法著法。
import { useState } from "react";
import type { Move, Position } from "../core/board";
import { recognize, verdictOf, type RecognizeResult } from "../vision/recognize";
import { PickPhotoButton, QuadCanvas, useBoardPhoto } from "./photoCapture";

export default function PhotoDialog({
  pos,
  onApply,
  onClose,
}: {
  pos: Position;
  onApply: (moves: Move[]) => void;
  onClose: () => void;
}) {
  const cap = useBoardPhoto();
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<RecognizeResult | null>(null);
  const [error, setError] = useState("");

  const runRecognize = () => {
    if (!cap.photo) return;
    setWorking(true);
    setError("");
    window.setTimeout(() => {
      try {
        setResult(recognize(cap.photo!.img, cap.quad, pos, 2));
      } catch (e) {
        setError(`辨識失敗:${(e as Error).message}`);
      } finally {
        setWorking(false);
      }
    }, 30);
  };

  const verdict = result ? verdictOf(result) : null;

  return (
    <div className="overlay">
      <div className="dialog" style={{ maxWidth: 520 }}>
        <div className="row">
          <h3 className="grow">📷 拍照記譜</h3>
          <button onClick={onClose}>關閉</button>
        </div>

        {!cap.photo && (
          <>
            <div className="muted">
              把整個棋盤拍進畫面(盡量正對、四角都入鏡)。App 只需要看出每格「有沒有子、紅或黑」,
              再對照目前局面推出走了哪一步,不必認出棋子上的字。
            </div>
            <PickPhotoButton onFile={(f) => void cap.onFile(f)} label="📸 拍照 / 選照片" />
            {cap.loading && <div className="muted">處理中…</div>}
            {cap.error && <div style={{ color: "var(--bad)" }}>{cap.error}</div>}
          </>
        )}

        {cap.photo && (
          <>
            <QuadCanvas photo={cap.photo} quad={cap.quad} setQuad={cap.setQuad} />
            {!result && (
              <>
                <div className="muted">
                  {cap.autoFound ? "已自動找到棋盤格線。" : "沒自動找到棋盤,請手動拖曳。"}
                  拖曳四個綠點對準<b>最外圈格線的四個交角</b>(不是棋盤木框),讓預覽格線與實際格線重合。
                </div>
                {error && <div style={{ color: "var(--bad)" }}>{error}</div>}
                <div className="fab-row">
                  <button onClick={cap.reset}>重拍</button>
                  <button className="primary" onClick={runRecognize} disabled={working}>
                    {working ? "辨識中…" : "辨識"}
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {result && verdict && (
          <>
            {verdict.kind === "unclear" && (
              <div>
                <div style={{ color: "var(--bad)" }}>
                  ⚠ 看不清楚(吻合度 {(result.quality * 100).toFixed(0)}%)
                </div>
                <div className="muted">
                  多半是四角沒對準格線,或光線太暗/反光。請調整綠點後再辨識一次,或改用語音/鍵盤輸入。
                </div>
              </div>
            )}
            {verdict.kind === "same" && (
              <div>
                <b style={{ color: "var(--good)" }}>✓ 盤面與紀錄相符</b>
                <div className="muted">
                  沒有偵測到新的著法(吻合度 {(result.quality * 100).toFixed(0)}%)。
                </div>
              </div>
            )}
            {verdict.kind === "moves" && (
              <div>
                <div>
                  偵測到 {result.best!.moves.length} 著:
                  <b style={{ fontSize: 18 }}>{result.best!.zh.join("、")}</b>
                </div>
                <div className="muted">
                  吻合度 {(result.quality * 100).toFixed(0)}%
                  {!verdict.confident && "·把握不高,請確認是否正確"}
                </div>
                <button className="primary" style={{ marginTop: 8 }} onClick={() => onApply(result.best!.moves)}>
                  套用這 {result.best!.moves.length} 著
                </button>
              </div>
            )}
            {(verdict.kind !== "same" || result.alts.length > 0) && (
              <div>
                <div className="muted">其他可能:</div>
                <div className="chips">
                  {result.alts
                    .filter((a) => a.moves.length > 0)
                    .map((a, i) => (
                      <button key={i} className="chip" onClick={() => onApply(a.moves)}>
                        {a.zh.join("、")}
                      </button>
                    ))}
                </div>
              </div>
            )}
            <div className="fab-row">
              <button onClick={() => setResult(null)}>調整框線</button>
              <button
                onClick={() => {
                  setResult(null);
                  cap.reset();
                }}
              >
                重拍
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
