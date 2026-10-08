/** Match picking's catalogue-first descriptions, retaining order snapshots as fallback. */
export function returnPickingDescription(item?: {
  collectionName?: string | null;
  shortDescriptionSnapshot?: string | null;
  attribute1?: string | null;
  attribute2?: string | null;
  attribute3?: string | null;
  attribute4?: string | null;
  color1?: string | null;
  color2?: string | null;
  product?: {
    barcode: string | null;
    shortDescription: string | null;
    collection: { name: string } | null;
    attribute1: string | null;
    attribute2: string | null;
    attribute3: string | null;
    attribute4: string | null;
    colorPrimary: string | null;
    colorSecondary: string | null;
  } | null;
}) {
  if (!item) return '';
  const product = item.product;
  const attributes = [product?.attribute1 ?? item.attribute1, product?.attribute2 ?? item.attribute2,
    product?.attribute3 ?? item.attribute3, product?.attribute4 ?? item.attribute4,
    product?.colorPrimary ?? item.color1, product?.colorSecondary ?? item.color2].filter(Boolean).join(' / ');
  return [product?.barcode, product?.collection?.name ?? item.collectionName,
    product?.shortDescription ?? item.shortDescriptionSnapshot, attributes].filter(Boolean).join(' · ');
}
