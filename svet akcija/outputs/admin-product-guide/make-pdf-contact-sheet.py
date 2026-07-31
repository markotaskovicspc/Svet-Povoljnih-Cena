from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
RENDER_DIR = ROOT / "pdf-render"
OUTPUT = ROOT / "pdf-contact-sheet.png"
PAGES = sorted(RENDER_DIR.glob("page-*.png"))

columns = 4
thumb_width = 210
margin = 16
label_height = 24
font = ImageFont.truetype(
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    14,
)

thumbs = []
for page in PAGES:
    image = Image.open(page).convert("RGB")
    height = round(image.height * thumb_width / image.width)
    thumbs.append((page.stem, image.resize((thumb_width, height), Image.Resampling.LANCZOS)))

rows = (len(thumbs) + columns - 1) // columns
cell_height = max(image.height for _, image in thumbs) + label_height
sheet = Image.new(
    "RGB",
    (columns * thumb_width + (columns + 1) * margin, rows * cell_height + (rows + 1) * margin),
    "#E8EDF2",
)
draw = ImageDraw.Draw(sheet)
for index, (name, image) in enumerate(thumbs):
    col = index % columns
    row = index // columns
    x = margin + col * (thumb_width + margin)
    y = margin + row * (cell_height + margin)
    draw.text((x, y), name, fill="#173B5E", font=font)
    sheet.paste(image, (x, y + label_height))

sheet.save(OUTPUT, optimize=True)
print(OUTPUT)
