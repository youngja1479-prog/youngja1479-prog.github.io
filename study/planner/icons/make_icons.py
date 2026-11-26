#!/usr/bin/env python3
"""스터디 플래너 앱 아이콘 생성기 (PWA).

`python3 study/planner/icons/make_icons.py` 로 study/planner/icons/ 안의
icon-192.png / icon-512.png / icon-maskable-512.png / apple-touch-icon.png 를 다시 만듭니다.
Pillow 만 있으면 됩니다. (4배 크게 그린 뒤 줄여서 가장자리를 매끄럽게 만듭니다.)

무늬: 먹색 바탕 위에 종이색 원형 다이얼 + 12시 방향 눈금 + 중심에서 뻗은 바늘,
그 아래 두 줄의 짧은 막대 — '순공 타이머'와 '메인·루틴 투트랙'을 한 표식으로 옮겼습니다.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent

INK_TOP = (36, 36, 41)      # #242429
INK_BOTTOM = (15, 15, 17)   # #0f0f11
INK_FLAT = (24, 24, 27)     # #18181b (사이트 --text/--accent)
PAPER = (250, 250, 250)     # #fafafa (사이트 --bg)
PAPER_DIM = (188, 188, 194) # #bcbcc2

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
    """size×size 아이콘을 그린다. glyph_scale 은 무늬가 차지하는 비율(1.0 = 기본)."""
    S = size * SS
    base = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    # 1) 배경
    if opaque_bg:
        bg = Image.new("RGB", (S, S), INK_FLAT).convert("RGBA")
        base.paste(bg, (0, 0))
    else:
        bg = linear_gradient(S, INK_TOP, INK_BOTTOM).convert("RGBA")
        base.paste(bg, (0, 0), rounded_mask(S, round(S * 0.2237)))

    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)

    cx = cy = 0.5

    def X(v): return (cx + (v - cx) * glyph_scale) * S
    def Y(v): return (cy + (v - cy) * glyph_scale) * S
    def U(v): return v * glyph_scale * S

    # 2) 다이얼 — 가는 원 테두리 (종이색)
    ring_r = U(0.210)
    ring_w = max(2, round(U(0.028)))
    dcx, dcy = X(0.5), Y(0.452)
    draw.ellipse((dcx - ring_r, dcy - ring_r, dcx + ring_r, dcy + ring_r),
                 outline=PAPER + (245,), width=ring_w)

    # 3) 12시 눈금 — 다이얼 위쪽에 짧은 굵은 막대
    tick_w = U(0.078)
    tick_h = U(0.040)
    draw.rounded_rectangle((dcx - tick_w / 2, dcy - ring_r - tick_h * 0.05,
                            dcx + tick_w / 2, dcy - ring_r + tick_h * 0.75),
                           radius=tick_h * 0.35, fill=PAPER + (245,))

    # 4) 바늘 — 중심에서 1시 방향으로 뻗는 막대
    ang_deg = -58.0
    import math
    a = math.radians(ang_deg)
    hand_len = ring_r * 0.74
    hw = max(2, round(U(0.020)))
    x2, y2 = dcx + math.cos(a) * hand_len, dcy + math.sin(a) * hand_len
    draw.line((dcx, dcy, x2, y2), fill=PAPER + (255,), width=hw)
    dot = U(0.030)
    draw.ellipse((dcx - dot, dcy - dot, dcx + dot, dcy + dot), fill=PAPER + (255,))

    # 5) 투트랙 — 다이얼 아래 두 줄(메인은 길게, 루틴은 짧게)
    bar_h = U(0.026)
    y0 = Y(0.760)
    draw.rounded_rectangle((X(0.318), y0, X(0.588), y0 + bar_h),
                           radius=bar_h / 2, fill=PAPER + (235,))
    y1 = Y(0.824)
    draw.rounded_rectangle((X(0.412), y1, X(0.682), y1 + bar_h),
                           radius=bar_h / 2, fill=PAPER_DIM + (210,))

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

    save(draw_mark(512, opaque_bg=True, glyph_scale=0.74), "icon-maskable-512.png")
    save(draw_mark(180, opaque_bg=True, glyph_scale=0.80), "apple-touch-icon.png")

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
