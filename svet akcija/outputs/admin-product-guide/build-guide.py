from __future__ import annotations

from pathlib import Path
from typing import Iterable, Sequence

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
ANNOTATED = ROOT / "screenshots" / "annotated"
ASSETS = ROOT / "assets"
PDF_DIR = ROOT.parents[1] / "output" / "pdf"
PDF_PATH = PDF_DIR / "Uputstvo_za_rucni_i_Excel_unos_proizvoda.pdf"

ARIAL = Path("/System/Library/Fonts/Supplemental/Arial.ttf")
ARIAL_BOLD = Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf")

NAVY = colors.HexColor("#173B5E")
RED = colors.HexColor("#D71920")
INK = colors.HexColor("#18212B")
MUTED = colors.HexColor("#5E6873")
PALE = colors.HexColor("#F5F7FA")
LINE = colors.HexColor("#D9E1E8")
GREEN = colors.HexColor("#16784A")
AMBER = colors.HexColor("#F6E7B0")

PAGE_W, PAGE_H = A4
MARGIN = 34


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
) -> Path:
    source = Image.open(RAW / source_name).convert("RGB")
    offset_x = 0
    offset_y = 0
    if crop:
        offset_x, offset_y, right, bottom = crop
        source = source.crop((offset_x, offset_y, right, bottom))
    draw = ImageDraw.Draw(source)
    label_font = pil_font(22, bold=True)
    for index, box in enumerate(boxes, start=1):
        x1, y1, x2, y2 = box
        x1 -= offset_x
        x2 -= offset_x
        y1 -= offset_y
        y2 -= offset_y
        draw.rounded_rectangle((x1, y1, x2, y2), radius=7, outline="#D71920", width=5)
        radius = 17
        cx = max(radius + 3, min(source.width - radius - 3, x1 - 5))
        cy = max(radius + 3, min(source.height - radius - 3, y1 - 5))
        draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill="#D71920")
        label = str(index)
        bbox = draw.textbbox((0, 0), label, font=label_font)
        tw = bbox[2] - bbox[0]
        th = bbox[3] - bbox[1]
        draw.text((cx - tw / 2, cy - th / 2 - 2), label, fill="white", font=label_font)
    output = ANNOTATED / output_name
    source.save(output, optimize=True)
    return output


def build_annotations() -> dict[str, Path]:
    ANNOTATED.mkdir(parents=True, exist_ok=True)
    return {
        "login": annotate(
            "01-login.png",
            "01-login.png",
            [(444, 343, 836, 384), (444, 416, 836, 454), (444, 464, 836, 502)],
        ),
        "manual_entry": annotate(
            "02-manual-entry.png",
            "03-artikli-unos-novog.png",
            [(306, 335, 415, 378)],
        ),
        "basic": annotate(
            "03-basic.png",
            "24-manual-basic-viewport.png",
            [(444, 340, 576, 381), (580, 340, 710, 381), (712, 340, 844, 381), (311, 466, 577, 512)],
        ),
        "description": annotate(
            "04-description.png",
            "29-description-viewport.png",
            [(311, 66, 845, 142), (311, 191, 846, 446), (311, 452, 846, 718)],
        ),
        "stock": annotate(
            "05-stock.png",
            "25-manual-stock-price-viewport.png",
            [(310, 336, 491, 384), (488, 334, 669, 386), (330, 499, 427, 681)],
        ),
        "dimensions": annotate(
            "06-dimensions.png",
            "26-manual-dimensions-viewport.png",
            [(311, 123, 846, 271), (311, 272, 846, 418), (311, 423, 845, 718)],
        ),
        "channels": annotate(
            "07-channels.png",
            "23-save-button-viewport.png",
            [(327, 335, 496, 383), (327, 420, 771, 461), (706, 614, 845, 664)],
        ),
        "pictogram": annotate(
            "08-pictogram.png",
            "27-pictogram-viewport.png",
            [(906, 312, 1072, 384), (1061, 388, 1230, 434)],
        ),
        "media": annotate(
            "09-media.png",
            "28-media-viewport.png",
            [(905, 139, 1230, 185), (905, 331, 1230, 385), (905, 381, 1054, 429)],
        ),
        "price_list": annotate(
            "10-price-list.png",
            "30-price-list-selected-viewport.png",
            [(296, 342, 329, 377), (425, 179, 579, 227)],
        ),
        "price_form": annotate(
            "11-price-form.png",
            "10-price-filled-full.png",
            [(884, 320, 1231, 368), (884, 386, 1231, 435), (884, 451, 1231, 503), (884, 565, 1023, 613)],
        ),
        "stock_history": annotate(
            "12-stock-history.png",
            "12-stock-history-full.png",
            [(575, 398, 1206, 672), (575, 711, 1274, 1040)],
        ),
        "excel_entry": annotate(
            "13-excel-entry.png",
            "13-articles-excel-entry-full.png",
            [(413, 332, 524, 382)],
            crop=(0, 0, 1280, 720),
        ),
        "excel_select": annotate(
            "14-excel-select.png",
            "15-excel-file-selected-full.png",
            [(306, 242, 1175, 296), (305, 414, 439, 465)],
        ),
        "excel_success": annotate(
            "15-excel-success.png",
            "16-excel-import-result-full.png",
            [(285, 490, 1197, 562)],
        ),
        "imported_list": annotate(
            "16-imported-list.png",
            "17-imported-product-list-full.png",
            [(288, 482, 950, 562), (334, 496, 389, 545)],
            crop=(0, 0, 1280, 720),
        ),
    }


