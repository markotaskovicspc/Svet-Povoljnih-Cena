from __future__ import annotations

from pathlib import Path
from typing import Sequence

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph, Table, TableStyle


ROOT = Path(__file__).resolve().parent
RAW = ROOT / "screenshots" / "raw"
ANN = ROOT / "screenshots" / "annotated"
PDF_DIR = ROOT.parents[1] / "output" / "pdf"
PDF_PATH = PDF_DIR / "Uputstvo_od_unosa_do_prodaje_proizvoda.pdf"
ASSET = ROOT.parent / "admin-product-guide" / "assets" / "test-nord-main.png"
STOCK_PREVIEW = ROOT / "dc-stock-preview.png"

ARIAL = Path("/System/Library/Fonts/Supplemental/Arial.ttf")
ARIAL_BOLD = Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf")

PAGE_W, PAGE_H = A4
MARGIN = 34
NAVY = colors.HexColor("#173B5E")
RED = colors.HexColor("#D71920")
INK = colors.HexColor("#17212B")
MUTED = colors.HexColor("#5E6873")
PALE = colors.HexColor("#F5F7FA")
LINE = colors.HexColor("#D9E1E8")
GREEN = colors.HexColor("#16784A")


def register_fonts() -> None:
    pdfmetrics.registerFont(TTFont("GuideSans", str(ARIAL)))
    pdfmetrics.registerFont(TTFont("GuideSans-Bold", str(ARIAL_BOLD)))


def pil_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(ARIAL_BOLD if bold else ARIAL), size=size)


def annotate(
    output_name: str,
    source_name: str,
    boxes: Sequence[tuple[int, int, int, int]],
    crop: tuple[int, int, int, int] | None = None,
    start_number: int = 1,
) -> Path:
    image = Image.open(RAW / source_name).convert("RGB")
    offset_x = offset_y = 0
    if crop:
        offset_x, offset_y, right, bottom = crop
        image = image.crop(crop)
    draw = ImageDraw.Draw(image)
    font = pil_font(22, bold=True)
    for number, (x1, y1, x2, y2) in enumerate(boxes, start=start_number):
        x1 -= offset_x
        x2 -= offset_x
        y1 -= offset_y
        y2 -= offset_y
        draw.rounded_rectangle((x1, y1, x2, y2), radius=8, outline="#D71920", width=5)
        radius = 17
        cx = max(radius + 3, min(image.width - radius - 3, x1 - 5))
        cy = max(radius + 3, min(image.height - radius - 3, y1 - 5))
        draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill="#D71920")
        label = str(number)
        bbox = draw.textbbox((0, 0), label, font=font)
        draw.text(
            (cx - (bbox[2] - bbox[0]) / 2, cy - (bbox[3] - bbox[1]) / 2 - 2),
            label,
            fill="white",
            font=font,
        )
    output = ANN / output_name
    image.save(output, format="PNG", optimize=True)
    return output


