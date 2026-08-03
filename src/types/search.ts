export interface SearchHit {
  type: "product";
  href: string;
  sku: string;
  slug: string;
  name: string;
  breadcrumb: string;
  thumbnailUrl: string;
  fullPrice: number;
  actionPrice?: number;
  loyaltyPrice?: number;
  salePrice: number;
  discountPct: number;
  isHero: boolean;
}

export interface SearchNavigationHit {
  type: "category" | "group";
  id: string;
  name: string;
  href: string;
  breadcrumb: string;
}

export type SearchSuggestion = SearchNavigationHit | SearchHit;
