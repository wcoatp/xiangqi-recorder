// 拍照 → 自動抓格線四角 → 可拖曳微調:PhotoDialog(記譜)與 PhotoSetupDialog(擺盤)共用。
import { useCallback, useEffect, useRef, useState } from "react";
import { detectBoardQuad } from "../vision/detect";
import type { ImageLike, Pt } from "../vision/types";

const MAX_DIM = 1280;

export interface BoardPhoto {
  img: ImageLike;
  canvas: HTMLCanvasElement;
}

export async function fileToImage(file: File): Promise<BoardPhoto> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_DIM / Math.max(bmp.width, bmp.height));
  const W = Math.round(bmp.width * scale);
  const H = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, W, H);
  bmp.close();
  return { img: ctx.getImageData(0, 0, W, H), canvas };
}

const defaultQuad = (w: number, h: number): Pt[] => [
  { x: w * 0.15, y: h * 0.12 },
  { x: w * 0.85, y: h * 0.12 },
  { x: w * 0.85, y: h * 0.88 },
  { x: w * 0.15, y: h * 0.88 },
];

export function useBoardPhoto() {
  const [photo, setPhoto] = useState<BoardPhoto | null>(null);
  const [quad, setQuad] = useState<Pt[]>([]);
  const [autoFound, setAutoFound] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const onFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setError("");
    setLoading(true);
    try {
      const p = await fileToImage(file);
      const det = detectBoardQuad(p.img);
      setPhoto(p);
      setAutoFound(!!det);
      setQuad(det ? det.quad : defaultQuad(p.img.width, p.img.height));
    } catch (e) {
      setError(`讀取照片失敗:${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setPhoto(null);
    setQuad([]);
    setError("");
  }, []);

  return { photo, quad, setQuad, autoFound, loading, error, onFile, reset };
}

/** 檔案選擇按鈕(手機會直接開相機) */
export function PickPhotoButton({
  onFile,
  label,
}: {
  onFile: (f: File | undefined) => void;
  label: string;
}) {
  return (
    <label
      className="primary"
      style={{
        display: "block",
        textAlign: "center",
        padding: 14,
        borderRadius: 10,
        background: "var(--accent)",
        color: "var(--accent-ink)",
        fontWeight: 650,
      }}
    >
      {label}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: "none" }}
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </label>
  );
}

/** 照片 + 四角拖曳 + 內部格線預覽 */
export function QuadCanvas({
  photo,
  quad,
  setQuad,
}: {
  photo: BoardPhoto;
  quad: Pt[];
  setQuad: (fn: (q: Pt[]) => Pt[]) => void;
}) {
  const viewRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef(-1);

  const draw = useCallback(() => {
    const view = viewRef.current;
    if (!view || quad.length !== 4) return;
    const ctx = view.getContext("2d")!;
    ctx.clearRect(0, 0, view.width, view.height);
    ctx.drawImage(photo.canvas, 0, 0, view.width, view.height);
    const sx = view.width / photo.canvas.width;
    const sy = view.height / photo.canvas.height;
    const p = quad.map((q) => ({ x: q.x * sx, y: q.y * sy }));
    ctx.strokeStyle = "#3ddc84";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p[0].x, p[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(p[i].x, p[i].y);
    ctx.closePath();
    ctx.stroke();
    ctx.strokeStyle = "rgba(61,220,132,0.35)";
    ctx.lineWidth = 1;
    const at = (u: number, v: number) => {
      const top = { x: p[0].x + (p[1].x - p[0].x) * u, y: p[0].y + (p[1].y - p[0].y) * u };
      const bot = { x: p[3].x + (p[2].x - p[3].x) * u, y: p[3].y + (p[2].y - p[3].y) * u };
      return { x: top.x + (bot.x - top.x) * v, y: top.y + (bot.y - top.y) * v };
    };
    for (let i = 1; i < 8; i++) {
      const a = at(i / 8, 0);
      const b = at(i / 8, 1);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    for (let j = 1; j < 9; j++) {
      const a = at(0, j / 9);
      const b = at(1, j / 9);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    for (const q of p) {
      ctx.fillStyle = "#3ddc84";
      ctx.beginPath();
      ctx.arc(q.x, q.y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0a2a16";
      ctx.beginPath();
      ctx.arc(q.x, q.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }, [photo, quad]);

  useEffect(draw, [draw]);

  const pointerPos = (e: React.PointerEvent<HTMLCanvasElement>): Pt => {
    const rect = viewRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * photo.canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * photo.canvas.height,
    };
  };

  return (
    <canvas
      ref={viewRef}
      width={480}
      height={Math.round((480 * photo.canvas.height) / photo.canvas.width)}
      style={{ width: "100%", touchAction: "none", borderRadius: 8 }}
      onPointerDown={(e) => {
        const p = pointerPos(e);
        let best = -1;
        let bestD = Infinity;
        quad.forEach((q, i) => {
          const d = Math.hypot(q.x - p.x, q.y - p.y);
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        });
        if (bestD < photo.canvas.width * 0.12) {
          dragRef.current = best;
          e.currentTarget.setPointerCapture(e.pointerId);
        }
      }}
      onPointerMove={(e) => {
        if (dragRef.current < 0) return;
        const p = pointerPos(e);
        setQuad((q) => q.map((old, i) => (i === dragRef.current ? p : old)));
      }}
      onPointerUp={() => {
        dragRef.current = -1;
      }}
      onPointerCancel={() => {
        dragRef.current = -1;
      }}
    />
  );
}
