import { useEffect, useState } from "react";
import { useApp } from "../App";
import { engine } from "../engine/engineClient";
import { detectSpeechMode } from "../speech/speech";
import { loadCnn } from "../vision/cnn";
import { loadRankCalibrationGate } from "../store/rankCalibration";
import { loadTemplates, saveTemplates, type PieceTemplates } from "../vision/templates";
import { APP_VERSION } from "../version";
import CalibrateDialog from "./CalibrateDialog";

export default function SettingsPage() {
  const { go, settings, updateSettings } = useApp();
  const [engineMsg, setEngineMsg] = useState("");
  const [templates, setTemplates] = useState<PieceTemplates | null>(null);
  const [cnnOk, setCnnOk] = useState<boolean | null>(null);
  const [showCalibrate, setShowCalibrate] = useState(false);
  const [calMsg, setCalMsg] = useState("");
  const [rankCalibrationEnabled, setRankCalibrationEnabled] = useState(false);

  useEffect(() => {
    void loadTemplates().then(setTemplates);
    void loadCnn().then((m) => setCnnOk(!!m));
    void loadRankCalibrationGate().then((gate) => setRankCalibrationEnabled(gate.enabled)).catch(() => {
      setRankCalibrationEnabled(false);
    });
  }, []);
  const speechMode = detectSpeechMode();

  const preloadEngine = () => {
    if (!engine.supported()) {
      setEngineMsg("⚠ 此環境不支援(需要 HTTPS + COOP/COEP 標頭)");
      return;
    }
    setEngineMsg("引擎載入中…(首次會下載 12MB 棋力檔)");
    engine
      .init()
      .then(() => setEngineMsg("✓ 引擎就緒(fairy-stockfish xiangqi NNUE)"))
      .catch((e: Error) => setEngineMsg(`⚠ ${e.message}`));
  };

  return (
    <div className="page">
      <div className="topbar">
        <button onClick={() => go({ name: "home" })}>← 返回</button>
        <div className="title">設定</div>
      </div>

      <div className="card">
        <h3>語音</h3>
        <div className="settings-row">
          <div>
            辨識語系
            <div className="muted">影響辨識輸出的字形與口音</div>
          </div>
          <select
            value={settings.voiceLang}
            onChange={(e) => updateSettings({ voiceLang: e.target.value as "zh-TW" | "zh-CN" })}
          >
            <option value="zh-TW">中文(台灣)</option>
            <option value="zh-CN">中文(普通話)</option>
          </select>
        </div>
        <div className="settings-row">
          <div>
            語音覆誦
            <div className="muted">記下每著後唸出「紅,炮二平五」確認</div>
          </div>
          <input
            type="checkbox"
            checked={settings.ttsReadback}
            onChange={(e) => updateSettings({ ttsReadback: e.target.checked })}
          />
        </div>
        <div className="settings-row">
          <div>
            連續語音
            <div className="muted">套用一著後自動開始聆聽下一方(僅即時語音模式)</div>
          </div>
          <input
            type="checkbox"
            checked={settings.autoRelisten}
            onChange={(e) => updateSettings({ autoRelisten: e.target.checked })}
          />
        </div>
        <div className="muted">
          目前語音模式:
          {speechMode === "webspeech"
            ? "即時語音(Web Speech API)"
            : "鍵盤聽寫(此環境不支援即時語音;iOS 加入主畫面的 App 請點輸入框後按鍵盤上的 🎤)"}
        </div>
      </div>

      <div className="card">
        <h3>棋盤</h3>
        <div className="settings-row">
          <div>
            面對面模式
            <div className="muted">記譜時黑方棋子與控制列旋轉 180°,手機平放桌上雙方都正向</div>
          </div>
          <input
            type="checkbox"
            checked={settings.tabletop}
            onChange={(e) => updateSettings({ tabletop: e.target.checked })}
          />
        </div>
      </div>

      <div className="card">
        <h3>引擎(解棋/殘局)</h3>
        <div className="settings-row">
          <div>
            分析強度
            <div className="muted">每個局面的思考時間;越長越準、越耗時</div>
          </div>
          <select
            value={settings.analysisMovetimeMs}
            onChange={(e) => updateSettings({ analysisMovetimeMs: Number(e.target.value) })}
          >
            <option value={500}>快(0.5 秒/著)</option>
            <option value={1000}>標準(1 秒/著)</option>
            <option value={2000}>深(2 秒/著)</option>
          </select>
        </div>
        <div className="settings-row">
          <div>
            預先載入引擎
            <div className="muted">首次使用前先下載並快取棋力檔(之後離線可用)</div>
          </div>
          <button onClick={preloadEngine}>載入</button>
        </div>
        {engineMsg && <div className="muted">{engineMsg}</div>}
      </div>

      <div className="card">
        <h3>拍照辨識</h3>
        <div className="settings-row">
          <div>
            校準我的棋子
            <div className="muted">
              {templates
                ? `已校準(${new Date(templates.createdAt).toLocaleDateString("zh-TW")},${templates.samples.red.length + templates.samples.black.length} 個範本)`
                : "未校準:拍一張標準開局照,辨識會比對你自己的棋子,準很多"}
            </div>
          </div>
          <div className="row">
            <button onClick={() => setShowCalibrate(true)}>{templates ? "重新校準" : "校準"}</button>
            {templates && (
              <button
                className="danger"
                onClick={() => {
                  void saveTemplates(null).then(() => setTemplates(null));
                  setCalMsg("已清除校準");
                }}
              >
                清除
              </button>
            )}
          </div>
        </div>
        <div className="settings-row">
          <div>
            內建棋子模型
            <div className="muted">合成資料訓練的小型模型(154KB,本機執行,開源字體);實拍準確度以校準範本為準</div>
          </div>
          <span className="muted">{cnnOk === null ? "…" : cnnOk ? "✓ 已載入" : "未載入"}</span>
        </div>
        {calMsg && <div className="muted">{calMsg}</div>}
      </div>

      <div className="card">
        <h3>AI 白話講解(規劃中)</h3>
        <div className="muted">
          解棋的引擎變化未來可選配用 AI 轉成白話說明。核心分析完全在手機本機引擎執行,
          不需要任何 API Token;此欄位為未來功能預留。
        </div>
        <input
          placeholder="API Token(未啟用)"
          value={settings.llmToken}
          onChange={(e) => updateSettings({ llmToken: e.target.value })}
          style={{ width: "100%", marginTop: 8 }}
        />
      </div>

      {rankCalibrationEnabled && (
        <div className="card rank-settings-entry">
          <div className="rank-settings-mark" aria-hidden="true">校</div>
          <div className="grow">
            <h3>段級校準實驗室</h3>
            <div className="muted">本機限定・PIN 上鎖・目前為第一階段資料骨架</div>
          </div>
          <button onClick={() => go({ name: "rank-calibration" })}>進入</button>
        </div>
      )}

      <div className="card">
        <h3>授權與原始碼</h3>
        <div className="muted">
          象棋記譜 v{APP_VERSION}.授權 <b>GPL-3.0-or-later</b>。
          本 App 內含 <b>Fairy-Stockfish</b> 引擎與 <b>Pikafish</b> 團隊訓練的 xiangqi NNUE(皆為 GPL-3.0),
          依授權,取得本程式的人都有權取得對應的原始碼、並可自由重製與散布。
        </div>
        <ul className="muted" style={{ margin: "8px 0", paddingLeft: 20 }}>
          <li>
            引擎原始碼:{" "}
            <a href="https://github.com/fairy-stockfish/fairy-stockfish.wasm" target="_blank" rel="noreferrer">
              fairy-stockfish.wasm
            </a>{" "}
            /{" "}
            <a href="https://github.com/fairy-stockfish/Fairy-Stockfish" target="_blank" rel="noreferrer">
              Fairy-Stockfish
            </a>
          </li>
          <li>
            NNUE 棋力檔:{" "}
            <a href="https://fairy-stockfish.github.io/nnue/" target="_blank" rel="noreferrer">
              xiangqi-c07e94a5c7cb.nnue
            </a>
            (由 Pikafish 團隊訓練)
          </li>
          <li>
            本 App 原始碼:{" "}
            <a href="https://github.com/wcoatp/xiangqi-recorder" target="_blank" rel="noreferrer">
              github.com/wcoatp/xiangqi-recorder
            </a>
          </li>
          <li>
            記譜規範:
            <a href="https://www.xqbase.com/protocol/cchess_move.htm" target="_blank" rel="noreferrer">
              中國象棋電腦應用規範(xqbase)
            </a>{" "}
            / WXF
          </li>
        </ul>
      </div>
      {showCalibrate && (
        <CalibrateDialog
          onClose={() => setShowCalibrate(false)}
          onDone={(msg) => {
            setShowCalibrate(false);
            setCalMsg(msg);
            void loadTemplates().then(setTemplates);
          }}
        />
      )}
    </div>
  );
}
