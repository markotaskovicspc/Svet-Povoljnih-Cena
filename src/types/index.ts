/**
 * Domain types — Phase 0 scaffold.
 * Mirrors the future XML supplier feed shape. All money values are in RSD (minor unit = dinar, 2 decimals).
 */

export type ISODate = string; // ISO 8601
export type Slug = string;
export type SKU = string;
export type CityName = string;

export interface Dimensions {
  /** Width in cm (Š) */
  w: number;
  /** Depth in cm (D) */
  d: number;
  /** Height in cm (V) */
  h: number;
}

export interface MediaAsset {
  url: string;
  thumbUrl?: string;
  cardUrl?: string;
  pdpUrl?: string;
  alt?: string;
  /** Optional width/height for layout stability */
  width?: number;
  height?: number;
  blurDataUrl?: string;
}

export interface ProductMedia {
  images: MediaAsset[];
  video?: MediaAsset;
  video3d?: MediaAsset;
}

export interface ProductAttachment {
  kind: "manual" | "energy_label" | "document";
  section:
    | "general"
    | "delivery_terms"
    | "declaration"
    | "assembly_instructions"
    | "maintenance";
  label: string;
  url: string;
  mimeType?: string;
  sizeBytes?: number;
}

export interface TechnicalSpecification {
  key: string;
  label: string;
  value: string;
}

export interface PromoAction {
  id: string;
  name: string; // e.g. "Black Friday", "Nedeljna akcija"
  startsAt: ISODate;
  endsAt: ISODate;
  /** Marks the action itself as a hero (header tab candidate). */
  isHero?: boolean;
  /** Permanent protected-price campaign, introduced after the 01.05 trade-law change. */
  isPermanent?: boolean;
}

export interface Pictogram {
  id: string;
  code: string; // stable code from XML
  label: string;
  iconUrl: string; // cloud asset
}

export interface Material {
  id: string;
  label: string;
  imageUrl?: string;
}

export interface Product {
  /** Database id when the product originates from the canonical catalog. */
  id?: string;
  /** Internal supplier profile key used for supplier-specific storefront rules. */
  supplierIntegrationKey?: string;
  sku: SKU;
  slug: Slug;
  name: string;
  group: string; // for "slični artikli"
  /** Internal canonical relation id used to resolve scoped promotions. */
  groupId?: string;
  collection?: string; // for "često kupovano zajedno"
  categoryPath: string[]; // e.g. ["Nameštaj", "Police", "Otvorene police"]
  /** Internal canonical relation ids used to resolve scoped promotions. */
  categoryIds?: string[];
  /** Materialized category paths, including descendants for scoped promotions. */
  pricingCategoryPaths?: string[];
  description: string; // rich-text HTML or MDX
  shortDescription?: string;
  /** Customer-facing size/volume/model label appended to the displayed name. */
  sizeLabel?: string;

  dimensionsCm: Dimensions;
  packageDimensionsCm?: Dimensions;
  colorPrimary?: string;
  colorSecondary?: string;
  attributes?: string[];
  materials: Material[];
  pictograms: Pictogram[];

  stock: number;
  incomingStock: number;
  supplierNextArrivalAt?: ISODate;
  /** Customer-facing source of currently sellable stock; exact supplier quantities stay server-side. */
  availabilitySource?: "DC" | "SUPPLIER" | "MIXED" | "NONE";

  isHero?: boolean;
  isNew?: boolean;
  newUntil?: ISODate;
  isLimited?: boolean;
  /** "Dok traju zalihe" flag */
  isDtz?: boolean;

  fullPrice: number; // MPC (RSD)
  /** Lowest public, non-loyalty price in the preceding 30-day reference window. */
  referencePrice?: number;
  salePrice?: number; // akcijska MPC (RSD)
  discountPct?: number;
  loyaltyPrice?: number;
  loyaltyDiscountPct?: number;
  /** Set from the authenticated storefront context, never from public catalog cache. */
  loyaltyEligible?: boolean;
  actionPrices?: Array<{
    price: number;
    priority: number;
    startsAt: ISODate;
    endsAt: ISODate;
    isPermanent?: boolean;
    actionId?: string;
    actionName?: string;
    isHero?: boolean;
  }>;
  linearPromotions?: Array<{
    discountPct: number;
    priority: number;
    startsAt: ISODate;
    endsAt: ISODate;
    name?: string;
  }>;
  action?: PromoAction;
  pdpInfo?: {
    deliveryTerms?: string;
    declaration?: string;
    assemblyInstructions?: string;
    maintenance?: string;
  };
  technicalSpecs?: TechnicalSpecification[];
  warrantyYears?: number;
  countryOfOrigin?: string;
  attachments?: ProductAttachment[];

  deliveryDays: { min: number; max: number };
  allowsAssembly: boolean;
  assemblyCities: CityName[];

  media: ProductMedia;

  /** One storefront card can represent several independent colour SKUs. */
  variantFamily?: ProductVariantFamily;

  recommendedSkus: SKU[];
  frequentlyBoughtSkus: SKU[];
}

export interface ProductVariantOption {
  productId?: string;
  sku: SKU;
  slug: Slug;
  name: string;
  label: string;
  colorHex?: string;
  colorPrimary?: string;
  colorSecondary?: string;
  position: number;
  isPrimary: boolean;
  thumbnail?: MediaAsset;
  media: ProductMedia;
  /** SKU-specific pictograms shown when this colour variant is selected. */
  pictograms?: Pictogram[];
  fullPrice: number;
  referencePrice?: number;
  salePrice?: number;
  discountPct?: number;
  loyaltyPrice?: number;
  loyaltyDiscountPct?: number;
  stock: number;
  incomingStock: number;
  supplierNextArrivalAt?: ISODate;
  availabilitySource?: "DC" | "SUPPLIER" | "MIXED" | "NONE";
  deliveryDays: { min: number; max: number };
  isHero?: boolean;
  isNew?: boolean;
  isLimited?: boolean;
  isDtz?: boolean;
  action?: PromoAction;
  actionPrices?: Product["actionPrices"];
}

