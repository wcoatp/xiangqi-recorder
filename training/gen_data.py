# 合成棋子取樣塊(mirror src/vision/patch.ts 的墨水轉換,兩邊必須一致):
#   darkness = 255 - min(G,B);圓盤內減中位數 → clamp≥0 → RMS 正規化(cap 8)
# 變異:字形(每類多個異體字)、字體、大小、旋轉 0-360°、位移、
#       墨色(黑/紅系)、棋面底色、外圈環、反光、陰影浮雕、模糊、雜訊。
#
# 字體一律用 SIL OFL 授權的開源字體(training/fonts,跑 get_fonts.sh 取得):
# 明體 Noto Serif TC / 黑體 Noto Sans TC / 楷書 霞鶩文楷。
# 不用 macOS 內建字體 —— 那些不可轉散布,整條產線用 OFL 才能安心商業化。
import os
import random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

PATCH = 48
HI = 96  # 先畫大再縮,筆畫平滑
CLASSES = ["K", "A", "B", "N", "R", "C", "P"]  # 與 src/vision/cnn.ts CNN_TYPES 一致
GLYPHS = {
    "K": ["帥", "將", "帅", "将"],
    "A": ["仕", "士"],
    "B": ["相", "象"],
    "N": ["馬", "傌", "马"],
    "R": ["車", "俥", "车"],
    "C": ["炮", "砲", "包"],
    "P": ["兵", "卒"],
}
FONT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fonts")


def find_fonts() -> list[str]:
    out: list[str] = []
    for root, _dirs, files in os.walk(FONT_DIR):
        for f in sorted(files):
            if f.lower().endswith((".otf", ".ttf", ".ttc")):
                out.append(os.path.join(root, f))
    if not out:
        raise SystemExit(
            f"找不到字體:{FONT_DIR}\n請先跑 training/get_fonts.sh 下載開源字體(SIL OFL)"
        )
    return out


FONT_PATHS = find_fonts()

_font_cache: dict[tuple[str, int, int], ImageFont.FreeTypeFont] = {}


def get_font(path: str, size: int, index: int) -> ImageFont.FreeTypeFont | None:
    key = (path, size, index)
    if key not in _font_cache:
        try:
            _font_cache[key] = ImageFont.truetype(path, size=size, index=index)
        except Exception:
            return None
    return _font_cache[key]


def rand_font(rng: random.Random, size: int) -> ImageFont.FreeTypeFont:
    for _ in range(20):
        path = rng.choice(FONT_PATHS)
        idx = rng.randrange(0, 4) if path.lower().endswith(".ttc") else 0
        f = get_font(path, size, idx)
        if f is not None:
            return f
    raise RuntimeError("沒有可用的字體")


