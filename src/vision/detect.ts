// 棋盤偵測:Hough 找兩族直線 → 粗四邊形 → 校正後用「等距格線」精修出真正的格線四角。
//
// 為什麼精修有效:棋盤上所有格線與外框線在真實世界都互相平行/垂直,
// 任取每族兩條線圍出的四邊形都是世界中的平行四邊形;把它映成矩形後,
// 「世界 → 影像 → 矩形」的合成是仿射變換(四點決定唯一單應),
// 所以透視被完全消除,格線在粗校正影像中必然等距 → 可用一維峰值 + 等差級數擬合鎖定。
// 這代表粗偵測抓到棋盤實體邊框(而非最外圈格線)也沒關係。
import {
  homography,
  applyH,
  isConvex,
  orderQuad,
  quadArea,
  warpQuad,
} from "./geometry";
import type { ImageLike, Pt } from "./types";

const WORK_W = 480;

export interface Detection {
  quad: Pt[];
  confidence: number;
}

interface Line {
  theta: number;
  rho: number;
  votes: number;
}

function downscale(
  img: ImageLike,
  maxW: number,
): { img: ImageLike; scale: number } {
  if (img.width <= maxW) return { img, scale: 1 };
  const scale = maxW / img.width;
  const W = Math.round(img.width * scale);
  const H = Math.round(img.height * scale);
  const data = new Uint8ClampedArray(W * H * 4);
  const step = 1 / scale;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // 盒式平均:避免混疊吃掉細格線
      const sx0 = Math.floor(x * step);
      const sy0 = Math.floor(y * step);
      const sx1 = Math.min(Math.ceil((x + 1) * step), img.width);
      const sy1 = Math.min(Math.ceil((y + 1) * step), img.height);
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const i = (sy * img.width + sx) * 4;
          r += img.data[i];
          g += img.data[i + 1];
          b += img.data[i + 2];
          n++;
        }
      }
      const o = (y * W + x) * 4;
      data[o] = r / n;
      data[o + 1] = g / n;
      data[o + 2] = b / n;
      data[o + 3] = 255;
    }
  }
  return { img: { data, width: W, height: H }, scale };
}

export function toGray(img: ImageLike): Float32Array {
  const g = new Float32Array(img.width * img.height);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) {
    g[i] =
      0.299 * img.data[p] + 0.587 * img.data[p + 1] + 0.114 * img.data[p + 2];
  }
  return g;
}

function sobel(
  gray: Float32Array,
  w: number,
  h: number,
): { mag: Float32Array; ang: Float32Array } {
  const mag = new Float32Array(w * h);
  const ang = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -gray[i - w - 1] +
        gray[i - w + 1] -
        2 * gray[i - 1] +
        2 * gray[i + 1] -
        gray[i + w - 1] +
        gray[i + w + 1];
      const gy =
        -gray[i - w - 1] -
        2 * gray[i - w] -
        gray[i - w + 1] +
        gray[i + w - 1] +
        2 * gray[i + w] +
        gray[i + w + 1];
      mag[i] = Math.hypot(gx, gy);
      ang[i] = Math.atan2(gy, gx);
    }
  }
  return { mag, ang };
}

function percentile(values: Float32Array, p: number): number {
  const arr = Array.from(values).filter((v) => v > 0);
  if (arr.length === 0) return 0;
  arr.sort((a, b) => a - b);
  return arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
}

/** 邊緣門檻:取「穩健最大梯度」的一個比例。
 * 不能用百分位——棋子上的字對比比格線強得多,取高百分位會只留下筆畫,
 * 格線反而投不到票,Hough 就找不到棋盤。 */
function edgeThreshold(mag: Float32Array): number {
  return Math.max(25, 0.22 * percentile(mag, 0.99));
}

const THETA_BINS = 180;
const RHO_STEP = 2;