export interface ProductVariantFamily {
  id: string;
  code: string;
  primarySku?: SKU;
  selectedSku: SKU;
  options: ProductVariantOption[];
}

export interface Category {
  id: string;
  slug: Slug;
  name: string;
  parentId?: string | null;
  /** Sort order inside parent. */
  order: number;
  imageUrl?: string;
}

export interface Banner {
  id: string;
  title: string;
  subtitle?: string;
  badgeLabel?: string;
  ctaLabel?: string;
  ctaHref?: string;
  imageDesktop: MediaAsset;
  imageMobile?: MediaAsset;
  startsAt?: ISODate;
  endsAt?: ISODate;
  order: number;
}

export interface PromoBar {
  id: string;
  enabled: boolean;
  text: string;
  href?: string;
  startsAt?: ISODate;
  endsAt?: ISODate;
}

/** Primary commercial tabs shown below search. Kept editable from admin. */
export interface Tab {
  id: string;
  label: string;
  href: string;
  order: number;
  /** Match icon name from lucide-react, optional. */
  icon?: string;
  /** Admin-managed image reused by mobile shortcuts and destination titles. */
  pictogram?: Pictogram;
}

export interface DeliveryRule {
  id: string;
  scope:
    | { type: "global" }
    | { type: "category"; categoryId: string }
    | { type: "product"; sku: SKU };
  city?: CityName;
  courierPrice?: number; // kurirska
  truckPrice?: number; // kamionska
  assemblyPrice?: number; // montaža
}

export interface Address {
  id: string;
  label?: string;
  firstName: string;
  lastName: string;
  phone: string;
  street: string;
  city: CityName;
  postalCode: string;
  xExpressTownId?: number | null;
  xExpressStreetId?: number | null;
  country: string; // default "RS"
  isDefault?: boolean;
  /** Pravno lice fields */
  companyName?: string;
  pib?: string;
}

export interface User {
  id: string;
  email: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  isBusiness?: boolean;
  defaultAddressId?: string;
  marketingConsent?: {
    email: boolean;
    sms: boolean;
    viber: boolean;
  };
  createdAt: ISODate;
}

export type OrderStatus =
  | "kreirano"
  | "potvrdjeno"
  | "u_pripremi"
  | "spremno_za_isporuku"
  | "u_isporuci"
  | "isporuceno"
  | "otkazano"
  | "vraceno";

export type PaymentMethod =
  | "ips"
  | "kartica"
  | "google_pay"
  | "apple_pay"
  | "uplata_na_racun"
  | "pouzece_gotovina"
  | "pouzece_kartica";

export type ShippingMethod = "kurir" | "kamion";

export interface OrderItem {
  sku: SKU;
  name: string;
  qty: number;
  unitPriceFull: number;
  unitPriceSale: number;
  withAssembly?: boolean;
  assemblyPrice?: number;
  thumbnailUrl?: string;
  variant?: string;
  familyCode?: string;
}

export interface Order {
  id: string; // human number e.g. "SPC-2026-001234"
  userId?: string;
  guestEmail?: string;
  customerEmail?: string;
  status: OrderStatus;
  items: OrderItem[];
  subtotal: number;
  savings: number;
  shipping: number;
  assemblyTotal: number;
  voucherCode?: string;
  voucherDiscount?: number;
  firstPurchaseDiscount?: number;
  savedCardDiscount?: number;
  total: number;
  shippingMethod: ShippingMethod;
  paymentMethod: PaymentMethod;
  shippingAddress: Address;
  billingAddress?: Address;
  notes?: string;
  payment?: {
    status: "pending" | "authorized" | "paid" | "failed" | "refunded" | "partial_refund";
    providerRef?: string;
    paymentReference?: string;
    paidAt?: ISODate;
  };
  createdAt: ISODate;
  updatedAt: ISODate;
}

export type VoucherKind = "percent" | "fixed";

export interface Voucher {
  code: string;
  kind: VoucherKind;
  amount: number; // % or RSD
  minSubtotal?: number;
  startsAt?: ISODate;
  endsAt?: ISODate;
  usageLimit?: number;
  perUserLimit?: number;
  active: boolean;
}

export type ReclamationStatus = "primljeno" | "u_obradi" | "reseno" | "odbijeno";

export interface Reclamation {
  id: string; // R-{n}-{orderNo}
  orderId: string;
  sku: SKU;
  customer: {
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
  };
  description: string; // ≤ 250 chars
  photos: MediaAsset[]; // ≤ 5
  notifyVia: "email" | "phone";
  status: ReclamationStatus;
  createdAt: ISODate;
  resolvedAt?: ISODate;
}

export interface WishlistProductSnapshot {
  sku: SKU;
  slug?: Slug;
  name?: string;
  fullPrice?: number;
  effectivePrice?: number;
  discountPct?: number;
  inStock?: boolean;
  incoming?: boolean;
  thumbnailUrl?: string | null;
}

export interface WishlistItem {
  sku: SKU;
  product?: WishlistProductSnapshot;
  notifyOnSale?: boolean;
  notifyOnRestock?: boolean;
  addedAt: ISODate;
}

export interface BackInStockAlert {
  sku: SKU;
  channel: "email" | "sms" | "viber";
  createdAt: ISODate;
}

export interface AdSlot {
  id: string;
  channel: "google_merchant" | "meta" | "tiktok";
  enabled: boolean;
  budgetRsd?: number;
}
