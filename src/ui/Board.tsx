// SVG 棋盤:9×10 交叉點、楚河漢界、九宮斜線。
// tabletop 模式:上方(非 bottom 方)棋子字形旋轉 180°,讓對面的人讀起來是正的。
import { useMemo } from 'react'
import type { Move, Side } from '../core/board'
import { fileOf, rankOf, sq } from '../core/board'
import { parseFen } from '../core/fen'

const M = 40 // 邊距
const C = 80 // 格距
const W = M * 2 + C * 8
const H = M * 2 + C * 9

export interface BoardArrow {
  from: number
  to: number
  kind?: 'best' | 'alt'
}

export interface BoardProps {
  fen: string
  bottom: Side
  tabletop?: boolean
  lastMove?: Move | null
  selected?: number | null
  targets?: number[]
  checkSq?: number | null
  arrows?: BoardArrow[]
  onTap?: (s: number) => void
}

const PIECE_CHAR: Record<Side, Record<string, string>> = {
  red: { K: '帥', A: '仕', B: '相', N: '馬', R: '車', C: '炮', P: '兵' },
  black: { K: '將', A: '士', B: '象', N: '馬', R: '車', C: '炮', P: '卒' },
}

const STARS: Array<[number, number]> = [
  [2, 1],
  [2, 7],
  [7, 1],
  [7, 7],
  [3, 0],
  [3, 2],
  [3, 4],
  [3, 6],
  [3, 8],
  [6, 0],
  [6, 2],
  [6, 4],
  [6, 6],
  [6, 8],
]

