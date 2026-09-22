import { FontNames } from "@pdf-lib/standard-fonts";
import { StandardFontEmbedder } from "pdf-lib";

type Article = { name: string; sku?: string; product?: { barcode: string | null } | null };
const font = StandardFontEmbedder.for(FontNames.HelveticaOblique);

/** Keep identifiers intact and content above the sender block (three lines). */
export function myGlsArticleContent(item: Article) {
  const sku = item.sku?.trim();
  const barcode = item.product?.barcode?.replace(/\s/g, "");
  const identifiers = [sku ? `Sifra: ${sku}` : "", barcode ? `EAN: ${barcode}` : ""]
    .filter(Boolean).join(" / ");
  const suffix = identifiers ? ` / ${identifiers}` : "";
  if (!fits(suffix)) throw new Error("Šifra i barkod artikla su predugački za GLS adresnicu.");
  const name = item.name.replace(/\s+/g, " ").trim();
  if (fits(name + suffix)) return name + suffix;
  for (let length = Math.min(name.length, 120 - suffix.length - 3); length >= 0; length -= 1) {
    const content = `${name.slice(0, length).trimEnd()}...${suffix}`;
    if (fits(content)) return content;
  }
  throw new Error("Šifra i barkod artikla su predugački za GLS adresnicu.");
}

function fits(value: string) {
  if (value.length > 120) return false;
  let lines = 1;
  let width = 0;
  // GLS uses Arial Italic 11pt. Helvetica metrics plus a 10pt margin keep
  // the three printed lines inside its 220pt content column.
  for (const word of value.split(/\s+/)) {
    const measurable = word.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "?");
    const wordWidth = font.widthOfTextAtSize(measurable, 11);
    if (wordWidth > 210) return false;
    const added = wordWidth + (width ? 3.1 : 0);
    if (width + added > 210) { lines += 1; width = wordWidth; }
    else width += added;
  }
  return lines <= 3;
}