def build_annotations() -> dict[str, Path]:
    ANN.mkdir(parents=True, exist_ok=True)
    return {
        "nav": annotate("01-nav-artikli.png", "01-kontrolna-tabla.png", [(14, 566, 245, 604)]),
        "new": annotate("02-unos-novog.png", "02-artikli-unos-novog.png", [(307, 335, 410, 375)]),
        "basic": annotate(
            "03-osnovna-polja.png",
            "03-novi-artikal-prazno.png",
            [
                (508, 374, 690, 410),
                (700, 374, 880, 410),
                (891, 374, 1071, 410),
                (317, 486, 690, 521),
                (333, 704, 505, 739),
            ],
        ),
        "details": annotate(
            "04-identifikacija-opis.png",
            "04-osnovni-podaci-popunjeni.png",
            [
                (317, 142, 1072, 178),
                (317, 213, 1072, 249),
                (317, 282, 1072, 315),
                (317, 351, 1072, 419),
                (317, 484, 1072, 690),
            ],
        ),
        "pdp": annotate(
            "05-pdp-tekstovi.png",
            "05-opis-i-pdp.png",
            [
                (333, 283, 1055, 350),
                (333, 383, 1055, 446),
                (333, 480, 1055, 545),
                (333, 582, 1055, 644),
            ],
        ),
        "save": annotate(
            "06-uz-kanali-sacuvaj.png",
            "06-dimenzije-nabavka-kanali.png",
            [(333, 303, 565, 338), (333, 376, 949, 407), (944, 544, 1071, 579)],
        ),
        "verify": annotate(
            "07-provera-posle-cuvanja.png",
            "07-sacuvan-osnovni-deo.png",
            [(291, 252, 1060, 302), (700, 546, 881, 581), (891, 546, 1071, 581), (317, 657, 690, 693)],
        ),
        "photo": annotate(
            "08-dodaj-fotografiju.png",
            "09-glavna-slika-izabrana.png",
            [(1145, 370, 1455, 405), (1145, 568, 1455, 602), (1145, 612, 1280, 646)],
        ),
        "photos_done": annotate(
            "09-fotografije-gotove.png",
            "10-dve-fotografije-dodate.png",
            [(1144, 63, 1455, 390), (1144, 420, 1455, 456), (1144, 493, 1455, 526)],
        ),
        "price_list": annotate(
            "10-izaberi-cenovnik.png",
            "12-cenovnik-oznacen.png",
            [(302, 330, 323, 351), (432, 210, 566, 245)],
        ),
        "price_form": annotate(
            "11-unos-cene.png",
            "14-mp-cena-popunjena.png",
            [(1125, 235, 1456, 269), (1125, 303, 1456, 338), (1125, 368, 1456, 405), (1125, 478, 1252, 512)],
        ),
        "price_ok": annotate(
            "12-cena-sacuvana.png",
            "15-mp-cena-sacuvana.png",
            [(1125, 103, 1455, 145), (316, 122, 1074, 178)],
        ),
        "dc_manual": annotate(
            "13-rucna-korekcija.png",
            "16-dc-lager-uvoz-pocetak.png",
            [(15, 369, 244, 404), (923, 448, 1455, 482), (923, 513, 1455, 547), (923, 601, 1455, 635), (923, 646, 1066, 679)],
        ),
        "dc_file": annotate(
            "14-izaberi-fajl.png",
            "17-dc-lager-fajl-izabran.png",
            [(317, 369, 850, 404), (318, 458, 410, 491)],
        ),
        "dc_review": annotate(
            "15-primeni-uvoz.png",
            "19-dc-lager-spreman-za-primenu.png",
            [(317, 369, 849, 404), (318, 550, 849, 727), (420, 518, 603, 552)],
        ),
        "dc_done": annotate(
            "16-uvoz-zavrsen.png",
            "20-dc-lager-uvoz-primenjen.png",
            [(317, 145, 850, 185), (318, 351, 850, 540)],
        ),
        "stock_price": annotate(
            "17-provera-zalihe-i-cene.png",
            "21-product-cena-i-podaci-provereni.png",
            [(317, 1847, 560, 1887), (333, 1998, 470, 2151)],
            crop=(250, 1600, 1120, 2350),
        ),
        "publish_status": annotate(
            "18-status-sp.png",
            "22-objava-sacuvana.png",
            [(700, 394, 881, 430)],
            crop=(250, 0, 1120, 900),
        ),
        "publish_channels": annotate(
            "19-web-sacuvaj.png",
            "22-objava-sacuvana.png",
            [(331, 2973, 475, 3022), (574, 2973, 956, 3022), (941, 3150, 1072, 3198)],
            crop=(250, 2600, 1120, 3450),
            start_number=2,
        ),
        "public": annotate(
            "20-javna-provera.png",
            "23-proizvod-javno-dostupan.png",
            [(816, 155, 1455, 359), (1156, 289, 1453, 335)],
        ),
    }


P_BODY = ParagraphStyle(
    "body",
    fontName="GuideSans",
    fontSize=10.4,
    leading=14,
    textColor=INK,
    alignment=TA_LEFT,
)
P_SMALL = ParagraphStyle(
    "small",
    parent=P_BODY,
    fontSize=8.6,
    leading=11.5,
    textColor=MUTED,
)
P_CENTER = ParagraphStyle("center", parent=P_BODY, alignment=TA_CENTER)


def footer(c: canvas.Canvas, page_no: int) -> None:
    c.setStrokeColor(LINE)
    c.line(MARGIN, 24, PAGE_W - MARGIN, 24)
    c.setFont("GuideSans", 8)
    c.setFillColor(MUTED)
    c.drawString(MARGIN, 11, "Svet Povoljnih Cena - vodič za administratora")
    c.drawRightString(PAGE_W - MARGIN, 11, str(page_no))