export default function Board(props: BoardProps) {
  const pos = useMemo(() => parseFen(props.fen), [props.fen])
  const bottomRed = props.bottom === 'red'
  const X = (f: number) => M + (bottomRed ? f : 8 - f) * C
  const Y = (r: number) => M + (bottomRed ? 9 - r : r) * C

  const pieces: Array<{ s: number; side: Side; char: string }> = []
  for (let s = 0; s < 90; s++) {
    const p = pos.board[s]
    if (p) pieces.push({ s, side: p.side, char: PIECE_CHAR[p.side][p.type] })
  }

  const grid: string[] = []
  // 橫線
  for (let i = 0; i < 10; i++) {
    const y = M + i * C
    grid.push(`M ${M} ${y} H ${W - M}`)
  }
  // 直線(邊線貫通,內線分上下半)
  for (let f = 0; f < 9; f++) {
    const x = M + f * C
    if (f === 0 || f === 8) {
      grid.push(`M ${x} ${M} V ${H - M}`)
    } else {
      grid.push(`M ${x} ${M} V ${M + 4 * C}`)
      grid.push(`M ${x} ${M + 5 * C} V ${H - M}`)
    }
  }
  // 九宮斜線(用座標映射,任何方向都對)
  const palace = [
    [sq(0, 3), sq(2, 5)],
    [sq(0, 5), sq(2, 3)],
    [sq(7, 3), sq(9, 5)],
    [sq(7, 5), sq(9, 3)],
  ]

  const arrowColor = (k?: 'best' | 'alt') => (k === 'alt' ? '#8d8d8d' : '#1565c0')

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="象棋盤"
    >
      <rect x={M - 14} y={M - 14} width={W - 2 * M + 28} height={H - 2 * M + 28} rx={10} fill="var(--board-bg)" stroke="var(--board-line)" strokeWidth={3} />
      <path d={grid.join(' ')} stroke="var(--board-line)" strokeWidth={2} fill="none" />
      {palace.map(([a, b], i) => (
        <line key={i} x1={X(fileOf(a))} y1={Y(rankOf(a))} x2={X(fileOf(b))} y2={Y(rankOf(b))} stroke="var(--board-line)" strokeWidth={2} />
      ))}
      {STARS.map(([r, f], i) => (
        <circle key={i} cx={X(f)} cy={Y(r)} r={4} fill="var(--board-line)" opacity={0.55} />
      ))}
      {/* 楚河漢界:面對面各朝一方 */}
      <text x={M + 2 * C} y={M + 4.5 * C} fontSize={34} fill="var(--board-line)" textAnchor="middle" dominantBaseline="central" fontFamily="'Kaiti TC','BiauKai','KaiTi',serif" opacity={0.85}>
        楚　河
      </text>
      <text x={M + 6 * C} y={M + 4.5 * C} fontSize={34} fill="var(--board-line)" textAnchor="middle" dominantBaseline="central" fontFamily="'Kaiti TC','BiauKai','KaiTi',serif" opacity={0.85} transform={`rotate(180 ${M + 6 * C} ${M + 4.5 * C})`}>
        漢　界
      </text>

      {/* 上一著標記 */}
      {props.lastMove && (
        <>
          <circle cx={X(fileOf(props.lastMove.from))} cy={Y(rankOf(props.lastMove.from))} r={12} fill="none" stroke="#1565c0" strokeWidth={3} opacity={0.7} />
          <rect x={X(fileOf(props.lastMove.to)) - 38} y={Y(rankOf(props.lastMove.to)) - 38} width={76} height={76} rx={12} fill="none" stroke="#1565c0" strokeWidth={3} opacity={0.7} />
        </>
      )}

      {/* 棋子 */}
      {pieces.map((p) => {
        const cx = X(fileOf(p.s))
        const cy = Y(rankOf(p.s))
        const flip = props.tabletop && p.side !== props.bottom
        const color = p.side === 'red' ? 'var(--red)' : 'var(--black-piece)'
        return (
          <g key={p.s} transform={flip ? `rotate(180 ${cx} ${cy})` : undefined}>
            <circle cx={cx} cy={cy} r={34} fill="var(--piece-bg)" stroke={color} strokeWidth={3} />
            <circle cx={cx} cy={cy} r={28.5} fill="none" stroke={color} strokeWidth={1.2} opacity={0.7} />
            <text x={cx} y={cy + 1} fontSize={40} fontWeight={700} fill={color} textAnchor="middle" dominantBaseline="central" fontFamily="'Kaiti TC','BiauKai','KaiTi',serif">
              {p.char}
            </text>
          </g>
        )
      })}

      {/* 選取與可走點 */}
      {props.selected != null && (
        <circle cx={X(fileOf(props.selected))} cy={Y(rankOf(props.selected))} r={38} fill="none" stroke="var(--good)" strokeWidth={3.5} strokeDasharray="8 6" />
      )}
      {(props.targets ?? []).map((t) =>
        pos.board[t] ? (
          <circle key={t} cx={X(fileOf(t))} cy={Y(rankOf(t))} r={38} fill="none" stroke="var(--good)" strokeWidth={4} opacity={0.85} />
        ) : (
          <circle key={t} cx={X(fileOf(t))} cy={Y(rankOf(t))} r={11} fill="var(--good)" opacity={0.55} />
        ),
      )}
      {props.checkSq != null && (
        <circle className="check-ring" cx={X(fileOf(props.checkSq))} cy={Y(rankOf(props.checkSq))} r={40} fill="none" stroke="var(--bad)" strokeWidth={5} />
      )}

      {/* 分析箭頭 */}
      {(props.arrows ?? []).map((a, i) => {
        const x1 = X(fileOf(a.from))
        const y1 = Y(rankOf(a.from))
        const x2 = X(fileOf(a.to))
        const y2 = Y(rankOf(a.to))
        const dx = x2 - x1
        const dy = y2 - y1
        const len = Math.hypot(dx, dy) || 1
        const ux = dx / len
        const uy = dy / len
        const ex = x2 - ux * 26
        const ey = y2 - uy * 26
        const hw = 13
        return (
          <g key={i} opacity={0.8}>
            <line x1={x1 + ux * 20} y1={y1 + uy * 20} x2={ex} y2={ey} stroke={arrowColor(a.kind)} strokeWidth={10} strokeLinecap="round" />
            <polygon
              points={`${x2},${y2} ${ex - uy * hw},${ey + ux * hw} ${ex + uy * hw},${ey - ux * hw}`}
              fill={arrowColor(a.kind)}
            />
          </g>
        )
      })}

      {/* 點擊層 */}
      {props.onTap &&
        Array.from({ length: 90 }, (_, s) => (
          <rect
            key={s}
            data-square={s}
            x={X(fileOf(s)) - C / 2}
            y={Y(rankOf(s)) - C / 2}
            width={C}
            height={C}
            fill="transparent"
            onClick={() => props.onTap?.(s)}
          />
        ))}
    </svg>
  )
}
