#!/usr/bin/env python3
"""SY 앱 아이콘 생성기 (PWA).

`python3 study/youtube/icons/make_icons.py` 로 study/youtube/icons/ 안의
icon-192.png / icon-512.png / icon-maskable-512.png / apple-touch-icon.png 를 다시 만듭니다.
Pillow 만 있으면 됩니다. (4배 크게 그린 뒤 줄여서 가장자리를 매끄럽게 만듭니다.)
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent

BG_TOP = (37, 37, 43)      # #25252b
BG_BOTTOM = (13, 13, 15)   # #0d0d0f
LINE = (72, 72, 82)        # #484852
GOLD_HI = (244, 219, 150)  # #f4db96
GOLD_LO = (214, 168, 74)   # #d6a84a
GOLD = (232, 197, 107)     # #e8c56b (사이트 --accent)

FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
    "/usr/share/fonts/pickle-hwp/NotoSansCJKkr-Regular.otf",
]

SS = 4  # supersampling


def font_at(size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    raise SystemExit("사용할 수 있는 굵은 글꼴을 찾지 못했습니다.")


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


def radial_glow(size: int, cx: float, cy: float, r: float, color, peak: int) -> Image.Image:
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    steps = 48
    for i in range(steps, 0, -1):
        rr = r * i / steps
        a = round(peak * (1 - i / steps) ** 1.7)
        if a <= 0:
            continue
        draw.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), fill=color + (a,))
    return layer.filter(ImageFilter.GaussianBlur(size * 0.02))


def draw_mark(size: int, opaque_bg: bool, glyph_scale: float, flat_bg: bool) -> Image.Image:
    """size×size 아이콘을 그린다. 좌표 계산은 모두 size 기준 비율."""
    S = size * SS
    base = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    # 1) 배경
    if flat_bg:
        bg = Image.new("RGB", (S, S), BG_TOP)
    else:
        bg = linear_gradient(S, BG_TOP, BG_BOTTOM)
    bg_rgba = bg.convert("RGBA")
    radius = 0 if opaque_bg else round(S * 0.2237)  # Android 적응형 아이콘과 비슷한 둥글기
    if radius:
        mask = rounded_mask(S, radius)
        base.paste(bg_rgba, (0, 0), mask)
    else:
        base.paste(bg_rgba, (0, 0))

    # 2) 위쪽 은은한 하이라이트 + 중앙 금빛 글로우
    hi = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(hi).ellipse(
        (-S * 0.25, -S * 0.62, S * 1.25, S * 0.42), fill=(255, 255, 255, 16)
    )
    hi = hi.filter(ImageFilter.GaussianBlur(S * 0.05))
    glow = radial_glow(S, S / 2, S * 0.53, S * 0.34, GOLD, 34)
    mark_layer = Image.alpha_composite(Image.alpha_composite(base, hi), glow)
    if radius:
        mark_layer.putalpha(rounded_mask(S, radius))
    base = mark_layer

    # 3) 안쪽 테두리 (얇은 선)
    if radius:
        border = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        ImageDraw.Draw(border).rounded_rectangle(
            (S * 0.006, S * 0.006, S - S * 0.006, S - S * 0.006),
            radius=radius,
            outline=LINE + (110,),
            width=max(2, round(S * 0.005)),
        )
        base = Image.alpha_composite(base, border)

    # 4) SY 모노그램
    target_w = S * 0.60 * glyph_scale
    font_size = round(S * 0.5)
    font = font_at(font_size)
    tracking = -S * 0.012
    while True:
        widths = [font.getbbox(ch)[2] - font.getbbox(ch)[0] for ch in "SY"]
        total = sum(widths) + tracking * (len("SY") - 1)
        if total <= target_w or font_size <= 8:
            break
        font_size -= 4
        font = font_at(font_size)
        widths = [font.getbbox(ch)[2] - font.getbbox(ch)[0] for ch in "SY"]

    asc, desc = font.getmetrics()
    cap_top = font.getbbox("S")[1]
    cap_bottom = font.getbbox("S")[3]
    cap_h = cap_bottom - cap_top
    y = S * 0.49 - cap_h / 2 - cap_top  # 캡 높이 중앙을 살짝 위로
    x = (S - total) / 2

    text_mask = Image.new("L", (S, S), 0)
    td = ImageDraw.Draw(text_mask)
    for i, ch in enumerate("SY"):
        td.text((x, y), ch, font=font, fill=255)
        x += widths[i] + tracking

    grad = linear_gradient(S, GOLD_HI, GOLD_LO).convert("RGBA")
    grad.putalpha(text_mask)
    base = Image.alpha_composite(base, grad)

    # 5) 글자 뒤 잔광
    glow_text = Image.new("RGBA", (S, S), GOLD + (0,))
    glow_text.putalpha(text_mask.point(lambda v: round(v * 0.42)))
    glow_text = glow_text.filter(ImageFilter.GaussianBlur(S * 0.024))
    base = Image.alpha_composite(base, glow_text)

    return base.resize((size, size), Image.LANCZOS)


def save(img: Image.Image, name: str) -> None:
    path = HERE / name
    img.save(path, "PNG", optimize=True)
    print(f"{path.relative_to(HERE.parent.parent.parent.parent)}  {img.size[0]}x{img.size[1]}  {path.stat().st_size:,} bytes")


def main() -> None:
    save(draw_mark(192, opaque_bg=False, glyph_scale=1.0, flat_bg=False), "icon-192.png")
    save(draw_mark(512, opaque_bg=False, glyph_scale=1.0, flat_bg=False), "icon-512.png")
    # maskable: 배경을 꽉 채우고, 글자는 안전 영역(가운데 원 80%) 안쪽에
    save(draw_mark(512, opaque_bg=True, glyph_scale=0.86, flat_bg=True), "icon-maskable-512.png")
    # iOS 홈 화면: 투명도·모서리 둥글기 없이 꽉 찬 사각형
    save(draw_mark(180, opaque_bg=True, glyph_scale=0.94, flat_bg=False), "apple-touch-icon.png")


if __name__ == "__main__":
    main()