P_BODY = ParagraphStyle(
    "body",
    fontName="GuideSans",
    fontSize=10.5,
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
P_CENTER = ParagraphStyle(
    "center",
    parent=P_BODY,
    alignment=TA_CENTER,
)


def footer(c: canvas.Canvas, page_no: int) -> None:
    c.setStrokeColor(LINE)
    c.line(MARGIN, 24, PAGE_W - MARGIN, 24)
    c.setFont("GuideSans", 8)
    c.setFillColor(MUTED)
    c.drawString(MARGIN, 11, "Svet Povoljnih Cena · Admin vodič")
    c.drawRightString(PAGE_W - MARGIN, 11, str(page_no))


def page_header(c: canvas.Canvas, page_no: int, section: str, title: str, subtitle: str | None = None) -> float:
    c.setFillColor(PALE)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    c.setFillColor(RED)
    c.setFont("GuideSans-Bold", 9)
    c.drawString(MARGIN, PAGE_H - 34, section.upper())
    c.setFillColor(NAVY)
    c.setFont("GuideSans-Bold", 22)
    c.drawString(MARGIN, PAGE_H - 62, title)
    y = PAGE_H - 80
    if subtitle:
        p = Paragraph(subtitle, P_SMALL)
        _, h = p.wrap(PAGE_W - 2 * MARGIN, 40)
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
    border: bool = True,
) -> float:
    image = Image.open(path)
    iw, ih = image.size
    limit_w = max_width or (PAGE_W - 2 * MARGIN)
    scale = min(limit_w / iw, max_height / ih)
    width = iw * scale
    height = ih * scale
    x = (PAGE_W - width) / 2
    y = top - height
    if border:
        c.setFillColor(colors.white)
        c.setStrokeColor(LINE)
        c.roundRect(x - 4, y - 4, width + 8, height + 8, 7, fill=1, stroke=1)
    c.drawImage(ImageReader(str(path)), x, y, width=width, height=height, preserveAspectRatio=True, mask="auto")
    return y - 12


def draw_steps(c: canvas.Canvas, steps: Sequence[str], top: float, width: float | None = None) -> float:
    width = width or (PAGE_W - 2 * MARGIN)
    y = top
    for index, text in enumerate(steps, start=1):
        p = Paragraph(text, P_BODY)
        _, h = p.wrap(width - 36, 100)
        row_h = max(25, h + 6)
        c.setFillColor(RED)
        c.circle(MARGIN + 12, y - 12, 10, fill=1, stroke=0)
        c.setFillColor(colors.white)
        c.setFont("GuideSans-Bold", 9)
        c.drawCentredString(MARGIN + 12, y - 15.5, str(index))
        p.drawOn(c, MARGIN + 31, y - h - 2)
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
    formatted = [[Paragraph(str(cell), P_SMALL) for cell in row] for row in data]
    table = Table(formatted, colWidths=list(widths), repeatRows=0)
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
    _, height = table.wrap(sum(widths), 600)
    table.drawOn(c, MARGIN, top - height)
    return top - height - 10


def next_page(c: canvas.Canvas) -> None:
    c.showPage()


