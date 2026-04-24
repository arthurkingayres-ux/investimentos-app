"""Gera ícones PWA + favicon a partir de um canvas 512x512.

Design: gradiente radial (#10b981 no centro → #064e3b nas bordas) com a letra
"C" branca (Carteira) centralizada. Sem dependência de fontes emoji — "C" é
universalmente renderizável com as fontes do sistema.

Uso: python scripts/generate_icons.py
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

RAIZ = Path(__file__).resolve().parent.parent
DIR_ICONS = RAIZ / "assets" / "icons"
FAVICON_PATH = RAIZ / "assets" / "favicon.ico"

TAM_BASE = 512
COR_CENTRO = (16, 185, 129)   # #10b981 emerald
COR_BORDA = (6, 78, 59)       # #064e3b g-900 (theme_color)
COR_LETRA = (255, 255, 255)


def _carregar_fonte(tamanho: int) -> ImageFont.FreeTypeFont:
    candidatos = [
        "seguisb.ttf",
        "segoeuib.ttf",
        "arialbd.ttf",
        "DejaVuSans-Bold.ttf",
    ]
    for nome in candidatos:
        try:
            return ImageFont.truetype(nome, tamanho)
        except OSError:
            continue
    return ImageFont.load_default()


def _gradiente_radial(tam: int) -> Image.Image:
    img = Image.new("RGB", (tam, tam), COR_BORDA)
    pixels = img.load()
    cx = cy = tam / 2
    r_max = math.sqrt(cx * cx + cy * cy)
    for y in range(tam):
        for x in range(tam):
            d = math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
            t = min(d / r_max, 1.0)
            r = int(COR_CENTRO[0] + (COR_BORDA[0] - COR_CENTRO[0]) * t)
            g = int(COR_CENTRO[1] + (COR_BORDA[1] - COR_CENTRO[1]) * t)
            b = int(COR_CENTRO[2] + (COR_BORDA[2] - COR_CENTRO[2]) * t)
            pixels[x, y] = (r, g, b)
    return img


def _desenhar_c(base: Image.Image) -> Image.Image:
    img = base.copy()
    draw = ImageDraw.Draw(img)
    tam = img.width
    fonte = _carregar_fonte(int(tam * 0.62))
    texto = "C"
    bbox = draw.textbbox((0, 0), texto, font=fonte)
    largura = bbox[2] - bbox[0]
    altura = bbox[3] - bbox[1]
    x = (tam - largura) / 2 - bbox[0]
    y = (tam - altura) / 2 - bbox[1]
    draw.text((x, y), texto, font=fonte, fill=COR_LETRA)
    return img


def _mascara_circular(img: Image.Image) -> Image.Image:
    tam = img.width
    mascara = Image.new("L", (tam, tam), 0)
    ImageDraw.Draw(mascara).ellipse((0, 0, tam, tam), fill=255)
    recorte = Image.new("RGBA", (tam, tam), (0, 0, 0, 0))
    recorte.paste(img, (0, 0), mascara)
    return recorte


def gerar() -> None:
    DIR_ICONS.mkdir(parents=True, exist_ok=True)
    base = _gradiente_radial(TAM_BASE)
    com_letra = _desenhar_c(base)

    com_letra.save(DIR_ICONS / "icon-512.png", format="PNG")
    com_letra.resize((192, 192), Image.LANCZOS).save(
        DIR_ICONS / "icon-192.png", format="PNG"
    )

    apple = _mascara_circular(com_letra.convert("RGBA")).resize(
        (180, 180), Image.LANCZOS
    )
    apple.save(DIR_ICONS / "apple-touch-icon.png", format="PNG")

    com_letra.resize((32, 32), Image.LANCZOS).save(
        FAVICON_PATH, format="ICO", sizes=[(32, 32)]
    )

    print("[ok] ícones gerados em", DIR_ICONS)
    print("[ok] favicon gerado em", FAVICON_PATH)


if __name__ == "__main__":
    gerar()
