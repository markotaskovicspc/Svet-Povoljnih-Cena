import type { SearchHit } from "@/types/search";

export interface MobileSearchCurrentLink {
  id: string;
  label: string;
  href: string;
  imageUrl: string;
}

export interface MobileSearchContent {
  currentItems: MobileSearchCurrentLink[];
  popularProducts: SearchHit[];
  frequentQueries: string[];
  defaultViewAllHref: string;
}