def page_header(c: canvas.Canvas, page_no: int, section: str, title: str, subtitle: str | None = None) -> float:
    c.setFillColor(PALE)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    c.setFillColor(RED)
    c.setFont("GuideSans-Bold", 9)
    c.drawString(MARGIN, PAGE_H - 34, section.upper())
    c.setFillColor(NAVY)
    c.setFont("GuideSans-Bold", 21)
    c.drawString(MARGIN, PAGE_H - 62, title)
    y = PAGE_H - 79
    if subtitle:
        p = Paragraph(subtitle, P_SMALL)
        _, h = p.wrap(PAGE_W - 2 * MARGIN, 45)
        p.drawOn(c, MARGIN, y - h)
        y -= h + 8
    c.setStrokeColor(LINE)
    c.line(MARGIN, y, PAGE_W - MARGIN, y)
    footer(c, page_no)
    return y - 12


def place_image(
    c: canvas.Canvas,
    path: Path,
    top: float,
    max_height: float,
    max_width: float | None = None,
    x: float | None = None,
) -> float:
    image = Image.open(path)
    iw, ih = image.size
    limit_w = max_width or (PAGE_W - 2 * MARGIN)
    scale = min(limit_w / iw, max_height / ih)
    width = iw * scale
    height = ih * scale
    px = x if x is not None else (PAGE_W - width) / 2
    py = top - height
    c.setFillColor(colors.white)
    c.setStrokeColor(LINE)
    c.roundRect(px - 4, py - 4, width + 8, height + 8, 7, fill=1, stroke=1)
    c.drawImage(ImageReader(str(path)), px, py, width=width, height=height, preserveAspectRatio=True, mask="auto")
    return py - 12


def draw_steps(c: canvas.Canvas, steps: Sequence[str], top: float, left: float = MARGIN, width: float | None = None) -> float:
    width = width or (PAGE_W - 2 * MARGIN)
    y = top
    for number, text in enumerate(steps, start=1):
        p = Paragraph(text, P_BODY)
        _, h = p.wrap(width - 36, 120)
        row_h = max(25, h + 7)
        c.setFillColor(RED)
        c.circle(left + 12, y - 12, 10, fill=1, stroke=0)
        c.setFillColor(colors.white)
        c.setFont("GuideSans-Bold", 9)
        c.drawCentredString(left + 12, y - 15.5, str(number))
        p.drawOn(c, left + 31, y - h - 2)
        y -= row_h
    return y


def draw_note(c: canvas.Canvas, text: str, top: float, kind: str = "warning") -> float:
    fill = colors.HexColor("#FFF1F1") if kind == "warning" else colors.HexColor("#EAF6F0")
    stroke = RED if kind == "warning" else GREEN
    p = Paragraph(text, P_BODY)
    _, h = p.wrap(PAGE_W - 2 * MARGIN - 22, 120)
    box_h = h + 20
    y = top - box_h
    c.setFillColor(fill)
    c.setStrokeColor(stroke)
    c.roundRect(MARGIN, y, PAGE_W - 2 * MARGIN, box_h, 7, fill=1, stroke=1)
    p.drawOn(c, MARGIN + 11, y + 10)
    return y - 10


def draw_table(c: canvas.Canvas, data: Sequence[Sequence[str]], top: float, widths: Sequence[float]) -> float:
    rows = [[Paragraph(str(cell), P_SMALL) for cell in row] for row in data]
    table = Table(rows, colWidths=list(widths))
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, 0), (-1, 0), "GuideSans-Bold"),
                ("GRID", (0, 0), (-1, -1), 0.5, LINE),
                ("BACKGROUND", (0, 1), (-1, -1), colors.white),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )
    _, height = table.wrap(sum(widths), 620)
    table.drawOn(c, MARGIN, top - height)
    return top - height - 10


def new_page(c: canvas.Canvas) -> None:
    c.showPage()


