import "server-only";

/**
 * Channel-agnostic product shape consumed by the GMC and Meta builders.
 * Keeping this independent of the Prisma row makes the builders trivial
 * to unit-test against fixtures.
 */
export interface FeedProduct {
  id: string;
  sku: string;
  title: string;
  description: string;
  link: string;
  imageLink: string;
  additionalImageLinks: string[];
  /** Number in major units (RSD). */
  price: number;
  /** Number in major units (RSD). Present only when product is on sale. */
  salePrice: number | null;
  currency: string;
  /** "in stock" | "out of stock" | "preorder" */
  availability: "in stock" | "out of stock" | "preorder";
  brand: string;
  condition: "new";
  googleProductCategory: string | null;
  productType: string | null;
  gtin: string | null;
  mpn: string;
}
