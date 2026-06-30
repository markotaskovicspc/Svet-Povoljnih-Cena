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
  sku: SKU;
  slug: Slug;
  name: string;
  group: string; // for "slični artikli"
  collection?: string; // for "često kupovano zajedno"
  categoryPath: string[]; // e.g. ["Nameštaj", "Police", "Otvorene police"]
  description: string; // rich-text HTML or MDX
  shortDescription?: string;

  dimensionsCm: Dimensions;
  colorPrimary?: string;
  colorSecondary?: string;
  materials: Material[];
  pictograms: Pictogram[];

  stock: number;
  incomingStock: number;
  supplierStock?: number;

  isHero?: boolean;
  isNew?: boolean;
  newUntil?: ISODate;
  isLimited?: boolean;
  /** "Dok traju zalihe" flag */
  isDtz?: boolean;

  fullPrice: number; // MPC (RSD)
  salePrice?: number; // akcijska MPC (RSD)
  discountPct?: number;
  loyaltyPrice?: number;
  loyaltyDiscountPct?: number;
  action?: PromoAction;
  pdpInfo?: {
    deliveryTerms?: string;
    declaration?: string;
    assemblyInstructions?: string;
    maintenance?: string;
  };

  deliveryDays: { min: number; max: number };
  allowsAssembly: boolean;
  assemblyCities: CityName[];

  media: ProductMedia;

  recommendedSkus: SKU[];
  frequentlyBoughtSkus: SKU[];
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