/** 用梯度方向投票的 Hough(比全掃描快很多) */
function houghLines(
  mag: Float32Array,
  ang: Float32Array,
  w: number,
  h: number,
): Line[] {
  const thr = edgeThreshold(mag);
  const D = Math.ceil(Math.hypot(w, h));
  const rhoBins = Math.ceil((2 * D) / RHO_STEP) + 1;
  const acc = new Float32Array(THETA_BINS * rhoBins);
  const dTheta = Math.PI / THETA_BINS;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const m = mag[i];
      if (m < thr) continue;
      // ρ = x·cosθ + y·sinθ 的 θ 是「法線角」= 梯度方向(不是線的走向)
      let t = ang[i];
      t = ((t % Math.PI) + Math.PI) % Math.PI;
      const tc = Math.round(t / dTheta);
      for (let k = tc - 1; k <= tc + 1; k++) {
        const tb = ((k % THETA_BINS) + THETA_BINS) % THETA_BINS;
        const th = tb * dTheta;
        const rho = x * Math.cos(th) + y * Math.sin(th);
        const rb = Math.round((rho + D) / RHO_STEP);
        if (rb < 0 || rb >= rhoBins) continue;
        acc[tb * rhoBins + rb] += m;
      }
    }
  }

  let peak = 0;
  for (let i = 0; i < acc.length; i++) if (acc[i] > peak) peak = acc[i];
  if (peak === 0) return [];
  const minVotes = peak * 0.15;
  const lines: Line[] = [];
  const NMS = 4;
  for (let t = 0; t < THETA_BINS; t++) {
    for (let r = 0; r < rhoBins; r++) {
      const v = acc[t * rhoBins + r];
      if (v < minVotes) continue;
      let isMax = true;
      for (let dt = -NMS; dt <= NMS && isMax; dt++) {
        for (let dr = -NMS; dr <= NMS; dr++) {
          if (dt === 0 && dr === 0) continue;
          const tt = (((t + dt) % THETA_BINS) + THETA_BINS) % THETA_BINS;
          const rr = r + dr;
          if (rr < 0 || rr >= rhoBins) continue;
          if (acc[tt * rhoBins + rr] > v) {
            isMax = false;
            break;
          }
        }
      }
      if (isMax)
        lines.push({ theta: t * dTheta, rho: r * RHO_STEP - D, votes: v });
    }
  }
  lines.sort((a, b) => b.votes - a.votes);
  return lines.slice(0, 60);
}

/** θ 的循環距離(線方向 mod 180°) */
function angDist(a: number, b: number): number {
  const d = Math.abs(a - b) % Math.PI;
  return Math.min(d, Math.PI - d);
}

function intersect(l1: Line, l2: Line): Pt | null {
  const a1 = Math.cos(l1.theta);
  const b1 = Math.sin(l1.theta);
  const a2 = Math.cos(l2.theta);
  const b2 = Math.sin(l2.theta);
  const det = a1 * b2 - a2 * b1;
  if (Math.abs(det) < 1e-6) return null;
  return {
    x: (l1.rho * b2 - l2.rho * b1) / det,
    y: (a1 * l2.rho - a2 * l1.rho) / det,
  };
}

/** 粗四邊形:兩族直線各取離畫面中心最遠的兩條 */
function coarseQuad(lines: Line[], w: number, h: number): Pt[] | null {
  if (lines.length < 4) return null;
  const m1 = lines[0].theta;
  const second = lines.find((l) => angDist(l.theta, m1) > (40 * Math.PI) / 180);
  if (!second) return null;
  const m2 = second.theta;
  const tol = (32 * Math.PI) / 180;
  const fam1 = lines.filter((l) => angDist(l.theta, m1) < tol);
  const fam2 = lines.filter((l) => angDist(l.theta, m2) < tol);
  if (fam1.length < 2 || fam2.length < 2) return null;

  const cx = w / 2;
  const cy = h / 2;
  // θ 在 0/180 會繞回,同一族的線可能被記成相反的法線方向(ρ 變號)。
  // 先把整族的法線對齊到基準角,否則「極值」會挑錯 → 斜角拍攝時四邊形整個歪掉。
  const align = (l: Line, ref: number): Line => {
    let t = l.theta;
    let r = l.rho;
    while (t - ref > Math.PI / 2) {
      t -= Math.PI;
      r = -r;
    }
    while (ref - t > Math.PI / 2) {
      t += Math.PI;
      r = -r;
    }
    return { theta: t, rho: r, votes: l.votes };
  };
  const pickExtremes = (fam: Line[]): [Line, Line] | null => {
    let lo = fam[0];
    let hi = fam[0];
    let dlo = Infinity;
    let dhi = -Infinity;
    for (const l of fam) {
      const d = l.rho - (cx * Math.cos(l.theta) + cy * Math.sin(l.theta));
      if (d < dlo) {
        dlo = d;
        lo = l;
      }
      if (d > dhi) {
        dhi = d;
        hi = l;
      }
    }
    if (dhi - dlo < 0.2 * Math.min(w, h)) return null;
    return [lo, hi];
  };
  const e1 = pickExtremes(fam1.map((l) => align(l, m1)));
  const e2 = pickExtremes(fam2.map((l) => align(l, m2)));
  if (!e1 || !e2) return null;

  const pts: Pt[] = [];
  for (const a of e1) {
    for (const b of e2) {
      const p = intersect(a, b);
      if (!p) return null;
      pts.push(p);
    }
  }
  const quad = orderQuad(pts);
  if (!isConvex(quad)) return null;
  if (quadArea(quad) < 0.08 * w * h) return null;
  return quad;
}

