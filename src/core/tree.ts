// 棋譜樹:主線 = 每個節點的 children[0];其餘 children 為變着。
import type { Move } from './board'
import { applyMove, moveEquals } from './board'
import { formatFen, parseFen } from './fen'
import { moveNotations } from './notation'

export interface GameNode {
  id: string
  move: Move | null // root 為 null
  zh?: string
  wxf?: string
  fenAfter: string
  comment?: string
  /** 距開局經過毫秒(記錄時間戳) */
  tMs?: number
  children: GameNode[]
}

let counter = 0
export function genId(): string {
  counter += 1
  return `n${Date.now().toString(36)}_${counter.toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`
}

export function newRoot(fen: string): GameNode {
  return { id: genId(), move: null, fenAfter: fen, children: [] }
}

/** 在 parent 之後加一步;若已存在相同著法的子節點則沿用 */
export function addMove(parent: GameNode, move: Move, tMs?: number): { node: GameNode; created: boolean } {
  const existing = parent.children.find((c) => moveEquals(c.move, move))
  if (existing) return { node: existing, created: false }
  const pos = parseFen(parent.fenAfter)
  const { zh, wxf } = moveNotations(pos, move)
  const node: GameNode = {
    id: genId(),
    move,
    zh,
    wxf,
    fenAfter: formatFen(applyMove(pos, move)),
    children: [],
  }
  if (tMs !== undefined) node.tMs = tMs
  parent.children.push(node)
  return { node, created: true }
}

export function mainline(root: GameNode): GameNode[] {
  const out: GameNode[] = []
  let n = root
  while (n.children.length > 0) {
    n = n.children[0]
    out.push(n)
  }
  return out
}

export function findNode(root: GameNode, id: string): GameNode | null {
  if (root.id === id) return root
  for (const c of root.children) {
    const hit = findNode(c, id)
    if (hit) return hit
  }
  return null
}

export function findParent(root: GameNode, id: string): GameNode | null {
  for (const c of root.children) {
    if (c.id === id) return root
    const hit = findParent(c, id)
    if (hit) return hit
  }
  return null
}

/** root(不含)到目標節點(含)的路徑;找不到回傳 null */
export function pathTo(root: GameNode, id: string): GameNode[] | null {
  if (root.id === id) return []
  for (const c of root.children) {
    const sub = pathTo(c, id)
    if (sub !== null) return [c, ...sub]
  }
  return null
}

export function deleteSubtree(root: GameNode, id: string): boolean {
  const parent = findParent(root, id)
  if (!parent) return false
  parent.children = parent.children.filter((c) => c.id !== id)
  return true
}

/** 把 id 所在的分支一路升為主線 */
export function promoteToMainline(root: GameNode, id: string): void {
  const path = pathTo(root, id)
  if (!path) return
  let parent = root
  for (const node of path) {
    const i = parent.children.indexOf(node)
    if (i > 0) {
      parent.children.splice(i, 1)
      parent.children.unshift(node)
    }
    parent = node
  }
}

export function countNodes(root: GameNode): number {
  let n = 0
  const walk = (node: GameNode) => {
    for (const c of node.children) {
      n++
      walk(c)
    }
  }
  walk(root)
  return n
}
