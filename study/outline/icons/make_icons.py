#!/usr/bin/env python3
"""목차 학습 앱 아이콘 생성기 (PWA).

`python3 study/outline/icons/make_icons.py` 로 study/outline/icons/ 안의
icon-192.png / icon-512.png / icon-maskable-512.png / apple-touch-icon.png 를 다시 만듭니다.
Pillow 만 있으면 됩니다. (4배 크게 그린 뒤 줄여서 가장자리를 매끄럽게 만듭니다.)

무늬: 먹색 바탕 위에 종이색 목차 막대 세 줄 — 대목차 → 세부목차 → 세부내용으로
갈수록 짧아지고 안쪽으로 들어가는 계층을 그대로 아이콘으로 옮겼습니다.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent

INK_TOP = (36, 36, 41)      # #242429
INK_BOTTOM = (15, 15, 17)   # #0f0f11
INK_FLAT = (24, 24, 27)     # #18181b (사이트 --text/--accent)
PAPER = (250, 250, 250)     # #fafafa (사이트 --bg)
PAPER_DIM = (196, 196, 201) # #c4c4c9 (세부 줄은 살짝 흐리게)

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


def bar(draw: ImageDraw.ImageDraw, x0, y0, x1, y1, color, alpha=255):
    """둥근 끝의 가로 막대 (좌표는 S 기준 비율)."""
    r = (y1 - y0) / 2
    draw.rounded_rectangle((x0, y0, x1, y1), radius=r, fill=color + (alpha,))


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

    # 2) 목차 막대 — 기준 좌표(0~1)를 glyph_scale 로 가운데 정렬해 축소
    cx = cy = 0.5
    def X(v): return (cx + (v - cx) * glyph_scale) * S
    def Y(v): return (cy + (v - cy) * glyph_scale) * S
    def U(v): return v * glyph_scale * S  # 길이·두께는 비율로 축소

    # 세로 여백선: 노트 오른쪽 페이지의 마진 라인 같은 hairline
    line_w = max(1, round(U(0.012)))
    draw.rounded_rectangle(
        (X(0.305) - line_w / 2, Y(0.300), X(0.305) + line_w / 2, Y(0.700)),
        radius=line_w / 2,
        fill=PAPER + (70,),
    )

    # 대목차 (가장 길고 진하게)
    dot = U(0.052)
    dy = Y(0.388) - dot / 2
    draw.rounded_rectangle((X(0.372), dy, X(0.372) + dot, dy + dot), radius=U(0.012),
                           fill=PAPER + (255,))
    bar(draw, X(0.452), Y(0.370), X(0.742), Y(0.406), PAPER, 255)

    # 세부목차 (한 단 들여쓰고 조금 짧게)
    dot2 = U(0.040)
    dy = Y(0.500) - dot2 / 2
    draw.rounded_rectangle((X(0.408), dy, X(0.408) + dot2, dy + dot2), radius=U(0.010),
                           fill=PAPER_DIM + (255,))
    bar(draw, X(0.478), Y(0.4855), X(0.688), Y(0.5145), PAPER_DIM, 255)

    # 세부내용 (더 안쪽, 가장 짧게)
    dot3 = U(0.034)
    dy = Y(0.606) - dot3 / 2
    draw.rounded_rectangle((X(0.442), dy, X(0.442) + dot3, dy + dot3), radius=U(0.009),
                           fill=PAPER_DIM + (150,))
    bar(draw, X(0.502), Y(0.594), X(0.634), Y(0.618), PAPER_DIM, 150)

    layer = layer.filter(ImageFilter.GaussianBlur(S * 0.0015))
    base.alpha_composite(layer)
    return base.resize((size, size), Image.LANCZOS)


def save(img: Image.Image, name: str):
    path = HERE / name
    img.save(path, "PNG", optimize=True)
    print(f"{path.name}: {img.size[0]}×{img.size[1]}, {path.stat().st_size} bytes")


def main():
    HERE.mkdir(parents=True, exist_ok=True)

    # 홈 화면 아이콘(any): 둥근 모서리, 무늬를 크게
    any_icon = draw_mark(512, opaque_bg=False, glyph_scale=1.0)
    save(any_icon.resize((192, 192), Image.LANCZOS), "icon-192.png")
    save(any_icon, "icon-512.png")

    # maskable: 여백(안전 영역)을 넉넉히 두고 배경은 꽉 채운다
    save(draw_mark(512, opaque_bg=True, glyph_scale=0.74), "icon-maskable-512.png")

    # iOS 홈 화면: 투명도 없는 꽉 찬 정사각형
    save(draw_mark(180, opaque_bg=True, glyph_scale=0.80), "apple-touch-icon.png")

    # 미리보기용 (README·검수)
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