def build_pdf(images: dict[str, Path]) -> None:
    PDF_DIR.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(PDF_PATH), pagesize=A4, pageCompression=1)
    c.setTitle("Uputstvo za ručni i Excel unos proizvoda")
    c.setAuthor("Svet Povoljnih Cena")
    page = 1

    # Cover
    c.setFillColor(PALE)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    c.setFillColor(RED)
    c.rect(0, PAGE_H - 15, PAGE_W, 15, fill=1, stroke=0)
    c.setFillColor(NAVY)
    c.setFont("GuideSans-Bold", 30)
    c.drawString(MARGIN, PAGE_H - 86, "Dodavanje proizvoda")
    c.setFont("GuideSans-Bold", 18)
    c.drawString(MARGIN, PAGE_H - 116, "ručno ili preko Excel (.xlsx) tabele")
    cover_img = ASSETS / "test-nord-main.png"
    place_image(c, cover_img, PAGE_H - 145, 330, max_width=330, border=False)
    draw_note(
        c,
        "<b>Najvažnije:</b> tokom unosa držite status <b>UZ</b> i ostavite <b>Web check, VP check i INO check isključene</b>.",
        315,
        "warning",
    )
    c.setFillColor(NAVY)
    c.roundRect(MARGIN, 138, 250, 82, 9, fill=1, stroke=0)
    c.setFillColor(colors.white)
    c.setFont("GuideSans-Bold", 15)
    c.drawString(MARGIN + 14, 188, "A · RUČNO")
    c.setFont("GuideSans", 10)
    c.drawString(MARGIN + 14, 168, "Najbolje za jedan proizvod.")
    c.drawString(MARGIN + 14, 151, "Svako polje se popunjava u adminu.")
    c.setFillColor(colors.HexColor("#2C6E8F"))
    c.roundRect(PAGE_W - MARGIN - 250, 138, 250, 82, 9, fill=1, stroke=0)
    c.setFillColor(colors.white)
    c.setFont("GuideSans-Bold", 15)
    c.drawString(PAGE_W - MARGIN - 236, 188, "B · EXCEL")
    c.setFont("GuideSans", 10)
    c.drawString(PAGE_W - MARGIN - 236, 168, "Najbolje za više proizvoda.")
    c.drawString(PAGE_W - MARGIN - 236, 151, "Koristi se isključivo .xlsx fajl.")
    footer(c, page)
    next_page(c)
    page += 1

    y = page_header(c, page, "Pre početka", "Pripremite ove podatke")
    y = draw_table(
        c,
        [
            ["Šta", "Primer iz ovog vodiča"],
            ["Kratki naziv", "NORD RUČNI / NORD EXCEL"],
            ["Status", "UZ — proizvod nije za objavu"],
            ["Dobavljač i kategorija", "TEST DOBAVLJAČ UPUTSTVO · Sve za kuću"],
            ["DC zaliha", "12 kom ručno · 8 kom iz XLSX"],
            ["MP cena", "3.499 RSD ručno · 3.699 RSD XLSX"],
            ["Fotografije", "Najmanje glavna slika; u primeru su dodate 2"],
        ],
        y,
        [150, PAGE_W - 2 * MARGIN - 150],
    )
    y = draw_note(
        c,
        "<b>Dve „kutije“ zalihe:</b> polje <b>Stanje DC</b> je roba u distributivnom centru. Dobavljačka/Rabalux zaliha je odvojena i ne upisuje se u ovo polje.",
        y,
        "info",
    )
    draw_note(c, "Za novi proizvod nije dovoljno samo ime: proverite zalihe, cenu, fotografije i kanale pre objave.", y)
    footer(c, page)
    next_page(c)
    page += 1

    y = page_header(c, page, "Prijava", "1. Uđite u admin panel")
    y = place_image(c, images["login"], y, 325)
    draw_steps(
        c,
        [
            "U polje <b>E-pošta</b> unesite svoj administratorski e-mail.",
            "U polje <b>Lozinka</b> unesite svoju lozinku.",
            "Kliknite <b>Prijavi se</b>.",
        ],
        y,
    )
    draw_note(c, "Ne kopirajte test nalog iz snimaka; koristite svoj admin nalog.", 135)
    next_page(c)
    page += 1

    y = page_header(c, page, "Ručni unos", "2. Otvorite novi artikal")
    y = place_image(c, images["manual_entry"], y, 330)
    draw_steps(
        c,
        [
            "U levom meniju otvorite <b>ERP → Artikli</b>.",
            "Kliknite crno dugme <b>Unos novog</b>.",
            "Sistem automatski dodeljuje SKU oblika <b>NOV-…</b>. SKU posle toga ostaje zaključan.",
        ],
        y,
    )
    next_page(c)
    page += 1

    y = page_header(c, page, "Ručni unos", "3. Popunite osnovna polja")
    y = place_image(c, images["basic"], y, 300)
    y = draw_steps(
        c,
        [
            "<b>Kratki naziv:</b> NORD RUČNI.",
            "<b>Status artikla:</b> UZ.",
            "<b>Dobavljač:</b> TEST DOBAVLJAČ UPUTSTVO.",
            "<b>Kategorija sajta:</b> Sve za kuću.",
        ],
        y,
    )
    draw_note(
        c,
        "Zatim izaberite grupu <b>TEST UPUTSTVO</b> i kolekciju <b>TEST</b>. Ako ne postoje, unesite ih u <b>Nova grupa</b> i <b>Nova kolekcija</b>; napraviće se pri prvom čuvanju.",
        y,
        "info",
    )
    next_page(c)
    page += 1

    y = page_header(c, page, "Ručni unos", "4. Unesite identifikaciju i opis")
    y = draw_table(
        c,
        [
            ["Polje", "Test vrednost"],
            ["Bar kod", "2000000000015"],
            ["Veličina", "15 × 38 cm"],
            ["Boja 1 / Boja 2", "Teget plava / Krem"],
            ["Atributi 1–4", "LED 8W · USB-C · 3 nivoa osvetljenja · Toplo belo svetlo"],
            ["Benefiti", "Niska potrošnja, podesiv ugao, jednostavno održavanje"],
            ["Sertifikati", "CE, RoHS"],
        ],
        y,
        [135, PAGE_W - 2 * MARGIN - 135],
    )
    y = place_image(c, images["description"], y, 300)
    draw_steps(
        c,
        [
            "Unesite <b>Kratki opis</b>; on učestvuje u punom nazivu proizvoda.",
            "Unesite <b>Formatirani opis za sajt</b>.",
            "Popunite PDP sekcije: uslovi isporuke, deklaracija, sastavljanje i održavanje.",
        ],
        y,
    )
    next_page(c)
    page += 1

    y = page_header(c, page, "Ručni unos", "5. Unesite DC zalihu")
    y = place_image(c, images["stock"], y, 310)
    draw_steps(
        c,
        [
            "U <b>Stanje</b> unesite fizičku DC zalihu. U primeru: <b>12</b>.",
            "Kad menjate stanje, unesite razlog sa najmanje 3 znaka. Primer: <b>Početno test stanje za izradu admin uputstva</b>.",
            "MP cena se ne kuca u ovo polje. Klik na link u kartici <b>MP cena</b> vodi u cenovnik; cena se dodaje u posebnom koraku.",
        ],
        y,
    )
    draw_note(c, "Za redovan prijem robe koristite ulaznu fakturu i prijem porudžbenice; ručna korekcija ulazi u audit log.", 105)
    next_page(c)
    page += 1

    y = page_header(c, page, "Ručni unos", "6. Dimenzije, pakovanje i nabavka")
    y = place_image(c, images["dimensions"], y, 300)
    y = draw_steps(
        c,
        [
            "Dimenzije artikla: <b>15 × 15 × 38 cm</b>; težina <b>0,8 kg</b>; bruto <b>1,1 kg</b>.",
            "Pakovanje: <b>1 kom</b>; 20 × 20 × 45 cm; bruto <b>1,3 kg</b>.",
            "Dobavljačev naziv: TEST NORD LED TABLE LAMP; HS 9405.20; carina 10%; materijal; MOQ 1.",
        ],
        y,
    )
    draw_note(c, "Ananas troškovi u primeru: posredovanje 10%, skladištenje 2%, isporuka 8%.", y, "info")
    next_page(c)
    page += 1

    y = page_header(c, page, "Ručni unos", "7. Isključite kanale i sačuvajte")
    y = place_image(c, images["channels"], y, 305)
    draw_steps(
        c,
        [
            "<b>Novo do</b> je opcionalan datum oznake „Novo“.",
            "Proverite da su <b>Web check, VP check i INO check prazni</b>.",
            "Kliknite <b>Sačuvaj izmene</b>.",
        ],
        y,
    )
    draw_note(c, "Posle prvog čuvanja ponovo proverite dobavljača, kategoriju, grupu i kolekciju. Puni naziv se formira automatski.", 120)
    next_page(c)
    page += 1

    y = page_header(c, page, "Ručni unos", "8. Dodajte piktogram")
    y = place_image(c, images["pictogram"], y, 320)
    y = draw_steps(
        c,
        [
            "Označite željeni piktogram, npr. <b>Niska potrošnja</b>.",
            "Kliknite <b>Sačuvaj piktograme</b>.",
        ],
        y,
    )
    draw_note(c, "Piktogrami su benefit kartice pored cene. Može ih biti najviše 6.", y, "info")
    next_page(c)
    page += 1

    y = page_header(c, page, "Ručni unos", "9. Dodajte fotografije")
    y = place_image(c, images["media"], y, 315)
    draw_steps(
        c,
        [
            "Kliknite <b>Upload fotografije</b> / <b>Choose File</b> i izaberite sliku sa računara.",
            "Unesite jasan <b>Alt tekst</b>, npr. „NORD stona LED lampa — glavni prikaz“.",
            "Kliknite <b>Dodaj fotografiju</b>.",
            "Za drugu fotografiju ponovite ista tri klika. Na kraju proverite da naslov kaže <b>Mediji (2)</b>.",
        ],
        y,
    )
    next_page(c)
    page += 1

    y = page_header(c, page, "Cena", "10. Izaberite RETAIL cenovnik")
    y = place_image(c, images["price_list"], y, 320)
    y = draw_steps(
        c,
        [
            "Na stranici <b>Cenovnici</b> označite kućicu ispred aktivnog <b>RETAIL</b> cenovnika.",
            "Kliknite <b>Otvori stavke (1)</b>.",
        ],
        y,
    )
    draw_note(c, "Ako ima više RETAIL cenovnika, izaberite onaj koji firma trenutno koristi. U testu je to QA-RETAIL.", y)
    next_page(c)
    page += 1

    y = page_header(c, page, "Cena", "11. Sačuvajte MP cenu")
    y = place_image(c, images["price_form"], y, 310)
    draw_steps(
        c,
        [
            "U <b>SKU</b> unesite automatski dodeljenu šifru proizvoda.",
            "U <b>Cena</b> unesite iznos bez tačke hiljadarke, npr. <b>3499</b>.",
            "U <b>Važi od</b> unesite datum početka.",
            "Kliknite <b>Sačuvaj stavku</b>. Pojaviće se zelena potvrda.",
        ],
        y,
    )
    next_page(c)
    page += 1

    y = page_header(c, page, "Kontrola", "12. Proverite zalihu")
    y = place_image(c, images["stock_history"], y, 430)
    draw_steps(
        c,
        [
            "Na kartonu proizvoda kliknite <b>sva stanja i kretanja</b> pored DC stanja.",
            "Proverite <b>Fizičko stanje</b>, <b>Rezervisano</b> i <b>Raspoloživo</b>.",
            "U tabeli kretanja proverite razlog i novo stanje. U primeru je ulaz 12 i završno stanje 12.",
        ],
        y,
    )
    next_page(c)
    page += 1

    y = page_header(c, page, "Kontrola", "13. Javna provera — samo uz odobrenje")
    y = place_image(c, RAW / "21-public-product-full.png", y, 390)
    y = draw_steps(
        c,
        [
            "Privremeno postavite status <b>SP</b>, uključite samo <b>Web check</b> i kliknite <b>Sačuvaj izmene</b>.",
            "Otvorite prodavnicu i proverite sliku, naziv, cenu, boje, opis, rok isporuke i dugme <b>Dodaj u korpu</b>.",
            "Odmah se vratite u admin: status <b>UZ</b>, Web/VP/INO isključeni, pa <b>Sačuvaj izmene</b>.",
        ],
        y,
    )
    draw_note(c, "Ovaj korak preskočite ako nemate dozvolu za privremenu objavu.", 70)
    next_page(c)
    page += 1

    y = page_header(c, page, "Excel (.xlsx)", "14. Pripremite tabelu")
    y = place_image(c, ROOT / "template-preview-uputstvo.png", y, 340)
    draw_steps(
        c,
        [
            "Otvorite priloženi fajl <b>SPC_TEST_unos_proizvoda.xlsx</b>.",
            "Otvorite list <b>Artikli</b>. Ne menjajte nazive kolona u prvom redu.",
            "Jedan proizvod ide u jedan red. Primer je već popunjen u redu 2.",
            "Za novi proizvod ostavite SKU prazan; sistem ga dodeljuje.",
            "Sačuvajte kao <b>Excel Workbook (.xlsx)</b> — <b>ne kao CSV</b>.",
        ],
        y,
    )
    next_page(c)
    page += 1

    y = page_header(c, page, "Excel (.xlsx)", "15. Šta se unosi u tabelu")
    y = draw_table(
        c,
        [
            ["Grupa kolona", "Šta sadrži"],
            ["Identitet", "Kratki naziv, status, dobavljač, kategorija, grupa, kolekcija"],
            ["Opis", "Kratki opis, atributi 1–4, boje 1–2, benefiti, opis za sajt"],
            ["Zaliha", "Zalihe — u ovom primeru 8"],
            ["Dimenzije", "Artikal i transportno pakovanje, težine i kom/pak"],
            ["Nabavka", "Dobavljačev naziv, Material, sertifikati, barkod, HS, carina, Ananas troškovi"],
            ["Kanali", "Web check, VP check i INO check = Ne"],
            ["Datumi", "Novo do; SKU je prazan za potpuno novi artikal"],
        ],
        y,
        [135, PAGE_W - 2 * MARGIN - 135],
    )
    y = draw_note(c, "Kolona se zove <b>Material</b> zato što upravo taj naziv uvoznik prepoznaje. Ne prevodite i ne preimenujte zaglavlja.", y)
    draw_note(c, "Fotografije sa računara i MP cena dodaju se posle uvoza, istim koracima kao kod ručnog unosa.", y - 70, "info")
    next_page(c)
    page += 1

    y = page_header(c, page, "Excel (.xlsx)", "16. Otvorite Excel unos")
    y = place_image(c, images["excel_entry"], y, 320)
    draw_steps(
        c,
        [
            "Otvorite <b>ERP → Artikli</b>.",
            "Kliknite <b>Excel unos</b>.",
        ],
        y,
    )
    next_page(c)
    page += 1

    y = page_header(c, page, "Excel (.xlsx)", "17. Izaberite fajl i pokrenite uvoz")
    y = place_image(c, images["excel_select"], y, 315)
    draw_steps(
        c,
        [
            "Kliknite polje <b>XLSX datoteka</b> i izaberite sačuvani .xlsx fajl.",
            "Proverite da se vidi tačan naziv fajla.",
            "Kliknite <b>Proveri i uvezi</b>.",
        ],
        y,
    )
    draw_note(c, "Uvoz je atomski: ako jedan red nije ispravan, nijedan red se neće upisati. Ispravite prijavljeni red i pokušajte ponovo.", 105, "info")
    next_page(c)
    page += 1

    y = page_header(c, page, "Excel (.xlsx)", "18. Proverite rezultat uvoza")
    y = place_image(c, images["excel_success"], y, 250)
    y = place_image(c, images["imported_list"], y, 250)
    draw_steps(
        c,
        [
            "Sačekajte zelenu poruku <b>Uvezeno artikala: 1</b>.",
            "Kliknite <b>Nazad na artikle</b>, pronađite novi red i kliknite <b>Otvori</b>.",
            "Proverite status UZ, dobavljača, kategoriju, opis, dimenzije i DC zalihu 8.",
        ],
        y,
    )
    next_page(c)
    page += 1

    y = page_header(c, page, "Završna kontrola", "19. Pre nego što završite")
    y = draw_table(
        c,
        [
            ["✓", "Provera"],
            ["□", "Puni naziv je ispravan; SKU postoji i zaključan je."],
            ["□", "Status je UZ dok proizvod nije odobren za objavu."],
            ["□", "Web check, VP check i INO check su isključeni."],
            ["□", "Dobavljač, kategorija, grupa i kolekcija su izabrani."],
            ["□", "DC zaliha i razlog korekcije su provereni."],
            ["□", "MP cena je sačuvana u aktivnom RETAIL cenovniku."],
            ["□", "Dodate su fotografije sa jasnim alt tekstom."],
            ["□", "Opis, PDP sekcije, dimenzije, pakovanje i materijal su provereni."],
            ["□", "Po potrebi je urađena javna QA provera i proizvod je vraćen na UZ."],
        ],
        y,
        [38, PAGE_W - 2 * MARGIN - 38],
    )
    y = draw_note(c, "Ako nešto nije sigurno, ne uključujte Web/VP/INO. Sačuvajte proizvod kao UZ i pošaljite SKU osobi koja odobrava objavu.", y)
    place_image(c, ASSETS / "test-nord-detail.png", y, 225, max_width=225, border=False)
    footer(c, page)

    c.save()


if __name__ == "__main__":
    register_fonts()
    annotated = build_annotations()
    build_pdf(annotated)
    print(PDF_PATH)
