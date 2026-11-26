#!/usr/bin/env python3
"""생활 통제 앱 아이콘 생성기 (PWA).

`python3 study/control/icons/make_icons.py` 로 study/control/icons/ 안의
icon-192.png / icon-512.png / icon-maskable-512.png / apple-touch-icon.png 를 다시 만듭니다.
Pillow 만 있으면 됩니다. (4배 크게 그린 뒤 줄여서 가장자리를 매끄럽게 만듭니다.)

무늬: 스터디 플래너 아이콘과 같은 먹색 바탕 위에 종이색 체크 한 획 —
'오늘의 통제를 하나씩 지운다'는 뜻만 남긴 미니멀 표식입니다.
"""

from pathlib import Path
import math

from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent

INK_TOP = (36, 36, 41)      # #242429
INK_BOTTOM = (15, 15, 17)   # #0f0f11
INK_FLAT = (24, 24, 27)     # #18181b
PAPER = (250, 250, 250)     # #fafafa

SS = 4  # supersampling


def linear_gradient(size: int, top, bottom) -> Image.Image:
    img = Image.new("RGB", (1, size))
    px = img.load()
    for y in range(size):
        t = y / max(1, size - 1)
        px[0, y] = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    return img.resize((size, size), Image.BILINEAR)


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def draw_mark(size: int, opaque_bg: bool, glyph_scale: float) -> Image.Image:
    """size×size 아이콘. glyph_scale 은 체크 표식이 차지하는 비율(1.0 = 기본)."""
    S = size * SS
    base = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    # 1) 배경 — 플래너와 같은 먹색 그라데이션 + 둥근 모서리
    if opaque_bg:
        base.paste(Image.new("RGB", (S, S), INK_FLAT).convert("RGBA"), (0, 0))
    else:
        bg = linear_gradient(S, INK_TOP, INK_BOTTOM).convert("RGBA")
        base.paste(bg, (0, 0), rounded_mask(S, round(S * 0.2237)))

    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)

    cx = cy = 0.5

    def X(v): return (cx + (v - cx) * glyph_scale) * S
    def Y(v): return (cy + (v - cy) * glyph_scale) * S
    def U(v): return v * glyph_scale * S

    # 2) 체크 한 획 — 짧은 쪽(왼쪽)에서 길게 올라가는 오른쪽 획
    pts = [(X(0.285), Y(0.520)), (X(0.440), Y(0.672)), (X(0.735), Y(0.352))]
    w = max(2, round(U(0.084)))
    draw.line(pts, fill=PAPER + (255,), width=w, joint="curve")
    # 둥근 끝마무리
    r = w / 2 - 0.5
    for (px_, py_) in (pts[0], pts[-1]):
        draw.ellipse((px_ - r, py_ - r, px_ + r, py_ + r), fill=PAPER + (255,))

    # 3) 아래 한 줄 — 체크리스트의 밑줄(아주 옅게)
    bar_h = U(0.030)
    y0 = Y(0.815)
    draw.rounded_rectangle((X(0.285), y0, X(0.715), y0 + bar_h), radius=bar_h / 2, fill=PAPER + (110,))

    layer = layer.filter(ImageFilter.GaussianBlur(S * 0.0012))
    base.alpha_composite(layer)
    return base.resize((size, size), Image.LANCZOS)


def save(img: Image.Image, name: str):
    path = HERE / name
    img.save(path, "PNG", optimize=True)
    print(f"{path.name}: {img.size[0]}×{img.size[1]}, {path.stat().st_size} bytes")


def main():
    HERE.mkdir(parents=True, exist_ok=True)

    any_icon = draw_mark(512, opaque_bg=False, glyph_scale=1.0)
    save(any_icon.resize((192, 192), Image.LANCZOS), "icon-192.png")
    save(any_icon, "icon-512.png")

    save(draw_mark(512, opaque_bg=True, glyph_scale=0.76), "icon-maskable-512.png")
    save(draw_mark(180, opaque_bg=True, glyph_scale=0.84), "apple-touch-icon.png")

    sheet = Image.new("RGB", (820, 560), (250, 250, 250))
    x = 40
    for name, size in (("icon-192.png", 192), ("icon-512.png", 200)):
        im = Image.open(HERE / name).convert("RGBA").resize((size, size), Image.LANCZOS)
        sheet.paste(im, (x, 60), im)
        x += size + 40
    mk = Image.open(HERE / "icon-maskable-512.png").convert("RGBA").resize((200, 200), Image.LANCZOS)
    sheet.paste(mk, (x, 60), mk)
    at = Image.open(HERE / "apple-touch-icon.png").convert("RGBA")
    sheet.paste(at, (40, 330), at)
    sheet.save(HERE / "preview-icons.png")
    print("preview-icons.png saved")


if __name__ == "__main__":
    main()