// ---------- 精修:在粗校正影像裡找等距格線 ----------

const REFINE_SIZE = 512;

function darkMask(rect: ImageLike): { mask: Uint8Array; w: number; h: number } {
  const gray = toGray(rect);
  const sorted = Array.from(gray).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const thr = median - 22;
  const mask = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) mask[i] = gray[i] < thr ? 1 : 0;
  return { mask, w: rect.width, h: rect.height };
}

function profiles(rect: ImageLike): { col: Float32Array; row: Float32Array } {
  const { mask, w, h } = darkMask(rect);
  const col = new Float32Array(w);
  const row = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) {
        col[x]++;
        row[y]++;
      }
    }
  }
  for (let x = 0; x < w; x++) col[x] /= h;
  for (let y = 0; y < h; y++) row[y] /= w;
  return { col, row };
}

function smooth(prof: Float32Array, half: number): Float32Array {
  const out = new Float32Array(prof.length);
  for (let i = 0; i < prof.length; i++) {
    let s = 0;
    let c = 0;
    for (let k = -half; k <= half; k++) {
      const j = i + k;
      if (j >= 0 && j < prof.length) {
        s += prof[j];
        c++;
      }
    }
    out[i] = s / c;
  }
  return out;
}

/** 直接掃描「n 條等距線」的最佳落點:分數 = 這 n 個位置上的格線證據平均。
 * 比先找峰值再湊等差穩得多——不必設容忍值,棋盤外框也不會被硬湊進來
 * (把外框當首尾的話,中間幾條就會落在格線之間,分數自然低)。 */
function bestSeries(
  prof: Float32Array,
  n: number,
): { x0: number; x1: number; score: number } {
  const S = prof.length;
  const sm = smooth(prof, 1);
  const minSpan = S * 0.3;
  let best = { x0: 0, x1: S - 1, score: -1 };
  for (let x0 = 0; x0 <= S * 0.45; x0++) {
    for (
      let x1 = Math.max(Math.ceil(x0 + minSpan), Math.floor(S * 0.55));
      x1 < S;
      x1++
    ) {
      const step = (x1 - x0) / (n - 1);
      let s = 0;
      for (let k = 0; k < n; k++) s += sm[Math.round(x0 + k * step)];
      s /= n;
      if (s > best.score) best = { x0, x1, score: s };
    }
  }
  return best;
}

/** 在粗四邊形的校正圖裡鎖定真正的格線四角(回傳原圖座標) */
export function refineQuad(
  img: ImageLike,
  coarse: Pt[],
): { quad: Pt[]; confidence: number } | null {
  const S = REFINE_SIZE;
  const rect = warpQuad(img, coarse, S, S);
  const { col, row } = profiles(rect);

  // 不知道棋盤在照片裡是直放還是橫放:9直×10橫 與轉置兩種都算,取分數高者
  const a = bestSeries(col, 9);
  const b = bestSeries(row, 10);
  const a2 = bestSeries(col, 10);
  const b2 = bestSeries(row, 9);
  const s1 = a.score + b.score;
  const s2 = a2.score + b2.score;
  const [X, Y] = s1 >= s2 ? [a, b] : [a2, b2];
  const confidence = Math.max(s1, s2) / 2;
  if (confidence < 0.3) return null;

  const back = homography(
    [
      { x: 0, y: 0 },
      { x: S - 1, y: 0 },
      { x: S - 1, y: S - 1 },
      { x: 0, y: S - 1 },
    ],
    coarse,
  );
  const quad = [
    { x: X.x0, y: Y.x0 },
    { x: X.x1, y: Y.x0 },
    { x: X.x1, y: Y.x1 },
    { x: X.x0, y: Y.x1 },
  ].map((p) => applyH(back, p));
  return { quad, confidence: Math.min(1, confidence) };
}

/** 主入口:回傳棋盤格線的四角(原圖座標,順時針,起點為最左上者) */
export function detectBoardQuad(img: ImageLike): Detection | null {
  const { img: small, scale } = downscale(img, WORK_W);
  const gray = toGray(small);
  const { mag, ang } = sobel(gray, small.width, small.height);
  const lines = houghLines(mag, ang, small.width, small.height);
  const coarse = coarseQuad(lines, small.width, small.height);
  if (!coarse) return null;

  const refined = refineQuad(small, coarse);
  const quad = (refined?.quad ?? coarse).map((p) => ({
    x: p.x / scale,
    y: p.y / scale,
  }));
  const ordered = orderQuad(quad);
  if (!isConvex(ordered)) return null;
  return { quad: ordered, confidence: refined ? refined.confidence : 0.25 };
}
