// 拍照記譜:拍/選一張棋盤照 → 自動抓格線四角(可手動微調)→ 辨識走了哪一步。
// 不做文字辨識:只看每個交叉點「空/紅/黑」,再比對當前局面的合法著法。
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Move, Position } from '../core/board'
import { detectBoardQuad } from '../vision/detect'
import { recognize, verdictOf, type RecognizeResult } from '../vision/recognize'
import type { ImageLike, Pt } from '../vision/types'

const MAX_DIM = 1280

type Phase = 'pick' | 'adjust' | 'working' | 'result'

async function fileToImage(file: File): Promise<{ img: ImageLike; canvas: HTMLCanvasElement }> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, MAX_DIM / Math.max(bmp.width, bmp.height))
  const W = Math.round(bmp.width * scale)
  const H = Math.round(bmp.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bmp, 0, 0, W, H)
  bmp.close()
  return { img: ctx.getImageData(0, 0, W, H), canvas }
}

const defaultQuad = (w: number, h: number): Pt[] => [
  { x: w * 0.15, y: h * 0.12 },
  { x: w * 0.85, y: h * 0.12 },
  { x: w * 0.85, y: h * 0.88 },
  { x: w * 0.15, y: h * 0.88 },
]

export default function PhotoDialog({
  pos,
  onApply,
  onClose,
}: {
  pos: Position
  onApply: (moves: Move[]) => void
  onClose: () => void
}) {
  const [phase, setPhase] = useState<Phase>('pick')
  const [error, setError] = useState('')
  const [quad, setQuad] = useState<Pt[]>([])
  const [autoFound, setAutoFound] = useState(false)
  const [result, setResult] = useState<RecognizeResult | null>(null)
  const imgRef = useRef<ImageLike | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const viewRef = useRef<HTMLCanvasElement | null>(null)
  const dragRef = useRef<number>(-1)

  const draw = useCallback(() => {
    const view = viewRef.current
    const src = canvasRef.current
    if (!view || !src || quad.length !== 4) return
    const ctx = view.getContext('2d')!
    ctx.clearRect(0, 0, view.width, view.height)
    ctx.drawImage(src, 0, 0, view.width, view.height)
    const sx = view.width / src.width
    const sy = view.height / src.height
    const p = quad.map((q) => ({ x: q.x * sx, y: q.y * sy }))
    ctx.strokeStyle = '#3ddc84'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(p[0].x, p[0].y)
    for (let i = 1; i < 4; i++) ctx.lineTo(p[i].x, p[i].y)
    ctx.closePath()
    ctx.stroke()
    // 內部格線預覽(幫使用者確認四角有沒有對準交叉點)
    ctx.strokeStyle = 'rgba(61,220,132,0.35)'
    ctx.lineWidth = 1
    const at = (u: number, v: number) => {
      const top = { x: p[0].x + (p[1].x - p[0].x) * u, y: p[0].y + (p[1].y - p[0].y) * u }
      const bot = { x: p[3].x + (p[2].x - p[3].x) * u, y: p[3].y + (p[2].y - p[3].y) * u }
      return { x: top.x + (bot.x - top.x) * v, y: top.y + (bot.y - top.y) * v }
    }
    for (let i = 1; i < 8; i++) {
      const a = at(i / 8, 0)
      const b = at(i / 8, 1)
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }
    for (let j = 1; j < 9; j++) {
      const a = at(0, j / 9)
      const b = at(1, j / 9)
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }
    for (const q of p) {
      ctx.fillStyle = '#3ddc84'
      ctx.beginPath()
      ctx.arc(q.x, q.y, 9, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#0a2a16'
      ctx.beginPath()
      ctx.arc(q.x, q.y, 3.5, 0, Math.PI * 2)
      ctx.fill()
    }
  }, [quad])

  useEffect(draw, [draw, phase])

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setError('')
    setPhase('working')
    try {
      const { img, canvas } = await fileToImage(file)
      imgRef.current = img
      canvasRef.current = canvas
      const det = detectBoardQuad(img)
      setAutoFound(!!det)
      setQuad(det ? det.quad : defaultQuad(img.width, img.height))
      setPhase('adjust')
    } catch (e) {
      setError(`讀取照片失敗:${(e as Error).message}`)
      setPhase('pick')
    }
  }

  const pointerPos = (e: React.PointerEvent<HTMLCanvasElement>): Pt => {
    const view = viewRef.current!
    const rect = view.getBoundingClientRect()
    const src = canvasRef.current!
    return {
      x: ((e.clientX - rect.left) / rect.width) * src.width,
      y: ((e.clientY - rect.top) / rect.height) * src.height,
    }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = pointerPos(e)
    let best = -1
    let bestD = Infinity
    quad.forEach((q, i) => {
      const d = Math.hypot(q.x - p.x, q.y - p.y)
      if (d < bestD) {
        bestD = d
        best = i
      }
    })
    const tol = (canvasRef.current?.width ?? 800) * 0.12
    if (bestD < tol) {
      dragRef.current = best
      e.currentTarget.setPointerCapture(e.pointerId)
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current < 0) return
    const p = pointerPos(e)
    setQuad((q) => q.map((old, i) => (i === dragRef.current ? p : old)))
  }

  const onPointerUp = () => {
    dragRef.current = -1
  }

  const runRecognize = () => {
    if (!imgRef.current) return
    setPhase('working')
    // 讓 spinner 先畫出來再做重運算
    window.setTimeout(() => {
      try {
        const r = recognize(imgRef.current!, quad, pos, 2)
        setResult(r)
        setPhase('result')
      } catch (e) {
        setError(`辨識失敗:${(e as Error).message}`)
        setPhase('adjust')
      }
    }, 30)
  }

  const verdict = result ? verdictOf(result) : null

  return (
    <div className="overlay">
      <div className="dialog" style={{ maxWidth: 520 }}>
        <div className="row">
          <h3 className="grow">📷 拍照記譜</h3>
          <button onClick={onClose}>關閉</button>
        </div>

        {phase === 'pick' && (
          <>
            <div className="muted">
              把整個棋盤拍進畫面(盡量正對、四角都入鏡)。App 只需要看出每格「有沒有子、紅或黑」,
              再對照目前局面推出走了哪一步,不必認出棋子上的字。
            </div>
            <label className="primary" style={{ display: 'block', textAlign: 'center', padding: 14, borderRadius: 10 }}>
              📸 拍照 / 選照片
              <input
                type="file"
                accept="image/*"
                capture="environment"
                style={{ display: 'none' }}
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
            </label>
            {error && <div style={{ color: 'var(--bad)' }}>{error}</div>}
          </>
        )}

        {phase === 'working' && <div className="muted">處理中…</div>}

        {(phase === 'adjust' || phase === 'result') && (
          <>
            <canvas
              ref={viewRef}
              width={480}
              height={Math.round((480 * (canvasRef.current?.height ?? 3)) / (canvasRef.current?.width ?? 4))}
              style={{ width: '100%', touchAction: 'none', borderRadius: 8 }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            />
            {phase === 'adjust' && (
              <>
                <div className="muted">
                  {autoFound ? '已自動找到棋盤格線。' : '沒自動找到棋盤,請手動拖曳。'}
                  拖曳四個綠點對準<b>最外圈格線的四個交角</b>(不是棋盤木框),讓預覽格線與實際格線重合。
                </div>
                <div className="fab-row">
                  <button onClick={() => setPhase('pick')}>重拍</button>
                  <button className="primary" onClick={runRecognize}>
                    辨識
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {phase === 'result' && result && verdict && (
          <>
            {verdict.kind === 'unclear' && (
              <div>
                <div style={{ color: 'var(--bad)' }}>⚠ 看不清楚(吻合度 {(result.quality * 100).toFixed(0)}%)</div>
                <div className="muted">
                  多半是四角沒對準格線,或光線太暗/反光。請調整綠點後再辨識一次,或改用語音/鍵盤輸入。
                </div>
              </div>
            )}
            {verdict.kind === 'same' && (
              <div>
                <b style={{ color: 'var(--good)' }}>✓ 盤面與紀錄相符</b>
                <div className="muted">沒有偵測到新的著法(吻合度 {(result.quality * 100).toFixed(0)}%)。</div>
              </div>
            )}
            {verdict.kind === 'moves' && (
              <div>
                <div>
                  偵測到 {result.best!.moves.length} 著:<b style={{ fontSize: 18 }}>{result.best!.zh.join('、')}</b>
                </div>
                <div className="muted">
                  吻合度 {(result.quality * 100).toFixed(0)}%
                  {!verdict.confident && ' ·把握不高,請確認是否正確'}
                </div>
                <button className="primary" style={{ marginTop: 8 }} onClick={() => onApply(result.best!.moves)}>
                  套用這 {result.best!.moves.length} 著
                </button>
              </div>
            )}
            {(verdict.kind !== 'same' || result.alts.length > 0) && (
              <div>
                <div className="muted">其他可能:</div>
                <div className="chips">
                  {result.alts
                    .filter((a) => a.moves.length > 0)
                    .map((a, i) => (
                      <button key={i} className="chip" onClick={() => onApply(a.moves)}>
                        {a.zh.join('、')}
                      </button>
                    ))}
                </div>
              </div>
            )}
            <div className="fab-row">
              <button onClick={() => setPhase('adjust')}>調整框線</button>
              <button onClick={() => setPhase('pick')}>重拍</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
