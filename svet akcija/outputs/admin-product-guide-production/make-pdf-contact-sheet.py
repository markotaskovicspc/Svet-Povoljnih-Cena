from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
RENDER = ROOT / "tmp" / "pdfs" / "admin-guide-render"
OUTPUT = Path(__file__).resolve().parent / "pdf-contact-sheet.png"
PAGES = sorted(RENDER.glob("page-*.png"))

thumb_w = 280
thumb_h = 396
gap = 24
cols = 4
rows = (len(PAGES) + cols - 1) // cols
sheet = Image.new("RGB", (cols * (thumb_w + gap) + gap, rows * (thumb_h + 46 + gap) + gap), "#dfe5eb")
draw = ImageDraw.Draw(sheet)
font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 18)

for index, path in enumerate(PAGES):
    image = Image.open(path).convert("RGB")
    image.thumbnail((thumb_w, thumb_h), Image.Resampling.LANCZOS)
    x = gap + (index % cols) * (thumb_w + gap)
    y = gap + (index // cols) * (thumb_h + 46 + gap)
    sheet.paste(image, (x + (thumb_w - image.width) // 2, y))
    draw.text((x, y + thumb_h + 10), f"Strana {index + 1}", fill="#173B5E", font=font)

sheet.save(OUTPUT, optimize=True)
print(OUTPUT)