def render_patch(rng: random.Random, cls: str) -> np.ndarray:
    glyph = rng.choice(GLYPHS[cls])
    # 棋面底色(米白~淡黃)與墨色
    face = np.array([rng.randint(225, 250), rng.randint(215, 242), rng.randint(180, 225)])
    if rng.random() < 0.5:  # 紅墨
        ink = (rng.randint(140, 210), rng.randint(20, 70), rng.randint(20, 70))
    else:  # 黑墨
        v = rng.randint(10, 60)
        ink = (v + rng.randint(0, 25), v, v)

    img = Image.new("RGB", (HI, HI), tuple(int(x) for x in face))
    d = ImageDraw.Draw(img)

    # 外圈刻環(有無、粗細、顏色隨機)
    if rng.random() < 0.85:
        ring_r = rng.uniform(0.86, 0.99) * HI / 2
        w = rng.randint(2, 5)
        color = ink if rng.random() < 0.7 else (150, 110, 60)
        d.ellipse(
            [HI / 2 - ring_r, HI / 2 - ring_r, HI / 2 + ring_r, HI / 2 + ring_r],
            outline=color,
            width=w,
        )

    # 字形:畫在獨立圖層,旋轉後貼回
    size = rng.randint(52, 72)
    font = rand_font(rng, size)
    layer = Image.new("RGBA", (HI, HI), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    try:
        bbox = ld.textbbox((0, 0), glyph, font=font)
    except Exception:
        return render_patch(rng, cls)
    gw, gh = bbox[2] - bbox[0], bbox[3] - bbox[1]
    ox = HI / 2 - gw / 2 - bbox[0] + rng.uniform(-3, 3)
    oy = HI / 2 - gh / 2 - bbox[1] + rng.uniform(-3, 3)
    # 浮雕陰影(刻字的立體感)
    if rng.random() < 0.5:
        sh = tuple(min(255, c + 60) for c in ink)
        ld.text((ox + rng.uniform(-2, 2), oy + rng.uniform(-2, 2)), glyph, font=font, fill=sh + (140,))
    ld.text((ox, oy), glyph, font=font, fill=ink + (255,))
    layer = layer.rotate(rng.uniform(0, 360), resample=Image.BICUBIC, center=(HI / 2, HI / 2))
    img.paste(layer, (0, 0), layer)

    # 反光(亮橢圓)與陰影(暗橢圓)
    for _ in range(rng.randint(0, 2)):
        overlay = Image.new("L", (HI, HI), 0)
        od = ImageDraw.Draw(overlay)
        x0, y0 = rng.uniform(0, HI * 0.7), rng.uniform(0, HI * 0.7)
        od.ellipse([x0, y0, x0 + rng.uniform(15, 55), y0 + rng.uniform(10, 40)], fill=rng.randint(30, 90))
        overlay = overlay.filter(ImageFilter.GaussianBlur(6))
        arr = np.asarray(img).astype(np.int16)
        ov = np.asarray(overlay).astype(np.int16)[..., None]
        if rng.random() < 0.5:
            arr = arr + ov  # 反光
        else:
            arr = arr - ov // 2  # 陰影
        img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))

    # 模糊 + 縮小 + 雜訊
    img = img.filter(ImageFilter.GaussianBlur(rng.uniform(0.4, 1.8)))
    img = img.resize((PATCH, PATCH), Image.BILINEAR)
    arr = np.asarray(img).astype(np.float32)
    arr += np.random.default_rng(rng.randrange(1 << 30)).normal(0, rng.uniform(1, 6), arr.shape)
    arr = np.clip(arr, 0, 255)

    return ink_normalize(arr)


# --- 與 TS 一致的轉換 ---
_yy, _xx = np.mgrid[0:PATCH, 0:PATCH]
_c = (PATCH - 1) / 2
MASK = ((_xx - _c) ** 2 + (_yy - _c) ** 2) <= (PATCH / 2) ** 2


def ink_normalize(rgb: np.ndarray) -> np.ndarray:
    dark = 255.0 - np.minimum(rgb[..., 1], rgb[..., 2])
    med = np.median(dark[MASK])
    v = np.maximum(0.0, dark - med)
    v[~MASK] = 0.0
    rms = float(np.sqrt((v[MASK] ** 2).mean()))
    if rms < 1e-3:
        return np.zeros_like(v, dtype=np.float32)
    return np.minimum(8.0, v / rms).astype(np.float32) * MASK


def main() -> None:
    out_dir = os.path.join(os.path.dirname(__file__), "data")
    os.makedirs(out_dir, exist_ok=True)
    rng = random.Random(20260715)
    n_train, n_val = 2000, 250
    for split, n in [("train", n_train), ("val", n_val)]:
        xs, ys = [], []
        for ci, cls in enumerate(CLASSES):
            for _ in range(n):
                xs.append(render_patch(rng, cls))
                ys.append(ci)
        x = np.stack(xs)[:, None, :, :]  # [N,1,48,48]
        y = np.array(ys, dtype=np.int64)
        np.save(os.path.join(out_dir, f"x_{split}.npy"), x)
        np.save(os.path.join(out_dir, f"y_{split}.npy"), y)
        print(split, x.shape, "classes:", len(CLASSES), flush=True)


if __name__ == "__main__":
    main()
