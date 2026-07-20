export type RabaluxTechnicalSpec = {
  key: string;
  label: string;
  value: string;
};

export type RabaluxMediaAsset = {
  kind: "IMAGE" | "VIDEO";
  sourceUrl: string;
  order: number;
};

export type RabaluxAttachmentAsset = {
  kind: "MANUAL" | "ENERGY_LABEL";
  label: string;
  sourceUrl: string;
  order: number;
};

export type RabaluxCatalogItem = {
  sourceSku: string;
  sku: string;
  slug: string;
  name: string;
  barcode: string | null;
  category: string | null;
  type: string | null;
  description: string;
  fullPrice: number;
  salePrice: number | null;
  discountPct: number | null;
  colorPrimary: string | null;
  colorSecondary: string | null;
  materials: string[];
  widthCm: number | null;
  depthCm: number | null;
  heightCm: number | null;
  weightKg: number | null;
  grossWeightKg: number | null;
  packWidthCm: number | null;
  packDepthCm: number | null;
  packHeightCm: number | null;
  packGrossWeightKg: number | null;
  warrantyYears: number;
  countryOfOrigin: string | null;
  hsCode: string | null;
  isNew: boolean;
  technicalSpecs: RabaluxTechnicalSpec[];
  media: RabaluxMediaAsset[];
  attachments: RabaluxAttachmentAsset[];
  valid: boolean;
  validationErrors: string[];
};

export type RabaluxStockItem = {
  sourceSku: string;
  stock: number;
  status: string;
  outgoing: boolean;
  restricted: boolean;
  nextArrivalAt: Date | null;
};

export type RabaluxDryRunSummary = {
  catalogRows: number;
  stockRows: number;
  catalogUnique: number;
  stockUnique: number;
  invalidPrice: number;
  catalogOnly: string[];
  stockOnly: string[];
  videos: number;
  manuals: number;
  energyLabels: number;
  imageAssets: number;
};
