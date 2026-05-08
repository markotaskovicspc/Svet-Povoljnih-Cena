import "server-only";

/**
 * Phase 4A — XML supplier feed contracts.
 *
 * The supplier ecosystem in Serbian furniture retail does not have one
 * canonical schema; each vendor publishes their own XML shape. We isolate
 * vendor specifics behind two concepts:
 *
 *   1. `SupplierFeedMapping` — a pure JSON projection that tells the parser
 *      where to find each canonical field inside the vendor XML (path =
 *      slash-separated tag chain, optionally `@attr` for attributes).
 *   2. `SupplierConnector` — a small interface that encapsulates fetching
 *      and parsing one vendor's feed. The default implementation is HTTP +
 *      our minimal XML parser; alternative implementations (CSV, JSON,
 *      flat file, sftp drop) can be plugged in without touching the
 *      importer orchestrator.
 *
 * Everything downstream of the connector consumes `FeedItem[]`, the
 * normalized shape that the importer upserts into the catalog.
 */

export interface FeedMedia {
  url: string;
  alt?: string;
  /** "image" | "video" | "video3d" — defaults to image. */
  kind?: "image" | "video" | "video3d";
  order?: number;
}

export interface FeedPictogram {
  /** Stable code (matches `Pictogram.code` in the DB). */
  code: string;
  label?: string;
  iconUrl?: string;
}

export interface FeedMaterial {
  slug: string;
  label?: string;
  imageUrl?: string;
}

export interface FeedAction {
  /** Stable slug across runs (e.g. "black-friday-2026"). */
  slug: string;
  name: string;
  startsAt: Date;
  endsAt: Date;
  /** Whether this action is itself a "hero" (header tab candidate). */
  isHero?: boolean;
}

/**
 * Canonical vendor-agnostic product representation. The importer treats
 * undefined fields as "no information" (skip) and null as "explicit unset".
 */
export interface FeedItem {
  /** Vendor-side primary key. Stored as `Product.supplierExternalId`. */
  externalId: string;
  /** Public SKU shown on PDP / receipts. Stable across imports. */
  sku: string;
  /** Slug — derived from name if not provided. */
  slug?: string;
  name: string;
  description?: string;
  shortDescription?: string;

  /** Materialized category path, e.g. ["Nameštaj", "Police", "Otvorene"]. */
  categoryPath?: string[];
  groupSlug?: string;
  collectionSlug?: string;

  // Dimensions in cm.
  widthCm?: number;
  depthCm?: number;
  heightCm?: number;

  // Pricing in RSD.
  fullPrice: number;
  salePrice?: number | null;
  discountPct?: number | null;
  action?: FeedAction | null;

  // Flags.
  isHero?: boolean;
  isNew?: boolean;
  newUntil?: Date | null;
  isLimited?: boolean;
  isDtz?: boolean;

  // Stock.
  stock: number;
  incomingStock?: number;
  supplierStock?: number;

  // Delivery.
  deliveryDaysMin?: number;
  deliveryDaysMax?: number;
  allowsAssembly?: boolean;

  media?: FeedMedia[];
  pictograms?: FeedPictogram[];
  materials?: FeedMaterial[];
}

/**
 * Per-supplier path mapping. Each value is a "/"-separated tag chain rooted
 * at the product node (not the feed root). Use `@attr` suffix to read an
 * attribute, `[]` suffix to indicate a repeated node.
 *
 * Example for `<artikal sku="A-1"><cena><puna>9990</puna></cena></artikal>`:
 *   { sku: "@sku", fullPrice: "cena/puna" }
 */
export interface SupplierFeedMapping {
  /** Tag name of the repeating product node beneath the feed root. */
  itemPath: string;

  externalId: string;
  sku?: string; // defaults to externalId
  slug?: string;
  name: string;
  description?: string;
  shortDescription?: string;

  categoryPath?: string;
  /** Separator inside categoryPath text (default "/"). */
  categorySeparator?: string;
  groupSlug?: string;
  collectionSlug?: string;

  widthCm?: string;
  depthCm?: string;
  heightCm?: string;

  fullPrice: string;
  salePrice?: string;
  discountPct?: string;

  actionSlug?: string;
  actionName?: string;
  actionStartsAt?: string;
  actionEndsAt?: string;
  actionIsHero?: string;

  isHero?: string;
  isNew?: string;
  newUntil?: string;
  isLimited?: string;
  isDtz?: string;

  stock: string;
  incomingStock?: string;
  supplierStock?: string;

  deliveryDaysMin?: string;
  deliveryDaysMax?: string;
  allowsAssembly?: string;

  /** Repeating image nodes — path resolves to the URL leaf. */
  imagesPath?: string;
  videoPath?: string;
  video3dPath?: string;

  /** Pictogram code list. */
  pictogramCodesPath?: string;
  /** Material slug list. */
  materialSlugsPath?: string;
}

export interface SupplierConfig {
  id: string;
  name: string;
  feedUrl: string;
  authUser?: string | null;
  authPass?: string | null;
  enabled: boolean;
  mapping: SupplierFeedMapping;
}

export interface ImportSummary {
  supplierId: string;
  importRunId: string;
  startedAt: Date;
  finishedAt: Date;
  read: number;
  ok: number;
  failed: number;
  created: number;
  updated: number;
  disabled: number;
  errors: Array<{ externalId?: string; message: string }>;
}

export interface SupplierConnector {
  /** Fetch the raw feed body (XML/JSON/etc) and return decoded text. */
  fetchRaw(): Promise<string>;
  /** Parse + map the raw feed to the normalized `FeedItem[]`. */
  parse(raw: string): FeedItem[];
}
