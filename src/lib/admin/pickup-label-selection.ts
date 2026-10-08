import { readPackedItems } from "@/lib/courier/parcel-contents";

export type PickupLabelSort = "order" | "name" | "sku";
export type PickupLabelLine = {
  packedItems?: unknown;
  orderItem: { sku: string; name: string } | null;
  purpose?: string;
  reclamation?: { resolution: string | null; resolutionNote: string | null } | null;
};

export function pickupLabelSort(value: unknown): PickupLabelSort {
  return value === "name" || value === "sku" ? value : "order";
}

export function pickupLabelArticles(line: PickupLabelLine) {
  const packed = readPackedItems(line.packedItems);
  if (packed.length) return packed.map(({ sku, name }) => ({ sku, name }));
  if (line.purpose === "RECLAMATION_REPLACEMENT" && line.reclamation?.resolution === "ZAMENA_DELA") {
    return [{ sku: `DEO ZA ${line.orderItem?.sku ?? "—"}`, name: `${line.reclamation.resolutionNote?.trim() || "Deo prema reklamaciji"} (${line.orderItem?.name ?? "nepoznat artikal"}) — NE SLATI CEO ARTIKAL` }];
  }
  return [line.orderItem ?? { sku: "", name: "Artikal više nije povezan sa porudžbinom" }];
}

function searchable(value: string) {
  return value.toLocaleLowerCase("sr-Latn").replace(/đ/g, "dj").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

const collator = new Intl.Collator("sr-Latn", { numeric: true, sensitivity: "base" });

/** Select whole physical parcels, including a combined parcel only once. */
export function selectPickupLabels<T extends PickupLabelLine>(lines: readonly T[], query: string, sort: PickupLabelSort): T[] {
  const terms = searchable(query.trim()).split(/\s+/).filter(Boolean);
  const rows = lines.map(line => ({ line, articles: pickupLabelArticles(line) }))
    .filter(({ articles }) => terms.every(term => searchable(articles.map(a => `${a.sku} ${a.name}`).join(" ")).includes(term)));
  if (sort !== "order") {
    const secondary = sort === "name" ? "sku" : "name";
    const compare = (a: { sku: string; name: string }, b: { sku: string; name: string }) =>
      collator.compare(a[sort], b[sort]) || collator.compare(a[secondary], b[secondary]);
    // A mixed parcel is placed by its first article in the requested ordering.
    rows.forEach(row => row.articles.sort(compare));
    rows.sort((a, b) => compare(a.articles[0]!, b.articles[0]!));
  }
  return rows.map(row => row.line);
}
