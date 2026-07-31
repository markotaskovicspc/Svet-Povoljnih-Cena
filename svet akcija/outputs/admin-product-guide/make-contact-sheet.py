from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "screenshots" / "raw" / "22-final-manual-inactive-full.png"
OUTPUT = ROOT / "screenshots" / "manual-contact-sheet.png"

image = Image.open(SOURCE).convert("RGB")
slice_height = 700
thumb_width = 480
margin = 24
label_height = 34
font = ImageFont.load_default(size=18)

slices = []
for top in range(0, image.height, slice_height):
    crop = image.crop((0, top, image.width, min(top + slice_height, image.height)))
    thumb_height = round(crop.height * thumb_width / crop.width)
    crop = crop.resize((thumb_width, thumb_height), Image.Resampling.LANCZOS)
    slices.append((top, crop))

columns = 2
rows = (len(slices) + columns - 1) // columns
cell_height = round(slice_height * thumb_width / image.width) + label_height
sheet = Image.new(
    "RGB",
    (columns * thumb_width + (columns + 1) * margin, rows * cell_height + (rows + 1) * margin),
    "white",
)
draw = ImageDraw.Draw(sheet)
for index, (top, crop) in enumerate(slices):
    col = index % columns
    row = index // columns
    x = margin + col * (thumb_width + margin)
    y = margin + row * (cell_height + margin)
    draw.text((x, y), f"y={top}–{min(top + slice_height, image.height)}", fill="#C1121F", font=font)
    sheet.paste(crop, (x, y + label_height))

sheet.save(OUTPUT)
print(OUTPUT)
