export interface SearchHit {
  sku: string;
  slug: string;
  name: string;
  breadcrumb: string;
  thumbnailUrl: string;
  fullPrice: number;
  salePrice: number;
  discountPct: number;
  isHero: boolean;
}