def build_pdf(images: dict[str, Path]) -> None:
    PDF_DIR.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(PDF_PATH), pagesize=A4, pageCompression=1)
    c.setTitle("Od unosa do prodaje proizvoda")
    c.setAuthor("Svet Povoljnih Cena")
    page = 1

    # 1 - cover
    c.setFillColor(PALE)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    c.setFillColor(RED)
    c.rect(0, PAGE_H - 15, PAGE_W, 15, fill=1, stroke=0)
    c.setFillColor(NAVY)
    c.setFont("GuideSans-Bold", 29)
    c.drawString(MARGIN, PAGE_H - 78, "Od novog proizvoda")
    c.drawString(MARGIN, PAGE_H - 112, "do prodaje na sajtu")
    c.setFont("GuideSans", 12)
    c.setFillColor(MUTED)
    c.drawString(MARGIN, PAGE_H - 138, "Najjednostavnije uputstvo - svaki klik je numerisan crveno")
    place_image(c, ASSET, PAGE_H - 165, 315, max_width=320)
    draw_note(
        c,
        "Primer je stvarno unet u produkcioni admin: <b>NOV-2026-00004</b>, naziv <b>TEST NORD - OBRISATI</b>, cena <b>3.999 RSD</b>, DC zaliha <b>7</b>.",
        310,
        "info",
    )
    draw_note(
        c,
        "Dok unos nije potpuno proveren držite status <b>UZ</b> i sve kanale isključene. Status <b>SP</b> i <b>Web check</b> uključuju se tek na kraju.",
        245,
    )
    footer(c, page)
    new_page(c)
    page += 1

    # 2 - flow and values
    y = page_header(c, page, "Pregled", "Redosled koji uvek pratite")
    y = draw_steps(
        c,
        [
            "Napravite proizvod ručno i ostavite ga u statusu <b>UZ</b>.",
            "Dodajte najmanje jednu fotografiju.",
            "Dodajte cenu u aktivni <b>MP / RETAIL</b> cenovnik.",
            "Dodajte DC zalihu ručno ili uvezite CSV/XLSX i prvo je proverite.",
            "Na artiklu proverite cenu i zalihu.",
            "Promenite status u <b>SP</b>, uključite samo <b>Web check</b> i sačuvajte.",
            "Otvorite javnu stranu i proverite da dugme <b>Dodaj u korpu</b> radi i nije sivo.",
        ],
        y,
    )
    y = draw_table(
        c,
        [
            ["Podatak", "Vrednost u ovom primeru"],
            ["SKU", "NOV-2026-00004 - sistem ga je dodelio"],
            ["Naziv", "TEST NORD - OBRISATI"],
            ["Dobavljač", "Modital doo"],
            ["Kategorija / grupa", "Unutrašnja rasveta / Stone lampe"],
            ["MP cena", "3999 RSD"],
            ["DC zaliha", "7 komada"],
        ],
        y - 4,
        [145, PAGE_W - 2 * MARGIN - 145],
    )
    draw_note(c, "Ako radite pravi proizvod, zamenite sve TEST vrednosti stvarnim podacima i fotografijama.", y, "warning")
    new_page(c)
    page += 1

    # 3 - open new product
    y = page_header(c, page, "Artikli", "1. Otvorite unos novog proizvoda")
    y = place_image(c, images["nav"], y, 255)
    y = draw_steps(c, ["U levom meniju kliknite <b>Artikli</b>."], y)
    y = place_image(c, images["new"], y, 250)
    draw_steps(c, ["Kliknite crno dugme <b>Unos novog</b>."], y)
    new_page(c)
    page += 1

    # 4 - basic fields
    y = page_header(c, page, "Artikli", "2. Popunite osnovna polja", "Status mora ostati UZ dok sve ne proverite.")
    y = place_image(c, images["basic"], y, 285)
    y = draw_steps(
        c,
        [
            "U <b>Kratki naziv</b> upišite naziv proizvoda.",
            "U <b>Status artikla</b> izaberite <b>UZ</b>.",
            "Izaberite <b>Dobavljača</b>.",
            "Izaberite <b>Kategoriju sajta</b>.",
            "Izaberite <b>Internu grupu</b>. Kolekciju birate samo ako je koristite.",
        ],
        y,
    )
    draw_note(c, "SKU se dodeljuje automatski i posle kreiranja se ne menja.", y, "info")
    new_page(c)
    page += 1

    # 5 - identification and description
    y = page_header(c, page, "Artikli", "3. Identifikacija i opis")
    y = place_image(c, images["details"], y, 315)
    y = draw_steps(
        c,
        [
            "Popunite bar kod, veličinu i boje.",
            "Popunite atribute proizvoda.",
            "Unesite benefite i sertifikate, odvojene zarezom.",
            "Unesite kratak opis. On učestvuje u punom nazivu proizvoda.",
            "Unesite formatirani opis za sajt.",
        ],
        y,
    )
    new_page(c)
    page += 1

    # 6 - PDP text
    y = page_header(c, page, "Artikli", "4. Popunite PDP informacije")
    y = place_image(c, images["pdp"], y, 305)
    draw_steps(
        c,
        [
            "Unesite <b>Uslove isporuke</b>.",
            "Unesite <b>Deklaraciju</b>.",
            "Unesite <b>Uputstvo za sastavljanje</b> ili napišite da nije potrebno.",
            "Unesite <b>Kako održavati</b>.",
        ],
        y,
    )
    draw_note(c, "Dimenzije, težina, pakovanje, materijal, HS kod, carina i MOQ nalaze se odmah niže na istoj strani.", 125, "info")
    new_page(c)
    page += 1

    # 7 - save as UZ
    y = page_header(c, page, "Artikli", "5. Sačuvajte proizvod kao UZ")
    y = place_image(c, images["save"], y, 305)
    y = draw_steps(
        c,
        [
            "Po želji unesite datum <b>Novo do</b>.",
            "Proverite da su <b>Web check</b>, <b>VP check</b> i <b>INO check</b> prazni.",
            "Kliknite <b>Sačuvaj izmene</b>.",
        ],
        y,
    )
    draw_note(c, "Sačekajte poruku <b>Proizvod je sačuvan.</b> Zatim osvežite stranu i proverite da su dobavljač, kategorija i grupa ostali upisani.", y)
    new_page(c)
    page += 1

    # 8 - verify reload
    y = page_header(c, page, "Kontrola", "6. Proverite sačuvane podatke")
    y = place_image(c, images["verify"], y, 325)
    draw_steps(
        c,
        [
            "Proverite puni naziv i SKU na vrhu.",
            "Proverite da je status još <b>UZ</b>.",
            "Proverite dobavljača.",
            "Proverite kategoriju i internu grupu.",
        ],
        y,
    )
    new_page(c)
    page += 1

    # 9 - photos
    y = page_header(c, page, "Fotografije", "7. Dodajte glavnu fotografiju")
    y = place_image(c, images["photo"], y, 305)
    draw_steps(
        c,
        [
            "Kliknite <b>Choose File</b> i izaberite sliku sa računara.",
            "U polje <b>Alt tekst</b> napišite šta je na slici.",
            "Kliknite <b>Dodaj fotografiju</b>.",
            "Za svaku sledeću sliku ponovite ista tri koraka.",
        ],
        y,
    )
    new_page(c)
    page += 1

    # 10 - photos done
    y = page_header(c, page, "Fotografije", "8. Proverite da su slike sačuvane")
    y = place_image(c, images["photos_done"], y, 325)
    draw_steps(
        c,
        [
            "U kartici <b>Mediji</b> proverite da se vidi nova fotografija.",
            "Proverite zelenu poruku <b>Fotografija je dodata.</b>",
            "Za sledeću sliku ponovo kliknite <b>Choose File</b>, unesite alt tekst i kliknite <b>Dodaj fotografiju</b>.",
        ],
        y,
    )
    new_page(c)
    page += 1

    # 11 - price list
    y = page_header(c, page, "Cena", "9. Otvorite aktivni MP cenovnik")
    y = place_image(c, images["price_list"], y, 325)
    draw_steps(
        c,
        [
            "U levom meniju otvorite <b>Cene i promocije</b>, zatim <b>Cenovnici</b>.",
            "Označite kućicu u redu <b>MP - Maloprodajni cenovnik - RETAIL</b>.",
            "Kliknite <b>Otvori stavke (1)</b>.",
        ],
        y,
    )
    new_page(c)
    page += 1

    # 12 - enter price
    y = page_header(c, page, "Cena", "10. Unesite i sačuvajte MP cenu")
    y = place_image(c, images["price_form"], y, 270)
    y = draw_steps(
        c,
        [
            "U <b>SKU</b> unesite šifru proizvoda.",
            "U <b>Cena</b> unesite broj bez tačke hiljadarke, na primer <b>3999</b>.",
            "U <b>Važi od</b> izaberite datum početka.",
            "Kliknite <b>Sačuvaj stavku</b>.",
        ],
        y,
    )
    y = place_image(c, images["price_ok"], y, 180)
    draw_note(c, "Gotovo je kada se pojave zelena potvrda i red proizvoda sa cenom 3.999 RSD.", y, "info")
    new_page(c)
    page += 1

    # 13 - stock spreadsheet
    y = page_header(c, page, "DC zaliha", "11. Pripremite CSV ili XLSX")
    y = place_image(c, STOCK_PREVIEW, y, 245, max_width=500)
    y = draw_table(
        c,
        [
            ["Kolona", "Obavezno", "Primer"],
            ["sku", "Da", "NOV-2026-00004"],
            ["qty", "Da", "7"],
            ["widthCm", "Ne", "15"],
            ["depthCm", "Ne", "15"],
            ["heightCm", "Ne", "38"],
        ],
        y,
        [120, 90, PAGE_W - 2 * MARGIN - 210],
    )
    y = draw_steps(
        c,
        [
            "Prvi red mora imati tačne nazive kolona iz tabele iznad.",
            "Jedan proizvod je jedan red.",
            "Sačuvajte kao <b>.xlsx</b> ili <b>.csv</b>.",
        ],
        y,
    )
    draw_note(c, "Proizvodi kojih nema u fajlu ostaju nepromenjeni.", y, "info")
    new_page(c)
    page += 1

    # 14 - manual stock correction
    y = page_header(c, page, "DC zaliha", "12A. Ručna korekcija - za jedan artikal")
    y = place_image(c, images["dc_manual"], y, 310)
    draw_steps(
        c,
        [
            "U levom meniju kliknite <b>DC lager</b>.",
            "U desnom polju <b>SKU</b> unesite šifru proizvoda.",
            "U <b>Promena količine</b> unesite plus za ulaz ili minus za izlaz. Primer: <b>7</b>.",
            "U <b>Razlog</b> napišite zašto menjate stanje.",
            "Kliknite <b>Proknjiži promenu</b>.",
        ],
        y,
    )
    new_page(c)
    page += 1

    # 15 - choose stock file
    y = page_header(c, page, "DC zaliha", "12B. Uvoz - izaberite i proverite fajl")
    y = place_image(c, images["dc_file"], y, 330)
    draw_steps(
        c,
        [
            "U levom delu kliknite <b>Choose File</b> i izaberite CSV/XLSX.",
            "Kliknite <b>Proveri fajl</b>.",
            "Ne primenjujte ništa dok ne vidite zelenu poruku <b>Provera je uspešna</b>.",
        ],
        y,
    )
    new_page(c)
    page += 1

    # 16 - apply import
    y = page_header(c, page, "DC zaliha", "13. Pregledajte pa primenite uvoz")
    y = place_image(c, images["dc_review"], y, 330)
    y = draw_steps(
        c,
        [
            "Ponovo kliknite <b>Choose File</b> i izaberite potpuno isti fajl.",
            "Proverite <b>Trenutno</b>, <b>Novo</b> i <b>Razlika</b> za svaki SKU.",
            "Kliknite <b>Primeni pregledani uvoz</b>.",
            "U sistemskoj potvrdi kliknite <b>OK</b>.",
        ],
        y,
    )
    draw_note(c, "Uvoz ima dva obavezna izbora fajla: prvi za proveru, drugi za primenu istog proverenog fajla.", y)
    new_page(c)
    page += 1

    # 17 - import completion
    y = page_header(c, page, "DC zaliha", "14. Proverite završetak uvoza")
    y = place_image(c, images["dc_done"], y, 330)
    y = draw_steps(
        c,
        [
            "Proverite zelenu poruku <b>DC uvoz je završen</b>.",
            "Proverite broj promena i ulaz/izlaz komada.",
            "U tabeli lagera pronađite SKU i proverite: <b>Fizičko 7</b>, <b>Rezervisano 0</b>, <b>Raspoloživo 7</b>.",
        ],
        y,
    )
    new_page(c)
    page += 1

    # 18 - stock and price product check
    y = page_header(c, page, "Kontrola", "15. Na artiklu proverite cenu i zalihu")
    y = place_image(c, images["stock_price"], y, 405, max_width=500)
    y = draw_steps(
        c,
        [
            "Vratite se na <b>Artikli</b> i otvorite proizvod.",
            "Proverite polje <b>Stanje</b>. U primeru je 7.",
            "Proverite karticu <b>MP cena</b>. U primeru je 3.999 RSD.",
        ],
        y,
    )
    draw_note(c, "Ako zaliha ili cena nisu tačne, ne objavljujte proizvod.", y)
    new_page(c)
    page += 1

    # 19 - publish
    y = page_header(c, page, "Objava", "16. Objavite proizvod samo na Web kanalu")
    left_y = place_image(c, images["publish_status"], y, 245, max_width=250, x=MARGIN)
    right_y = place_image(c, images["publish_channels"], y, 245, max_width=250, x=PAGE_W - MARGIN - 250)
    y = min(left_y, right_y)
    y = draw_steps(
        c,
        [
            "U polju <b>Status artikla</b> izaberite <b>SP</b>.",
            "Uključite samo <b>Web check</b>.",
            "Proverite da su <b>VP check</b> i <b>INO check</b> prazni.",
            "Kliknite <b>Sačuvaj izmene</b> i sačekajte poruku <b>Proizvod je sačuvan.</b>",
            "Osvežite stranu i proverite da su SP i Web check ostali sačuvani.",
        ],
        y,
    )
    draw_note(c, "Web check se uključuje tek kada su fotografije, cena i DC zaliha proverene.", y)
    new_page(c)
    page += 1

    # 20 - public verification
    y = page_header(c, page, "Javna provera", "17. Proverite da je proizvod spreman za prodaju")
    y = place_image(c, images["public"], y, 285)
    y = draw_steps(
        c,
        [
            "Kliknite <b>Otvori prodavnicu</b> u vrhu admina.",
            "U pretrazi ukucajte naziv proizvoda ili SKU i otvorite proizvod.",
            "Proverite naziv, fotografije, boje, cenu i rok isporuke.",
            "Proverite da dugme <b>Dodaj u korpu</b> postoji i da nije sivo.",
        ],
        y,
    )
    y = draw_note(c, "Javna adresa test proizvoda: <b>svetpovoljnihcena.rs/p/nov-2026-00004-cf5506</b>", y, "info")
    draw_note(c, "Završna kontrola: SP + Web uključen + fotografija + MP cena + raspoloživa DC zaliha + aktivno dugme za korpu.", y)
    new_page(c)
    page += 1

    # 21 - quick checklist
    y = page_header(c, page, "Brza lista", "Kontrola pre svake objave")
    checks = [
        "[ ] Naziv i SKU su tačni",
        "[ ] Dobavljač, kategorija i grupa su tačni",
        "[ ] Opis, PDP tekstovi i dimenzije su popunjeni",
        "[ ] Dodata je najmanje jedna fotografija",
        "[ ] MP cena je sačuvana u aktivnom RETAIL cenovniku",
        "[ ] DC zaliha je proverena u Lager tabeli",
        "[ ] Status je SP",
        "[ ] Web check je uključen",
        "[ ] VP check i INO check su isključeni, osim ako su posebno odobreni",
        "[ ] Javna PDP strana prikazuje cenu i aktivno dugme Dodaj u korpu",
    ]
    for text in checks:
        p = Paragraph(text, P_BODY)
        _, h = p.wrap(PAGE_W - 2 * MARGIN - 26, 60)
        c.setFillColor(colors.white)
        c.setStrokeColor(LINE)
        c.roundRect(MARGIN, y - h - 13, PAGE_W - 2 * MARGIN, h + 16, 6, fill=1, stroke=1)
        p.drawOn(c, MARGIN + 12, y - h - 5)
        y -= h + 23
    y = draw_note(c, "Ako bilo koja stavka nije potvrđena, vratite status na <b>UZ</b>, isključite Web check i sačuvajte.", y - 2)
    draw_note(c, "Ovaj test proizvod je označen <b>TEST NORD - OBRISATI</b> i može se ukloniti kada administrator završi obuku.", y - 68, "info")
    footer(c, page)

    c.save()


if __name__ == "__main__":
    register_fonts()
    build_pdf(build_annotations())
    print(PDF_PATH)
